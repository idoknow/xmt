// Memories 服务端：静态站 + 登录 + 画廊 + 后台 + WebDAV。
import http from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { config, paths } from "./config.mjs";
import {
  all,
  audit,
  bootstrap,
  get,
  now,
  run,
  setSetting,
  setting,
} from "./db.mjs";
import {
  allUsers,
  beginOAuth,
  createSession,
  currentUser,
  destroySession,
  ensuredUserFolder,
  finishOAuth,
  isAdmin,
  onlineCount,
} from "./auth.mjs";
import { DRIVERS, driverFor, forgetDriver } from "./drives.mjs";
import { countMedia, duplicateMedia, moveMedia, queryMedia, removeMedia, renameMedia, stats, updateMeta, upload, userFolder } from "./media.mjs";
import { parseMultipart } from "./multipart.mjs";
import {
  cookie,
  escapeHtml,
  html,
  mimeOf,
  parseCookies,
  qqAvatar,
  readJson,
  redirect,
  send,
  sendFile,
  sendJson,
} from "./util.mjs";
import { adminPage, detailPage, driveFieldSpecs, fmtSize, galleryPage, loginPage, myPage, sharePage } from "./ui.mjs";

bootstrap(config.adminQQ);

const siteOf = () => ({
  title: setting("site.title", "Memories"),
  intro: setting("site.intro", ""),
});

const json = (res, data, status = 200) => sendJson(res, status, data);
const fail = (res, error) => {
  const status = error.status || 500;
  if (status >= 500) console.error("[memories]", error);
  sendJson(res, status, { ok: false, error: error.message || String(error) });
};

const requireAuth = (req, res) => {
  const user = currentUser(req);
  if (!user) {
    fail(res, Object.assign(new Error("需要登录"), { status: 401 }));
    return null;
  }
  return user;
};

const requireAdmin = (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!isAdmin(user)) {
    fail(res, Object.assign(new Error("需要管理员权限"), { status: 403 }));
    return null;
  }
  return user;
};

/* ---------- 静态资源 ---------- */

const DIST = config.distDir;

const appAsset = (name) => {
  const file = path.join(process.cwd(), "site", "assets", name);
  if (existsSync(file)) return file;
  return path.join(DIST, "assets", name);
};

function serveStatic(req, res, urlPath) {
  if (urlPath === "/" || urlPath === "") return sendFile(req, res, path.join(DIST, "index.html"), { cache: "no-cache" });
  const candidates = [];
  if (urlPath.startsWith("/assets/")) {
    candidates.push(path.join(DIST, urlPath));
  } else {
    candidates.push(path.join(DIST, urlPath));
    candidates.push(path.join(DIST, `${urlPath}.html`));
    candidates.push(path.join(DIST, urlPath, "index.html"));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(path.resolve(DIST) + path.sep) && resolved !== path.resolve(DIST)) continue;
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      const gz = `${resolved}.gz`;
      const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
      const cache = urlPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      if (acceptsGzip && existsSync(gz)) {
        const info = statSync(gz);
        res.writeHead(200, {
          "content-type": mimeOf(resolved),
          "content-encoding": "gzip",
          "content-length": String(info.size),
          "cache-control": cache,
          vary: "accept-encoding",
        });
        return req.method === "HEAD" ? res.end() : createReadStream(gz).pipe(res);
      }
      return sendFile(req, res, resolved, { cache });
    }
  }
  return sendFile(req, res, path.join(DIST, "404.html"), { cache: "no-cache", status: 404 });
}

/* ---------- WebDAV（游客只读） ---------- */

const davBase = (req) => `${config.baseUrl.replace(/\/+$/, "")}/memories/dav`;

