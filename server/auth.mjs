// 会话、OAuth（PKCE）与角色判定。角色只由 QQ 号决定：管理员、已开通用户、游客。
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.mjs";
import { all, get, now, run, setting, setSetting, audit } from "./db.mjs";
import { cookie, parseCookies, redirect } from "./util.mjs";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** settings 里的空串视为「没设置」，回落到环境变量，这样部署时给的值不会被早先的空记录盖掉 */
const pick = (key, fallback = "") => {
  const value = setting(key, "");
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

export const endpoints = () => {
  const issuer = (pick("oauth.issuer", config.oauth.issuer) || "").replace(/\/+$/, "");
  return {
    issuer,
    authorize: `${issuer}/oauth/authorize`,
    token: `${issuer}/oauth/token`,
    userinfo: `${issuer}/oauth/userinfo`,
    clientId: pick("oauth.client_id", config.oauth.clientId),
    clientSecret: pick("oauth.client_secret", config.oauth.clientSecret),
    redirectUri: `${config.baseUrl}/memories/oauth/callback`,
    scope: pick("oauth.scope", config.oauth.scope) || "profile",
  };
};

/* ---------- 会话 ---------- */

export function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies[config.cookieName];
  if (!sid) return null;
  const row = get(
    "SELECT s.id AS sid, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    sid,
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    run("DELETE FROM sessions WHERE id = ?", sid);
    return null;
  }
  if (row.status !== "active") return null;
  const { sid: _sid, expires_at: _exp, ...user } = row;
  return { ...user, sessionId: sid };
}

export const isAdmin = (user) => Boolean(user && user.role === "admin");

export function createSession(user, req) {
  const id = b64url(randomBytes(32));
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  run(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    now(),
    expires,
    String(req.headers["user-agent"] || "").slice(0, 200),
    req.socket.remoteAddress || null,
  );
  run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), user.id);
  return {
    id,
    header: cookie(config.cookieName, id, {
      maxAge: config.sessionDays * 86400,
      secure: config.secureCookie,
      sameSite: "Lax",
    }),
  };
}

export function destroySession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies[config.cookieName];
  if (sid) run("DELETE FROM sessions WHERE id = ?", sid);
  return cookie(config.cookieName, "", { maxAge: 0, secure: config.secureCookie });
}

/* ---------- OAuth PKCE ---------- */

export function beginOAuth(res) {
  const ep = endpoints();
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  run(
    "INSERT INTO oauth_states (state, verifier, redirect, created_at) VALUES (?, ?, ?, ?)",
    state,
    verifier,
    "/memories",
    now(),
  );
  const url = new URL(ep.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", ep.clientId);
  url.searchParams.set("redirect_uri", ep.redirectUri);
  url.searchParams.set("scope", ep.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  redirect(res, url.toString());
}

/** 从 userinfo 的任意层级里找 QQ 号 */
export function findQQ(value, depth = 0) {
  if (!value || depth > 4) return null;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = findQQ(item, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (value.qq != null && /^\d{5,12}$/.test(String(value.qq))) return String(value.qq);
    for (const key of ["user", "data", "profile", "account", "me"]) {
      if (value[key]) {
        const hit = findQQ(value[key], depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }
  return null;
}

export async function finishOAuth(code, state, req) {
  const ep = endpoints();
  const row = get("SELECT * FROM oauth_states WHERE state = ?", state);
  run("DELETE FROM oauth_states WHERE state = ?", state);
  if (!row || !code) throw Object.assign(new Error("登录状态已失效，请重新登录"), { status: 400 });

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: ep.redirectUri,
    client_id: ep.clientId,
    code_verifier: row.verifier,
  });
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (ep.clientSecret) body.set("client_secret", ep.clientSecret);

  const tokenRes = await fetch(ep.token, { method: "POST", headers, body });
  const text = await tokenRes.text();
  let token = null;
  try {
    token = JSON.parse(text);
  } catch {}
  if (!tokenRes.ok || !token?.access_token) {
    throw Object.assign(new Error(`换取令牌失败（${tokenRes.status}）：${text.slice(0, 300)}`), { status: 502 });
  }

  const infoRes = await fetch(ep.userinfo, {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const infoText = await infoRes.text();
  let info = null;
  try {
    info = JSON.parse(infoText);
  } catch {}
  if (!infoRes.ok || !info) {
    throw Object.assign(new Error(`读取用户信息失败（${infoRes.status}）：${infoText.slice(0, 300)}`), { status: 502 });
  }

  const qq = findQQ(info) || findQQ(token);
  if (!qq) {
    throw Object.assign(new Error(`没有在 OAuth 返回里找到 QQ 号：${infoText.slice(0, 300)}`), { status: 502 });
  }

  const adminQQ = setting("admin.qq", config.adminQQ);
  const existing = get("SELECT * FROM users WHERE qq = ?", qq);
  if (existing) {
    if (existing.status !== "active") {
      throw Object.assign(new Error("这个账号已被停用，请联系管理员"), { status: 403 });
    }
    if (String(qq) === String(adminQQ) && existing.role !== "admin") {
      run("UPDATE users SET role = 'admin' WHERE id = ?", existing.id);
      existing.role = "admin";
    }
    if (String(qq) !== String(adminQQ) && existing.role === "admin") {
      run("UPDATE users SET role = 'user' WHERE id = ?", existing.id);
      existing.role = "user";
    }
    audit(existing.id, "login", `qq=${qq}`, req.socket.remoteAddress);
    return existing;
  }

  if (String(qq) === String(adminQQ)) {
    const created = get("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
    if (created) {
      run("UPDATE users SET qq = ?, drive_root = COALESCE(drive_root, ?) WHERE id = ?", qq, "u-admin", created.id);
      return get("SELECT * FROM users WHERE id = ?", created.id);
    }
    run(
      "INSERT INTO users (qq, name, role, status, drive_root, created_at) VALUES (?, '管理员', 'admin', 'active', 'u-admin', ?)",
      qq,
      now(),
    );
    return get("SELECT * FROM users WHERE qq = ?", qq);
  }

  // 未开通：管理员要先在后台手动加人
  throw Object.assign(
    new Error(`QQ ${qq} 还没有开通 Memories。把号码发给管理员，让他把你加进来一次就行。`),
    { status: 403 },
  );
}

/* ---------- 角色与权限 ---------- */

export function canManage(user, media) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return media && media.owner_id === user.id;
}

export function ensuredUserFolder(user) {
  if (!user) return null;
  if (user.drive_root) return user.drive_root;
  const root = `u-${user.id}`;
  run("UPDATE users SET drive_root = ? WHERE id = ?", root, user.id);
  return root;
}

export const onlineCount = () =>
  get("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE expires_at > ?", now())?.n ?? 0;

export const allUsers = () => all("SELECT * FROM users ORDER BY role = 'admin' DESC, id ASC");

export { setSetting };
