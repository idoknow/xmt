// Memories 服务端：静态站 + 登录 + 画廊 + 后台 + WebDAV。
import http from "node:http";
import { pipeline } from "node:stream/promises";
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
import { countMedia, duplicateMedia, moveMedia, queryMedia, removeMedia, renameMedia, stats, updateMeta, upload, userFolder, hiddenPrefixes, isHidden, setHidden } from "./media.mjs";
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
import { detailPage, driveFieldSpecs, fmtSize, galleryPage, loginPage, myPage, shareFilePage, sharePage } from "./ui.mjs";
import { fileInfoOf, handleAdmin } from "./admin.mjs";
import { pageBrowser, rawBrowser } from "./browser.mjs";
import { handleUploads } from "./uploads.mjs";
import { streamPath } from "./filestream.mjs";

bootstrap(config.adminQQ);

const siteOf = () => ({
  title: setting("site.title", "Memories"),
  intro: setting("site.intro", ""),
});

const json = (res, data, status = 200) => sendJson(res, status, data);
/**
 * 存储配置清洗：前端表单的字段名带 `cfg_` 前缀（避免和表单自身属性撞名），
 * 落库前统一去掉；顺便丢掉空值，避免把已有凭据覆盖成空串。
 */
const tidyConfig = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const clean = {};
  for (const [key, raw] of Object.entries(source)) {
    const name = String(key).replace(/^cfg_/, "").trim();
    if (!name) continue;
    if (raw == null) continue;
    const text = typeof raw === "string" ? raw.trim() : raw;
    if (text === "") continue;
    clean[name] = text;
  }
  return clean;
};
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
      // 带 ?v= 的才是「指纹化」资源，可以一年不可变；否则每次校验，避免发版后卡在旧 CSS/JS。
      const versioned = /[?&]v=/.test(String(req.url || ""));
      const cache = urlPath.startsWith("/assets/") && versioned ? "public, max-age=31536000, immutable" : "no-cache";
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
  const items = queryMedia({ limit: 500, excludeHidden: true });
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
    if (!item || isHidden(item.drive_id, item.path)) return send(res, 404, "Not Found");
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
    };
    // 上游若是压缩过的响应，长度对不上（fetch 会解压），这时宁可让 Node 用 chunked
    if (source.size && !source.encoding) headers["content-length"] = String(source.size);
    if (download) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`;
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      source.stream?.cancel?.();
      return res.end();
    }
    res.writeHead(200, headers);
    try {
      await pipeline(source.stream, res);
    } catch (error) {
      console.error("[memories] 传输中断", error.message);
      if (!res.writableEnded) res.destroy(error);
    }
    return;
  } catch (error) {
    console.error("[memories] 读取文件失败", error);
    if (res.headersSent) {
      if (!res.writableEnded) res.destroy(error);
      return;
    }
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
  const excludeHidden = !isAdmin(user);
  const admin = isAdmin(user);
  const items = queryMedia({ ...query, excludeHidden }).map((item) =>
    admin ? { ...item, is_hidden: isHidden(item.drive_id, item.path) } : item,
  );
  const total = countMedia({ ...query, excludeHidden });
  const drives = all("SELECT * FROM drives WHERE enabled = 1 ORDER BY id").filter(
    (drive) => Boolean(user) || drive.visibility === "public",
  );
  html(res, 200, galleryPage({ site: siteOf(), user, items, total, query, drives }));
}

function pageDetail(req, res, id) {
  const user = currentUser(req);
  const item = get(
    `SELECT m.*, u.name AS owner_name, d.name AS drive_name FROM media m
     LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN drives d ON d.id = m.drive_id WHERE m.id = ?`,
    Number(id),
  );
  if (!item) return html(res, 404, loginPage({ site: siteOf(), error: "这张图不在了" }));
  if (!isAdmin(user) && isHidden(item.drive_id, item.path)) {
    return html(res, 404, loginPage({ site: siteOf(), error: "这张图不在了" }));
  }
  if (isAdmin(user)) item.is_hidden = isHidden(item.drive_id, item.path);
  const prev = get("SELECT id, name FROM media WHERE created_at < ? ORDER BY created_at DESC LIMIT 1", item.created_at);
  const next = get("SELECT id, name FROM media WHERE created_at > ? ORDER BY created_at ASC LIMIT 1", item.created_at);
  html(res, 200, detailPage({ site: siteOf(), user, item, neighbors: { prev, next } }));
}

function pageMy(req, res) {
  const user = currentUser(req);
  if (!user) return redirect(res, "/memories/login");
  userFolder(user);
  const items = queryMedia({ owner: user.id, excludeHidden: !isAdmin(user) });
  const drives = all("SELECT * FROM drives WHERE enabled = 1 ORDER BY id");
  html(res, 200, myPage({ site: siteOf(), user, items, folder: user.drive_root, drives }));
}

function shareLookup(token) {
  const share = get("SELECT * FROM shares WHERE token = ?", token);
  if (!share) return { share: null, gone: 404 };
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) return { share, gone: 410 };
  return { share, gone: 0 };
}

const shareMeta = (share) => {
  try {
    return JSON.parse(share.target || "{}");
  } catch {
    return null;
  }
};

const safeChild = (root, child) => {
  const base = String(root || "/").replace(/\/+$/, "");
  const rel = String(child || "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return rel ? `${base}/${rel}` : base || "/";
};

async function pageSharePath(req, res, share) {
  const meta = shareMeta(share);
  const drive = meta ? get("SELECT * FROM drives WHERE id = ?", meta.drive) : null;
  if (!drive) return html(res, 404, loginPage({ site: siteOf(), error: "分享的存储已经不存在了" }));
  const driver = driverFor(drive);
  const owner = get("SELECT name FROM users WHERE id = ?", share.created_by)?.name;
  const sub = new URL(req.url, "http://x").searchParams.get("path") || "";
  const target = meta.isDir ? safeChild(meta.path, sub) : meta.path;
  const info = await fileInfoOf(drive, driver, target).catch(() => null);
  if (!info) return html(res, 404, loginPage({ site: siteOf(), error: "分享的文件已经不在原处了" }));

  let entries = [];
  if (info.isDir) {
    const list = await driver.list(target).catch(() => []);
    entries = list.map((entry) => ({ name: entry.name, size: entry.size, isDir: entry.isDir, path: entry.path.replace(`${meta.path}/`, "") }));
  }

  return html(
    res,
    200,
    shareFilePage({
      site: siteOf(),
      share,
      owner,
      file: {
        name: info.name,
        size: info.size,
        mime: info.mime,
        isDir: info.isDir,
        width: info.width,
        height: info.height,
        duration: info.duration,
        fps: info.fps,
        modified: info.modified,
      },
      entries,
      base: `/memories/s/${share.token}`,
    }),
  );
}

async function streamSharePath(req, res, share, url) {
  const meta = shareMeta(share);
  const drive = meta ? get("SELECT * FROM drives WHERE id = ?", meta.drive) : null;
  if (!drive) throw Object.assign(new Error("存储不存在"), { status: 404 });
  const sub = url.searchParams.get("path") || "";
  const target = meta.isDir ? safeChild(meta.path, sub) : meta.path;
  const download = url.searchParams.get("download") === "1";
  if (download && !share.allow_download) throw Object.assign(new Error("这份分享不允许下载"), { status: 403 });
  return streamPath(req, res, { drive, target, download });
}

async function pageShare(req, res, token, url) {
  const { share, gone } = shareLookup(token);
  if (!share) return html(res, 404, loginPage({ site: siteOf(), error: "分享不存在或已过期" }));
  if (gone === 410) return html(res, 410, loginPage({ site: siteOf(), error: "这个分享已经过期了" }));
  if (share.kind === "path") return pageSharePath(req, res, share);

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
  const visible = items.filter((item) => !isHidden(item.drive_id, item.path));
  html(res, 200, sharePage({ site: siteOf(), share, items: visible, owner }));
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

  if (parts[0] === "uploads") return handleUploads(req, res, url, user);

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
    const rankOf = (user) =>
      !user ? 0 : String(user.qq) === String(setting("admin.qq", config.adminQQ)) || user.role === "owner" ? 3 : user.role === "admin" ? 2 : 1;
    const guard = (target, action) => {
      if (rankOf(target) > rankOf(current)) throw Object.assign(new Error(`不能${action}权限比自己高的账号`), { status: 403 });
      if (rankOf(current) < 3 && rankOf(target) >= 2) {
        throw Object.assign(new Error(`只有超级管理员能${action}管理员`), { status: 403 });
      }
    };
    if (!parts[1] && method === "POST") {
      const body = await readJson(req);
      const qq = String(body.qq || "").trim();
      const role = body.role === "admin" ? "admin" : "user";
      if (role === "admin" && rankOf(current) < 3) throw Object.assign(new Error("只有超级管理员能添加管理员"), { status: 403 });
      if (!/^\d{5,12}$/.test(qq)) throw Object.assign(new Error("QQ 号要填数字"), { status: 400 });
      if (get("SELECT id FROM users WHERE qq = ?", qq)) throw Object.assign(new Error("这个 QQ 已经加过了"), { status: 409 });
      run(
        "INSERT INTO users (qq, name, avatar, role, status, note, created_at) VALUES (?, '', ?, ?, 'active', ?, ?)",
        qq,
        qqAvatar(qq),
        role,
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
        if (rankOf(current) < 3) throw Object.assign(new Error("只有超级管理员能调整角色"), { status: 403 });
        guard(target, "调整");
        if (rankOf(target) === 3) throw Object.assign(new Error("超级管理员不能被降级"), { status: 403 });
        run("UPDATE users SET role = ? WHERE id = ?", body.role === "admin" ? "admin" : "user", target.id);
      } else if (parts[2] === "status") {
        guard(target, "停用");
        if (rankOf(target) === 3) throw Object.assign(new Error("超级管理员不能被停用"), { status: 403 });
        run("UPDATE users SET status = ? WHERE id = ?", target.status === "active" ? "disabled" : "active", target.id);
      } else if (body.note != null || body.name) {
        guard(target, "修改");
        run("UPDATE users SET note = COALESCE(?, note), name = COALESCE(?, name) WHERE id = ?", body.note ?? null, body.name ?? null, target.id);
      }
      return json(res, { ok: true, users: allUsers() });
    }
    if (parts[1] && method === "DELETE") {
      const target = get("SELECT * FROM users WHERE id = ?", Number(parts[1]));
      if (!target) throw Object.assign(new Error("用户不存在"), { status: 404 });
      if (target.id === current.id) throw Object.assign(new Error("不能移除自己"), { status: 400 });
      run("DELETE FROM sessions WHERE user_id = ?", target.id);
      run("DELETE FROM users WHERE id = ?", target.id);
      audit(current.id, "user.remove", `QQ ${target.qq}`, req.socket.remoteAddress);
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
        "INSERT INTO drives (name, driver, config, root, mount_path, visibility, enabled, quota_bytes, max_file_bytes, description, allow_upload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        String(body.name || DRIVERS[body.driver].label).slice(0, 40),
        body.driver,
        JSON.stringify(tidyConfig(body.config)),
        String(body.root || "/"),
        String(body.mount_path || "").slice(0, 60),
        body.visibility === "public" ? "public" : "members",
        body.enabled === false || body.enabled === 0 ? 0 : 1,
        Math.max(0, Math.trunc(Number(body.quota_bytes) || 0)),
        Math.max(0, Math.trunc(Number(body.max_file_bytes) || 0)),
        String(body.description || "").slice(0, 200),
        body.allow_upload === false || body.allow_upload === 0 ? 0 : 1,
        now(),
      );
      const created = get("SELECT id FROM drives ORDER BY id DESC LIMIT 1");
      if (body.hidden != null) setHidden(created.id, body.hidden);
      return json(res, { ok: true, id: created.id });
    }
    if (parts[1]) {
      const drive = get("SELECT * FROM drives WHERE id = ?", Number(parts[1]));
      if (!drive) throw Object.assign(new Error("存储不存在"), { status: 404 });
      if (parts[2] === "browse" && method === "GET") {
        const url = new URL(req.url, "http://localhost");
        const dir = url.searchParams.get("path") || "/";
        const driver = driverFor(drive);
        const started = Date.now();
        const list = await driver.list(dir);
        const hidden = hiddenPrefixes(drive.id);
        const mark = (item) => ({
          name: item.name,
          path: item.path,
          isDir: Boolean(item.isDir),
          size: item.size || 0,
          hidden: hidden.some((prefix) => item.path === prefix || String(item.path).startsWith(`${prefix}/`)),
        });
        const entries = list.map(mark);
        return json(res, {
          ok: true,
          path: dir,
          ms: Date.now() - started,
          hidden,
          entries,
        });
      }
      if (parts[2] === "test" && method === "POST") {
        const driver = driverFor(drive);
        const started = Date.now();
        const list = await driver.list(drive.root || "/");
        return json(res, { ok: true, ms: Date.now() - started, sample: list.slice(0, 5) });
      }
      if (parts[2] === "capacity" && method === "POST") {
        const driver = driverFor(drive);
        const started = Date.now();
        let value = null;
        if (typeof driver.capacity === "function") {
          try {
            value = await driver.capacity();
          } catch (error) {
            value = null;
          }
        }
        // 拿到就顺手写进库里，下次进页面直接显示
        if (value?.total) run("UPDATE drives SET quota_bytes = ? WHERE id = ?", Math.max(0, Math.trunc(value.total)), drive.id);
        return json(res, {
          ok: true,
          ms: Date.now() - started,
          supported: Boolean(value),
          total: value?.total || 0,
          free: value?.free || 0,
          quota_bytes: get("SELECT quota_bytes FROM drives WHERE id = ?", drive.id)?.quota_bytes || 0,
        });
      }
      if (method === "POST") {
        const body = await readJson(req);
        // 配置按「补丁」处理：只覆盖提交上来的键，其余原样保留，
        // 避免「保存修改」时把没渲染出来的凭据清空。
        const patch = body.config && typeof body.config === "object" ? tidyConfig(body.config) : null;
        let merged = null;
        if (patch) {
          let existing = {};
          try {
            existing = JSON.parse(drive.config || "{}");
          } catch {
            existing = {};
          }
          merged = JSON.stringify({ ...tidyConfig(existing), ...patch });
        }
        run(
          "UPDATE drives SET name = COALESCE(?, name), config = COALESCE(?, config), root = COALESCE(?, root), mount_path = COALESCE(?, mount_path), enabled = COALESCE(?, enabled), visibility = COALESCE(?, visibility), quota_bytes = COALESCE(?, quota_bytes), max_file_bytes = COALESCE(?, max_file_bytes), description = COALESCE(?, description), allow_upload = COALESCE(?, allow_upload) WHERE id = ?",
          body.name ?? null,
          merged,
          body.root ?? null,
          body.mount_path == null ? null : String(body.mount_path).slice(0, 60),
          body.enabled == null ? null : body.enabled ? 1 : 0,
          body.visibility ? (body.visibility === "public" ? "public" : "members") : null,
          body.quota_bytes == null ? null : Math.max(0, Math.trunc(Number(body.quota_bytes) || 0)),
          body.max_file_bytes == null ? null : Math.max(0, Math.trunc(Number(body.max_file_bytes) || 0)),
          body.description == null ? null : String(body.description).slice(0, 200),
          body.allow_upload == null ? null : body.allow_upload ? 1 : 0,
          drive.id,
        );
        if (body.hidden != null) setHidden(drive.id, body.hidden);
        forgetDriver(drive.id);
        return json(res, { ok: true, hidden: hiddenPrefixes(drive.id) });
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
    if (pathname === "/memories/files") return pageBrowser(req, res, url);
    if (pathname === "/memories/files/raw") {
      try {
        return await rawBrowser(req, res, url);
      } catch (error) {
        return send(res, error.status || 500, error.message || "读取失败");
      }
    }
    if (pathname.startsWith("/memories/admin")) return handleAdmin(req, res, url);
    if (pathname.startsWith("/memories/a/")) return pageDetail(req, res, pathname.slice("/memories/a/".length));
    if (pathname.startsWith("/memories/s/")) {
      const rest = pathname.slice("/memories/s/".length).split("/").filter(Boolean);
      const token = rest[0] || "";
      if (rest[1] === "raw") {
        const { share, gone } = shareLookup(token);
        if (!share || gone) return send(res, gone || 404, "Not Found");
        try {
          return await streamSharePath(req, res, share, url);
        } catch (error) {
          return send(res, error.status || 500, error.message || "读取失败");
        }
      }
      return pageShare(req, res, token, url);
    }
    if (pathname.startsWith("/memories/f/")) {
      const item = get("SELECT * FROM media WHERE id = ?", Number(pathname.slice("/memories/f/".length)));
      if (!item) return send(res, 404, "Not Found");
      const viewer = currentUser(req);
      if (!isAdmin(viewer) && isHidden(item.drive_id, item.path)) return send(res, 404, "Not Found");
      const wantDownload = url.searchParams.get("download") === "1";
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

export { server };