function davXml(items, self) {
  const entry = (item) =>
    `<D:response><D:href>${self}${encodeURI(item.path)}</D:href><D:propstat><D:prop>` +
    `<D:displayname>${escapeHtml(item.name)}</D:displayname>` +
    `<D:resourcetype>${item.isDir ? "<D:collection/>" : ""}</D:resourcetype>` +
    `<D:getcontentlength>${item.size || 0}</D:getcontentlength>` +
    `<D:getlastmodified>${new Date(item.modified || Date.now()).toUTCString()}</D:getlastmodified>` +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${items.map(entry).join("")}</D:multistatus>`;
}

function handleDav(req, res, subPath) {
  const decoded = decodeURIComponent(subPath || "/");
  const items = queryMedia({ limit: 500 });
  if (req.method === "OPTIONS") {
    return send(res, 200, "", { dav: "1,2", allow: "OPTIONS, GET, HEAD, PROPFIND" });
  }
  if (req.method === "PROPFIND") {
    const list =
      decoded === "/" || decoded === ""
        ? items.map((item) => ({ name: `${item.id}-${item.name}`, path: `/${item.id}-${encodeURIComponent(item.name)}`, isDir: false, size: item.size, modified: item.created_at }))
        : items
            .filter((item) => decoded === `/${item.id}-${encodeURIComponent(item.name)}`)
            .map((item) => ({ name: `${item.id}-${item.name}`, path: `/${item.id}-${encodeURIComponent(item.name)}`, isDir: false, size: item.size, modified: item.created_at }));
    const body = davXml(list, davBase(req));
    return send(res, 207, body, { "content-type": 'application/xml; charset="utf-8"', dav: "1,2" });
  }
  if (req.method === "GET" || req.method === "HEAD") {
    const match = /^\/(\d+)-/.exec(decoded);
    if (!match) return send(res, 404, "Not Found");
    const item = get("SELECT * FROM media WHERE id = ?", Number(match[1]));
    if (!item) return send(res, 404, "Not Found");
    return streamMedia(req, res, item, { download: false });
  }
  return send(res, 403, "只读：游客不能修改", { allow: "OPTIONS, GET, HEAD, PROPFIND" });
}

/* ---------- 文件流 ---------- */

async function streamMedia(req, res, item, { download = false, shareAllows = true } = {}) {
  const drive = get("SELECT * FROM drives WHERE id = ?", item.drive_id);
  if (!drive) return send(res, 404, "存储不存在");
  if (download && !shareAllows) return send(res, 403, "这份分享不允许下载");
  const driver = driverFor(drive);
  try {
    if (drive.driver === "local") {
      const filePath = await driver.filePath(item.path);
      return sendFile(req, res, filePath, {
        mime: item.mime || mimeOf(item.name),
        cache: "private, max-age=604800",
        downloadAs: download ? item.name : undefined,
      });
    }
    const source = driver.download ? await driver.download(item.path) : await driver.read(item.path);
    const headers = {
      "content-type": source.mime || item.mime || mimeOf(item.name),
      "cache-control": "private, max-age=3600",
      "accept-ranges": "none",
    };
    if (source.size) headers["content-length"] = String(source.size);
    if (download) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`;
    res.writeHead(200, headers);
    return source.stream.pipe(res);
  } catch (error) {
    console.error("[memories] 读取文件失败", error);
    return send(res, 502, `读取失败：${error.message}`);
  }
}

/* ---------- 页面 ---------- */

function pageGallery(req, res, url) {
  const user = currentUser(req);
  const query = {
    kind: url.searchParams.get("kind") || "all",
    q: url.searchParams.get("q") || "",
    sort: url.searchParams.get("sort") || "new",
  };
  const items = queryMedia(query);
  const total = countMedia(query);
  html(res, 200, galleryPage({ site: siteOf(), user, items, total, query }));
}

function pageDetail(req, res, id) {
  const user = currentUser(req);
  const item = get(
    `SELECT m.*, u.name AS owner_name, d.name AS drive_name FROM media m
     LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN drives d ON d.id = m.drive_id WHERE m.id = ?`,
    Number(id),
  );
  if (!item) return html(res, 404, loginPage({ site: siteOf(), error: "这张图不在了" }));
  const prev = get("SELECT id, name FROM media WHERE created_at < ? ORDER BY created_at DESC LIMIT 1", item.created_at);
  const next = get("SELECT id, name FROM media WHERE created_at > ? ORDER BY created_at ASC LIMIT 1", item.created_at);
  html(res, 200, detailPage({ site: siteOf(), user, item, neighbors: { prev, next } }));
}

function pageMy(req, res) {
  const user = currentUser(req);
  if (!user) return redirect(res, "/memories/login");
  userFolder(user);
  const items = queryMedia({ owner: user.id });
  const drives = all("SELECT * FROM drives WHERE enabled = 1 ORDER BY id");
  html(res, 200, myPage({ site: siteOf(), user, items, folder: user.drive_root, drives }));
}

