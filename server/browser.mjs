// 前台文件库：所有人可浏览（只读），成员在开放上传的存储里可以上传，管理员可操作全部。
import { all, get, setting } from "./db.mjs";
import { currentUser, isAdmin } from "./auth.mjs";
import { driverFor } from "./drives.mjs";
import { hiddenPrefixes } from "./media.mjs";
import { browsePage } from "./ui.mjs";
import { html, redirect, send } from "./util.mjs";
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

export async function pageBrowser(req, res, url) {
  const user = currentUser(req);
  const drives = visibleDrives(user);
  const wanted = Number(url.searchParams.get("drive"));
  const drive = drives.find((item) => item.id === wanted) || drives[0] || null;
  const currentPath = url.searchParams.get("path") || "/";

  if (!drive) {
    html(res, 200, browsePage({ site: siteOf(), user, drives: [], drive: null, path: "/", entries: [] }));
    return;
  }

  let entries = [];
  let error = "";
  try {
    const list = await driverFor(drive).list(currentPath);
    const prefixes = hiddenFor(drive, user);
    entries = list.filter((entry) => !isHiddenPath(prefixes, entry.path));
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
      entries,
      error,
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

  const download = url.searchParams.get("download") === "1";
  return streamPath(req, res, { drive, target, download });
}
