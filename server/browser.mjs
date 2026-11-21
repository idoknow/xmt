// 前台文件库：所有人可浏览（只读），成员在开放上传的存储里可以上传，管理员可操作全部。
import { all, get, setting } from "./db.mjs";
import { currentUser, isAdmin } from "./auth.mjs";
import { driverFor } from "./drives.mjs";
import { hiddenPrefixes, publicPrefixes, uploadStats, userFolder } from "./media.mjs";
import { filesPage } from "./ui.mjs";
import { html, prettyPath, redirect, send } from "./util.mjs";
import { streamPath } from "./filestream.mjs";

const siteOf = () => ({ title: setting("site.title", "Memories"), intro: setting("site.intro", "") });

function visibleDrives(user) {
  return all("SELECT * FROM drives WHERE enabled = 1 ORDER BY id").filter(
    (drive) => Boolean(user) || drive.visibility === "public",
  );
}

function hiddenFor(drive, user) {
  return isAdmin(user) ? [] : hiddenPrefixes(drive.id);
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

  const driver = driverFor(drive);
  let entries = [];
  let error = "";
  try {
    const list = await driver.list(currentPath);
    const hidden = hiddenFor(drive, user);
    entries = list
      .filter((entry) => !isHiddenPath(hidden, entry.path))
      .filter((entry) => !area.length || isOutsidePublic(area, entry.path) === false)
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh-Hans-CN"));
  } catch (problem) {
    error = problem.message || "读取目录失败";
  }

  html(
    res,
    error ? 500 : 200,
    filesPage({
      site: siteOf(),
      user,
      drives,
      drive,
      path: currentPath,
      entries,
      stats,
      mine: mineStats,
      canManage: Boolean(user),
      rootLabel: mine ? "我的文件" : "媒体库",
      strip: mine,
      error,
    }),
  );
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
