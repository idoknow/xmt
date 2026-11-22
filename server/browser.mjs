// 前台文件库：所有人可浏览（只读），成员在开放上传的存储里可以上传，管理员可操作全部。
import { all, get, setting } from "./db.mjs";
import { currentUser, isAdmin } from "./auth.mjs";
import { driverFor } from "./drives.mjs";
import { hiddenPrefixes, publicPrefixes, uploadStats, userFolder } from "./media.mjs";
import { filesPage } from "./ui.mjs";
import { html, prettyPath, redirect, send, sendJson } from "./util.mjs";
import { streamPath } from "./filestream.mjs";

const siteOf = () => ({ title: setting("site.title", "Memories"), intro: setting("site.intro", "") });

function visibleDrives(user) {
  return all("SELECT * FROM drives WHERE enabled = 1 ORDER BY id").filter(
    (drive) => Boolean(user) || drive.visibility === "public",
  );
}

// 隐藏对所有人（含管理员）生效：前台/媒体库看不到，后台仍然看得到并能恢复。
function hiddenFor(drive, user) {
  return hiddenPrefixes(drive.id);
}

function isHiddenPath(prefixes, target) {
  return prefixes.some((prefix) => target === prefix || String(target).startsWith(`${prefix}/`));
}

// 前台可操作区：管理员挑过目录就只显示这些前缀；没挑过等于全部可见。
function publicFor(drive, user) {
  return isAdmin(user) ? [] : publicPrefixes(drive.id);
}

function isOutsidePublic(prefixes, target) {
  if (!prefixes.length) return false;
  return !prefixes.some((prefix) => target === prefix || String(target).startsWith(`${prefix}/`));
}

function isOutside(prefixes, target) {
  if (!prefixes.length) return false;
  return !prefixes.some((prefix) => target === prefix || String(target).startsWith(`${prefix}/`));
}

async function listEntries(drive, user, currentPath) {
  const driver = driverFor(drive);
  const hidden = hiddenFor(drive, user);
  const area = publicFor(drive, user);
  const list = await driver.list(currentPath);
  return list
    .filter((entry) => !isHiddenPath(hidden, entry.path))
    .filter((entry) => !area.length || isOutsidePublic(area, entry.path) === false)
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export async function pageBrowser(req, res, url) {
  const user = currentUser(req);
  const drives = visibleDrives(user);
  const wanted = Number(url.searchParams.get("drive"));
  const drive = drives.find((item) => item.id === wanted) || drives[0] || null;
  const mine = isAdmin(user) ? "" : user ? userFolder(user) : "";
  const currentPath = url.searchParams.get("path") || (mine || "/");
  const stats = uploadStats().global || { files: 0, bytes: 0 };
  const mineStats = user
    ? get("SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM media WHERE owner_id = ?", user.id)
    : null;

  if (!drive) {
    html(res, 200, filesPage({ site: siteOf(), user, drives: [], drive: null, path: "/", entries: [], stats, mine: mineStats }));
    return;
  }

  const deny = (message, status = 404) =>
    html(
      res,
      status,
      filesPage({
        site: siteOf(),
        user,
        drives,
        drive,
        path: "/",
        entries: [],
        stats,
        mine: mineStats,
        canManage: Boolean(user),
        rootLabel: mine ? "我的文件" : "媒体库",
        error: message,
      }),
    );

  if (mine && !(currentPath === mine || String(currentPath).startsWith(`${mine}/`))) {
    return deny("这里是你自己的目录，上面的路径不在范围内。", 403);
  }
  const area = publicFor(drive, user);
  if (currentPath !== "/" && isOutside(area, currentPath)) return deny("这个目录没有开放。");
  // 隐藏目录对所有人（含管理员）都当作不存在，避免直接猜路径打开
  if (currentPath !== "/" && isHiddenPath(hiddenFor(drive, user), currentPath)) return deny("这个目录没有开放。");

  html(
    res,
    200,
    filesPage({
      site: siteOf(),
      user,
      drives,
      drive,
      path: currentPath,
      entries: null,
      stats,
      mine: mineStats,
      canManage: Boolean(user),
      rootLabel: mine ? "我的文件" : "媒体库",
      strip: mine,
    }),
  );
}

// 目录内容单独取，页面先把骨架画出来再慢慢填。
export async function filesList(req, res, url) {
  const user = currentUser(req);
  const drive = get("SELECT * FROM drives WHERE id = ? AND enabled = 1", Number(url.searchParams.get("drive")));
  if (!drive) return sendJson(res, 404, { ok: false, error: "存储不存在" });
  if (!user && drive.visibility !== "public") return sendJson(res, 401, { ok: false, error: "先登录" });

  const mine = isAdmin(user) ? "" : user ? userFolder(user) : "";
  const currentPath = url.searchParams.get("path") || (mine || "/");
  if (mine && !(currentPath === mine || String(currentPath).startsWith(`${mine}/`))) {
    return sendJson(res, 403, { ok: false, error: "这里是你自己的目录" });
  }
  const area = publicFor(drive, user);
  if (currentPath !== "/" && isOutside(area, currentPath)) return sendJson(res, 403, { ok: false, error: "这个目录没有开放" });
  if (currentPath !== "/" && isHiddenPath(hiddenFor(drive, user), currentPath)) {
    return sendJson(res, 404, { ok: false, error: "这个目录没有开放" });
  }

  try {
    const entries = await listEntries(drive, user, currentPath);
    return sendJson(res, 200, {
      ok: true,
      path: currentPath,
      canManage: Boolean(user),
      entries: entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        isDir: Boolean(entry.isDir),
        size: entry.size || 0,
        modified: entry.modified || null,
      })),
    });
  } catch (problem) {
    return sendJson(res, problem.status || 500, { ok: false, error: problem.message || "读取目录失败" });
  }
}

export async function rawBrowser(req, res, url) {
  const user = currentUser(req);
  const drive = get("SELECT * FROM drives WHERE id = ? AND enabled = 1", Number(url.searchParams.get("drive")));
  const target = url.searchParams.get("path") || "";
  if (!drive || !target) return send(res, 404, "文件不在了");
  if (!user && drive.visibility !== "public") return redirect(res, "/memories/login");
  if (isHiddenPath(hiddenFor(drive, user), target)) return send(res, 404, "文件不在了");
  if (isOutside(publicFor(drive, user), target)) return send(res, 404, "文件不在了");

  const download = url.searchParams.get("download") === "1";
  return streamPath(req, res, { drive, target, download });
}