function pageAdmin(req, res) {
  const user = currentUser(req);
  if (!user) return redirect(res, "/memories/login");
  if (!isAdmin(user)) return html(res, 403, loginPage({ site: siteOf(), error: "只有管理员能进后台" }));
  html(
    res,
    200,
    adminPage({
      site: siteOf(),
      user,
      users: allUsers(),
      drives: all("SELECT * FROM drives ORDER BY id"),
      settings: {
        adminQQ: setting("admin.qq", config.adminQQ),
        issuer: setting("oauth.issuer", config.oauth.issuer),
        clientId: setting("oauth.client_id", ""),
        clientSecret: setting("oauth.client_secret", ""),
      },
      counters: stats(),
    }),
  );
}

function pageShare(req, res, token) {
  const share = get("SELECT * FROM shares WHERE token = ?", token);
  if (!share) return html(res, 404, loginPage({ site: siteOf(), error: "分享不存在或已过期" }));
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    return html(res, 410, loginPage({ site: siteOf(), error: "这个分享已经过期了" }));
  }
  const ids = String(share.target).split(",").map(Number).filter(Boolean);
  const items = ids.length
    ? all(
        `SELECT m.*, u.name AS owner_name, d.name AS drive_name FROM media m
         LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN drives d ON d.id = m.drive_id
         WHERE m.id IN (${ids.map(() => "?").join(",")}) ORDER BY m.created_at DESC`,
        ...ids,
      )
    : [];
  const owner = get("SELECT name FROM users WHERE id = ?", share.created_by)?.name;
  html(res, 200, sharePage({ site: siteOf(), share, items, owner }));
}

/* ---------- API ---------- */

async function apiUpload(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;
  const contentType = String(req.headers["content-type"] || "");
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] || /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  const dir = path.join(paths.files, "tmp");
  const { fields, files } = await parseMultipart(req, {
    boundary,
    dir,
    limit: config.limits.admin + 64 * 1024 * 1024,
  });
  const driveId = Number(fields.drive) || get("SELECT id FROM drives WHERE driver = 'local' LIMIT 1")?.id || 1;
  const drive = get("SELECT * FROM drives WHERE id = ?", driveId);
  if (!drive) throw Object.assign(new Error("存储不存在"), { status: 404 });
  if (!files.length) throw Object.assign(new Error("没有收到文件"), { status: 400 });

  const result = await upload({ user, drive, folder: fields.folder || "", files });
  audit(user.id, "upload", `${result.saved.length} 个文件`, req.socket.remoteAddress);
  json(res, { ok: true, saved: result.saved, rejected: result.rejected });
}

