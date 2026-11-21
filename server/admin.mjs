// AList 风格管理台的后端：/memories/admin/*
// 页面：文件 / 存储 / 成员 / 设置；文件页的文件操作走 JSON 接口，上传走 multipart。
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { stat as fsStat } from "node:fs/promises";
import { all, audit, get, run, setting } from "./db.mjs";
import { config, paths } from "./config.mjs";
import { allUsers, currentUser, isAdmin } from "./auth.mjs";
import { driverFor, forgetDriver } from "./drives.mjs";
import { hiddenPrefixes, setHidden, stats, upload } from "./media.mjs";
import { parseMultipart } from "./multipart.mjs";
import { escapeHtml, html, mimeOf, readJson, redirect, send, sendFile, sendJson } from "./util.mjs";
import { adminFilesPage, adminSettingsPage, adminStoragesPage, adminUsersPage } from "./admin-ui.mjs";

const siteOf = () => ({ title: setting("site.title", "Memories"), intro: setting("site.intro", "") });

const drivesAll = () => all("SELECT * FROM drives ORDER BY sort_order, id").map((drive) => ({ ...drive, hidden: hiddenPrefixes(drive.id) }));

const driveOf = (id) => {
  const drive = get("SELECT * FROM drives WHERE id = ?", Number(id));
  if (!drive) throw Object.assign(new Error("存储不存在"), { status: 404 });
  return drive;
};

const cleanDir = (input) => {
  const raw = String(input || "/").trim() || "/";
  if (raw === "/") return "/";
  return `/${raw.split("/").filter((part) => part && part !== "." && part !== "..").join("/")}`;
};

const parentOf = (target) => {
  const trimmed = String(target || "").replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
};

const nameOf = (target) => String(target || "").split("/").filter(Boolean).pop() || "";

const listOf = (value) => (Array.isArray(value) ? value : []).map(String).filter(Boolean);

/* ---------- 页面 ---------- */

const SORT_KEYS = new Set(["name", "size", "time"]);

const sortEntries = (entries, key, dir) => {
  const sign = dir === "desc" ? -1 : 1;
  const pick = (entry) => {
    if (key === "size") return Number(entry.size) || 0;
    if (key === "time") return entry.modified ? new Date(entry.modified).getTime() || 0 : 0;
    return String(entry.name || "");
  };
  return [...entries].sort((a, b) => {
    if (Boolean(a.isDir) !== Boolean(b.isDir)) return a.isDir ? -1 : 1;
    const left = pick(a);
    const right = pick(b);
    if (typeof left === "number" && typeof right === "number") return (left - right) * sign;
    return String(left).localeCompare(String(right), "zh-Hans-CN") * sign;
  });
};

function pageFiles(req, res, url) {
  const user = currentUser(req);
  const drives = drivesAll();
  const driveId = Number(url.searchParams.get("drive")) || drives[0]?.id || 0;
  const drive = drives.find((item) => item.id === driveId) || null;
  const currentPath = cleanDir(url.searchParams.get("path"));
  const notice = url.searchParams.get("notice") || "";
  const error = url.searchParams.get("error") || "";
  const sortKey = SORT_KEYS.has(url.searchParams.get("sort")) ? url.searchParams.get("sort") : "name";
  const sortDir = url.searchParams.get("dir") === "desc" ? "desc" : "asc";

  if (!drive) {
    return html(
      res,
      200,
      adminFilesPage({ site: siteOf(), user, drives, drive: null, path: "/", entries: [], notice, error, sortKey, sortDir }),
    );
  }

  return driverFor(drive)
    .list(currentPath)
    .then((list) => {
      const entries = sortEntries(list, sortKey, sortDir);
      html(
        res,
        200,
        adminFilesPage({ site: siteOf(), user, drives, drive, path: currentPath, entries, notice, error, sortKey, sortDir }),
      );
    })
    .catch((problem) => {
      html(
        res,
        200,
        adminFilesPage({
          site: siteOf(),
          user,
          drives,
          drive,
          path: currentPath,
          entries: [],
          notice,
          error: `读取目录失败：${problem.message}`,
          sortKey,
          sortDir,
        }),
      );
    });
}

