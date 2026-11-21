// 前台文件库：所有人可浏览（只读），成员在开放上传的存储里可以上传，管理员可操作全部。
import { all, get, setting } from "./db.mjs";
import { currentUser, isAdmin } from "./auth.mjs";
import { driverFor } from "./drives.mjs";
import { hiddenPrefixes, publicPrefixes } from "./media.mjs";
import { browsePage } from "./ui.mjs";
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

function isOutside(prefixes, target) {
  if (!prefixes.length) return false;
  return !prefixes.some((prefix) => target === prefix || String(target).startsWith(`${prefix}/`));
}

export async function pageBrowser(req, res, url) {
  const user = currentUser(req);
  const drives = visibleDrives(user);
  const wanted = Number(url.searchParams.get("drive"));
  const drive = drives.find((item) => item.id === wanted) || drives[0] || null;
  const currentPath = url.searchParams.get("path") || "/";

  if (!drive) {
    html(res, 200, browsePage({ site: siteOf(), user, drives: [], drive: null, path: "/", entries: [], pretty: "/" }));
    return;
  }

  const driver = driverFor(drive);
  const area = publicFor(drive, user);
  if (currentPath !== "/" && isOutside(area, currentPath)) {
    html(res, 404, browsePage({ site: siteOf(), user, drives, drive, path: "/", entries: [], error: "这个目录没有开放。", pretty: "/" }));
    return;
  }

  let entries = [];
  let error = "";
  let pretty = currentPath;
  try {
    const list = await driver.list(currentPath);
    const prefixes = hiddenFor(drive, user);
    entries = list.filter((entry) => !isHiddenPath(prefixes, entry.path) && !isOutside(area, entry.path));
    pretty = await prettyPath(driver, currentPath).catch(() => currentPath);
  } catch (problem) {
    error = `读取目录失败：${problem.message}`;
  }

  html(
    res,
    200,
    browsePage({
      site: siteOf(),
      user,
      drives,
      drive,
      path: currentPath,
      pretty,
      entries,
      error,
      limit: drive.max_file_bytes ? `单个文件 ≤ ${(drive.max_file_bytes / 1024 ** 3).toFixed(1)} GB（这份存储自己的上限）` : "",
      canUpload: Boolean(user) && (isAdmin(user) || Boolean(drive.allow_upload)),
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