async function api(req, res, url) {
  const parts = url.pathname.replace(/^\/memories\/api\/?/, "").split("/").filter(Boolean);
  const user = currentUser(req);
  const method = req.method;

  if (parts[0] === "upload" && method === "POST") return apiUpload(req, res);

  if (parts[0] === "media" && parts[1]) {
    const media = get("SELECT * FROM media WHERE id = ?", Number(parts[1]));
    if (!media) throw Object.assign(new Error("内容不存在"), { status: 404 });
    const action = parts[2] || "";

    if (method === "GET") return json(res, { ok: true, media });

    const current = requireAuth(req, res);
    if (!current) return;

    if (action === "meta" && method === "POST") {
      const body = await readJson(req);
      if (!isAdmin(current) && media.owner_id !== current.id) throw Object.assign(new Error("只能改自己的内容"), { status: 403 });
      return json(res, { ok: true, media: updateMeta(media, body) });
    }
    if (action === "delete" && method === "POST") {
      await removeMedia(current, media);
      audit(current.id, "delete", media.name, req.socket.remoteAddress);
      return json(res, { ok: true });
    }
    if (action === "rename" && method === "POST") {
      const { name } = await readJson(req);
      if (!name) throw Object.assign(new Error("新名字不能为空"), { status: 400 });
      return json(res, { ok: true, media: await renameMedia(current, media, name) });
    }
    if (action === "move" && method === "POST") {
      const { folder } = await readJson(req);
      return json(res, { ok: true, media: await moveMedia(current, media, folder || "/") });
    }
    if (action === "copy" && method === "POST") {
      if (!isAdmin(current) && media.owner_id !== current.id) throw Object.assign(new Error("只能复制自己的内容"), { status: 403 });
      return json(res, { ok: true, media: await duplicateMedia(current, media) });
    }
    throw Object.assign(new Error("不支持的操作"), { status: 404 });
  }

  if (parts[0] === "share" && method === "POST") {
    const current = requireAuth(req, res);
    if (!current) return;
    const body = await readJson(req);
    const ids = (body.ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw Object.assign(new Error("先选内容"), { status: 400 });
    const token = randomBytes(9).toString("base64url");
    const days = Number(body.days || setting("share.default_days", "7")) || 7;
    run(
      "INSERT INTO shares (token, kind, target, created_by, allow_download, expires_at, created_at) VALUES (?, 'media', ?, ?, ?, ?, ?)",
      token,
      ids.join(","),
      current.id,
      body.allowDownload === false ? 0 : 1,
      new Date(Date.now() + days * 86400000).toISOString(),
      now(),
    );
    return json(res, { ok: true, url: `${config.baseUrl}/memories/s/${token}` });
  }

  if (parts[0] === "users") {
    const current = requireAdmin(req, res);
    if (!current) return;
    if (!parts[1] && method === "POST") {
      const body = await readJson(req);
      const qq = String(body.qq || "").trim();
      if (!/^\d{5,12}$/.test(qq)) throw Object.assign(new Error("QQ 号要填数字"), { status: 400 });
      if (get("SELECT id FROM users WHERE qq = ?", qq)) throw Object.assign(new Error("这个 QQ 已经加过了"), { status: 409 });
      run(
        "INSERT INTO users (qq, name, avatar, role, status, note, created_at) VALUES (?, '', ?, 'user', 'active', ?, ?)",
        qq,
        qqAvatar(qq),
        String(body.note || "").slice(0, 60) || null,
        now(),
      );
      return json(res, { ok: true, users: allUsers() });
    }
    if (parts[1] && method === "POST") {
      const target = get("SELECT * FROM users WHERE id = ?", Number(parts[1]));
      if (!target) throw Object.assign(new Error("用户不存在"), { status: 404 });
      const body = await readJson(req);
      if (parts[2] === "role" && body.role) {
        run("UPDATE users SET role = ? WHERE id = ?", body.role === "admin" ? "admin" : "user", target.id);
      } else if (parts[2] === "status") {
        run("UPDATE users SET status = ? WHERE id = ?", target.status === "active" ? "disabled" : "active", target.id);
      } else if (body.note != null || body.name) {
        run("UPDATE users SET note = COALESCE(?, note), name = COALESCE(?, name) WHERE id = ?", body.note ?? null, body.name ?? null, target.id);
      }
      return json(res, { ok: true, users: allUsers() });
    }
  }

  if (parts[0] === "drives") {
    const current = requireAdmin(req, res);
    if (!current) return;
    if (!parts[1] && method === "POST") {
      const body = await readJson(req);
      if (!DRIVERS[body.driver]) throw Object.assign(new Error("未知存储类型"), { status: 400 });
      run(
        "INSERT INTO drives (name, driver, config, root, visibility, created_at) VALUES (?, ?, ?, ?, 'public', ?)",
        String(body.name || DRIVERS[body.driver].label).slice(0, 40),
        body.driver,
        JSON.stringify(body.config || {}),
        String(body.root || "/"),
        now(),
      );
      return json(res, { ok: true });
    }
    if (parts[1]) {
      const drive = get("SELECT * FROM drives WHERE id = ?", Number(parts[1]));
      if (!drive) throw Object.assign(new Error("存储不存在"), { status: 404 });
      if (parts[2] === "test" && method === "POST") {
        const driver = driverFor(drive);
        const started = Date.now();
        const list = await driver.list(drive.root || "/");
        return json(res, { ok: true, ms: Date.now() - started, sample: list.slice(0, 5) });
      }
      if (method === "POST") {
        const body = await readJson(req);
        run(
          "UPDATE drives SET name = COALESCE(?, name), config = COALESCE(?, config), root = COALESCE(?, root), enabled = COALESCE(?, enabled) WHERE id = ?",
          body.name ?? null,
          body.config ? JSON.stringify(body.config) : null,
          body.root ?? null,
          body.enabled == null ? null : body.enabled ? 1 : 0,
          drive.id,
        );
        forgetDriver(drive.id);
        return json(res, { ok: true });
      }
      if (method === "DELETE") {
        run("DELETE FROM drives WHERE id = ?", drive.id);
        forgetDriver(drive.id);
        return json(res, { ok: true });
      }
    }
  }

  if (parts[0] === "settings" && method === "POST") {
    const current = requireAdmin(req, res);
    if (!current) return;
    const body = await readJson(req);
    for (const [key, value] of Object.entries(body)) {
      if (["site.title", "site.intro", "admin.qq", "oauth.issuer", "oauth.client_id", "oauth.client_secret", "share.default_days"].includes(key)) {
        setSetting(key, value);
      }
    }
    return json(res, { ok: true });
  }

  if (parts[0] === "stats") {
    return json(res, { ...stats(), online: onlineCount(), fields: driveFieldSpecs() });
  }

  throw Object.assign(new Error("接口不存在"), { status: 404 });
}

/* ---------- 路由 ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, config.baseUrl);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/memories/assets/app.css") {
      return sendFile(req, res, appAsset("css/app.css"), { cache: "no-cache" });
    }
    if (req.method === "GET" && pathname === "/memories/assets/app.js") {
      return sendFile(req, res, appAsset("js/app.js"), { cache: "no-cache" });
    }

    if (pathname === "/memories" || pathname === "/memories/") return pageGallery(req, res, url);
    if (pathname === "/memories/login") return html(res, 200, loginPage({ site: siteOf(), error: url.searchParams.get("error") || "" }));
    if (pathname === "/memories/logout") {
      const header = destroySession(req);
      return redirect(res, "/memories", { "set-cookie": header });
    }
    if (pathname === "/memories/oauth/start") return beginOAuth(res);
    if (pathname === "/memories/oauth/callback") {
      try {
        const user = await finishOAuth(url.searchParams.get("code"), url.searchParams.get("state"), req);
        const session = createSession(user, req);
        return redirect(res, "/memories", { "set-cookie": session.header });
      } catch (error) {
        return redirect(res, `/memories/login?error=${encodeURIComponent(error.message)}`);
      }
    }
    if (pathname === "/memories/my") return pageMy(req, res);
    if (pathname === "/memories/admin") return pageAdmin(req, res);
    if (pathname.startsWith("/memories/a/")) return pageDetail(req, res, pathname.slice("/memories/a/".length));
    if (pathname.startsWith("/memories/s/")) return pageShare(req, res, pathname.slice("/memories/s/".length));
    if (pathname.startsWith("/memories/f/")) {
      const item = get("SELECT * FROM media WHERE id = ?", Number(pathname.slice("/memories/f/".length)));
      if (!item) return send(res, 404, "Not Found");
      const wantDownload = url.searchParams.get("download") === "1";
      const viewer = currentUser(req);
      return streamMedia(req, res, item, { download: wantDownload, shareAllows: Boolean(viewer) || !wantDownload });
    }
    if (pathname.startsWith("/memories/dav")) return handleDav(req, res, pathname.slice("/memories/dav".length));

    if (pathname.startsWith("/memories/api")) {
      if (req.method === "GET" && pathname === "/memories/api/state") {
        const user = currentUser(req);
        return json(res, {
          ok: true,
          user: user ? { id: user.id, name: user.name, role: user.role } : null,
          site: siteOf(),
          fields: driveFieldSpecs(),
        });
      }
      try {
        return await api(req, res, url);
      } catch (error) {
        return fail(res, error);
      }
    }

    if (pathname === "/healthz.txt" || pathname === "/build.txt") return serveStatic(req, res, pathname);
    return serveStatic(req, res, pathname);
  } catch (error) {
    console.error("[memories] 未捕获", error);
    if (!res.writableEnded) return fail(res, error);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Memories ▸ http://${config.host}:${config.port}/memories  (dist: ${DIST})`);
  console.log(`OAuth ▸ ${setting("oauth.issuer", "") || config.oauth.issuer} · client ${config.oauth.clientId || "(未设置)"}`);
});