function backTo(driveId, dir, patch = {}) {
  const params = new URLSearchParams({ drive: String(driveId), path: dir, ...patch });
  return `/memories/admin/files?${params.toString()}`;
}

/* ---------- 文件操作 ---------- */

async function fileAction(req, res) {
  const user = currentUser(req);
  const body = await readJson(req, 64 * 1024);
  const drive = driveOf(body.drive);
  const driver = driverFor(drive);
  const action = String(body.action || "");
  const cwd = cleanDir(body.path);

  if (action === "mkdir") {
    const full = String(body.target || body.path || "");
    const name = String(body.name || "").trim() || (full.split("/").filter(Boolean).pop() || "");
    if (!name) throw Object.assign(new Error("目录名不能为空"), { status: 400 });
    const base = body.name ? cwd : parentOf(full || cwd);
    const created = await driver.ensureDir(`${base === "/" ? "" : base}/${name}`);
    audit(user.id, "mkdir", `${drive.name}:${created}`, req.socket.remoteAddress);
    return sendJson(res, 200, { ok: true, path: created });
  }

  if (action === "rename") {
    const target = String(body.target || body.path || "");
    const name = String(body.name || "").trim();
    if (!target || !name) throw Object.assign(new Error("缺少路径或新名字"), { status: 400 });
    const moved = await driver.rename(target, name);
    run(
      "UPDATE media SET path = ?, name = ? WHERE drive_id = ? AND path = ?",
      moved,
      name,
      drive.id,
      target,
    );
    audit(user.id, "rename", `${drive.name}:${target} → ${name}`, req.socket.remoteAddress);
    return sendJson(res, 200, { ok: true, path: moved });
  }

  if (action === "move" || action === "copy") {
    const targets = listOf(body.targets ?? body.paths);
    const dest = cleanDir(body.dest ?? body.to ?? "/");
    if (!targets.length) throw Object.assign(new Error("先选中要处理的内容"), { status: 400 });
    const done = [];
    for (const target of targets) {
      if (parentOf(target) === dest) continue;
      const result = await driver[action](target, dest);
      if (action === "move") {
        run("UPDATE media SET path = ? WHERE drive_id = ? AND path = ?", result, drive.id, target);
      }
      done.push(result);
    }
    audit(user.id, action, `${drive.name}: ${done.length} 项 → ${dest}`, req.socket.remoteAddress);
    return sendJson(res, 200, { ok: true, done });
  }

  if (action === "remove") {
    const targets = listOf(body.targets ?? body.paths);
    if (!targets.length) throw Object.assign(new Error("先选中要删除的内容"), { status: 400 });
    for (const target of targets) {
      await driver.remove(target);
      run("DELETE FROM media WHERE drive_id = ? AND (path = ? OR path LIKE ?)", drive.id, target, `${target}/%`);
    }
    audit(user.id, "remove", `${drive.name}: ${targets.length} 项`, req.socket.remoteAddress);
    return sendJson(res, 200, { ok: true, removed: targets.length });
  }

  throw Object.assign(new Error(`未知操作：${action}`), { status: 400 });
}

async function fileUpload(req, res) {
  const user = currentUser(req);
  const contentType = String(req.headers["content-type"] || "");
  const boundary =
    /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] || /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  const { fields, files } = await parseMultipart(req, {
    boundary,
    dir: path.join(paths.files, "tmp"),
    limit: config.limits.admin + 64 * 1024 * 1024,
  });
  if (!files.length) throw Object.assign(new Error("没有收到文件"), { status: 400 });
  const drive = driveOf(fields.drive);
  const folder = cleanDir(fields.path);
  const result = await upload({ user, drive, folder: folder === "/" ? "" : folder, files });
  audit(user.id, "upload", `${drive.name}:${folder} ${result.saved.length} 个文件`, req.socket.remoteAddress);
  sendJson(res, 200, { ok: true, saved: result.saved, rejected: result.rejected });
}

async function fileRaw(req, res, url) {
  const drive = driveOf(url.searchParams.get("drive"));
  const target = String(url.searchParams.get("path") || "");
  if (!target) throw Object.assign(new Error("缺少文件路径"), { status: 400 });
  const download = url.searchParams.get("download") === "1";
  const downloadAs = download ? nameOf(target) : undefined;

  if (drive.driver === "local") {
    const driver = driverFor(drive);
    const filePath = await driver.filePath(target);
    const info = await fsStat(filePath);
    if (info.isDirectory()) throw Object.assign(new Error("这是目录"), { status: 400 });
    return sendFile(req, res, filePath, {
      mime: mimeOf(target),
      cache: "private, max-age=300",
      downloadAs,
    });
  }

  const driver = driverFor(drive);
  const remote = await driver.download(target);
  const headers = {
    "content-type": remote.mime || mimeOf(target),
    "cache-control": "private, max-age=300",
  };
  if (remote.size && !remote.encoding) headers["content-length"] = String(remote.size);
  if (downloadAs) {
    headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadAs)}`;
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    remote.stream?.cancel?.();
    return res.end();
  }
  try {
    await pipeline(remote.stream, res);
  } catch (error) {
    console.error("[memories] 管理台下载中断", error.message);
    if (!res.writableEnded) res.destroy(error);
  }
}

function pageStorages(req, res) {
  const user = currentUser(req);
  html(res, 200, adminStoragesPage({ site: siteOf(), user, drives: drivesAll() }));
}

function pageUsers(req, res) {
  const user = currentUser(req);
  html(res, 200, adminUsersPage({ site: siteOf(), user, users: allUsers() }));
}

function pageSettings(req, res) {
  const user = currentUser(req);
  html(
    res,
    200,
    adminSettingsPage({
      site: siteOf(),
      user,
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

/* ---------- 入口 ---------- */

export async function handleAdmin(req, res, url) {
  try {
    return await routeAdmin(req, res, url);
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (res.headersSent) return res.end();
    if (url.pathname.endsWith("/action") || url.pathname.endsWith("/upload")) {
      return sendJson(res, status, { ok: false, error: error?.message || "后台操作失败" });
    }
    return html(
      res,
      status,
      `<!doctype html><meta charset="utf-8"><title>出错了</title><p>${escapeHtml(error?.message || "后台操作失败")}</p><p><a href="/memories/admin/files">回到文件</a></p>`,
    );
  }
}

async function routeAdmin(req, res, url) {
  const user = currentUser(req);
  if (!user) return redirect(res, "/memories/login");
  if (!isAdmin(user)) {
    return html(res, 403, `<!doctype html><meta charset="utf-8"><title>403</title><p>只有管理员能进后台。</p>`);
  }

  const pathname = url.pathname;
  const method = req.method;

  if (pathname === "/memories/admin") return redirect(res, "/memories/admin/files");
  if (pathname === "/memories/admin/files") return pageFiles(req, res, url);
  if (pathname === "/memories/admin/storages") return pageStorages(req, res);
  if (pathname === "/memories/admin/users") return pageUsers(req, res);
  if (pathname === "/memories/admin/settings") return pageSettings(req, res);

  if (pathname === "/memories/admin/files/action" && method === "POST") return fileAction(req, res);
  if (pathname === "/memories/admin/files/upload" && method === "POST") return fileUpload(req, res);
  if (pathname === "/memories/admin/files/raw") return fileRaw(req, res, url);

  return html(res, 404, `<!doctype html><meta charset="utf-8"><p>没有这个后台页面：${pathname}</p>`);
}
