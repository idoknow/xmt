// 图片/视频的业务层：命名、权限、入库、查询。
import { createHash } from "node:crypto";
import { stat, unlink } from "node:fs/promises";
import path from "node:path";
import { all, get, now, run } from "./db.mjs";
import { config } from "./config.mjs";
import { driverFor } from "./drives.mjs";
import { imageSize } from "./imgsize.mjs";
import { mimeOf } from "./util.mjs";
import { ensuredUserFolder } from "./auth.mjs";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".bmp", ".tiff"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);

/* ---------- 隐藏目录 ---------- */
// drive_hidden 里存的是「路径前缀」，命中该目录及其所有子路径的记录对外不显示（管理员不受限）。
export const HIDDEN_SQL =
  "NOT EXISTS (SELECT 1 FROM drive_hidden h WHERE h.drive_id = m.drive_id AND (m.path = h.prefix OR m.path LIKE h.prefix || '/%'))";

export const hiddenPrefixes = (driveId) =>
  all("SELECT prefix FROM drive_hidden WHERE drive_id = ? ORDER BY prefix", driveId).map((row) => row.prefix);

export const isHidden = (driveId, filePath) => {
  if (!driveId || !filePath) return false;
  const hit = get(
    "SELECT 1 AS hit FROM drive_hidden WHERE drive_id = ? AND (prefix = ? OR ? LIKE prefix || '/%') LIMIT 1",
    driveId,
    filePath,
    filePath,
  );
  return Boolean(hit);
};

export const setHidden = (driveId, prefixes) => {
  const list = [...new Set((Array.isArray(prefixes) ? prefixes : String(prefixes || "").split(/\r?\n/))
    .map((item) => String(item).trim().replace(/\/+$/, ""))
    .filter((item) => item && item !== "/")
    .map((item) => (item.startsWith("/") ? item : `/${item}`)))];
  run("DELETE FROM drive_hidden WHERE drive_id = ?", driveId);
  for (const prefix of list) run("INSERT INTO drive_hidden (drive_id, prefix) VALUES (?, ?)", driveId, prefix);
  return list;
};

/* ---------- 前台可操作区 ---------- */
// drive_public 里存「允许前台浏览的前缀」。一个存储没有任何记录时视为「全部可浏览」，
// 一旦管理员挑了目录，就只显示这些前缀（加上它们的子目录）。
const normalizePrefixes = (prefixes) =>
  [...new Set(
    (Array.isArray(prefixes) ? prefixes : String(prefixes || "").split(/\r?\n/))
      .map((item) => String(item).trim().replace(/\/+$/, ""))
      .filter((item) => item && item !== "/")
      .map((item) => (item.startsWith("/") ? item : `/${item}`)),
  )];

export const publicPrefixes = (driveId) =>
  all("SELECT prefix FROM drive_public WHERE drive_id = ? ORDER BY prefix", driveId).map((row) => row.prefix);

export const isPublicPath = (driveId, filePath) => {
  if (!driveId || !filePath) return true;
  const prefixes = publicPrefixes(driveId);
  if (!prefixes.length) return true;
  return prefixes.some((prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`));
};

export const setPublic = (driveId, prefixes) => {
  const list = normalizePrefixes(prefixes);
  run("DELETE FROM drive_public WHERE drive_id = ?", driveId);
  for (const prefix of list) run("INSERT INTO drive_public (drive_id, prefix) VALUES (?, ?)", driveId, prefix);
  return list;
};

export const kindOf = (name) => {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return "file";
};

export const safeName = (name) => {
  const base = String(name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 160) || "file";
};

const uniqueName = async (driver, dir, name) => {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let index = 1; index < 200; index += 1) {
    const candidate = index === 1 ? name : `${stem}-${index}${ext}`;
    const existing = await driver.stat(`${dir}/${candidate}`);
    if (!existing) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
};

export function canWrite(user, media) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "owner") return true;
  return media.owner_id === user.id;
}

export const userFolder = (user) => ensuredUserFolder(user) || `u-${user.id}`;

/** 用户上传：只能进自己的文件夹；管理员可以指定任意目录 */
export async function upload({ user, drive, folder, files }) {
  const driver = driverFor(drive);
  const isAdmin = user.role === "admin" || user.role === "owner";
  if (!isAdmin && !drive?.allow_upload) {
    throw Object.assign(new Error("这份存储没有开放上传"), { status: 403 });
  }
  const month = new Date().toISOString().slice(0, 7);
  const baseDir = isAdmin ? folder || `admin/${month}` : `${userFolder(user)}/${month}`;
  await driver.ensureDir(baseDir);

  const saved = [];
  const rejected = [];

  for (const file of files) {
    const kind = kindOf(file.filename);
    const size = file.size;
    const byRole = isAdmin ? config.limits.admin : kind === "image" ? config.limits.userImage : config.limits.userVideo;
    // 存储自己配了单文件上限就用它的（管理员可在存储里手动设置，未设则为 0 = 跟随角色默认）
    const own = Number(drive?.max_file_bytes) || 0;
    const limit = own > 0 ? own : byRole;
    if (!isAdmin && kind === "file") {
      rejected.push({ name: file.filename, reason: "只能上传照片和视频" });
      await unlink(file.path).catch(() => {});
      continue;
    }
    if (size > limit) {
      const mb = limit / 1024 / 1024;
      rejected.push({ name: file.filename, reason: `超过 ${mb >= 1024 ? `${(mb / 1024).toFixed(0)}GB` : `${Math.round(mb)}MB`}` });
      await unlink(file.path).catch(() => {});
      continue;
    }

    const dir = isAdmin ? baseDir : baseDir;
    const name = await uniqueName(driver, dir, safeName(file.filename));
    const target = `${dir === "/" ? "" : dir}/${name}`;
    await driver.write(target, { filePath: file.path, size });

    let width = null;
    let height = null;
    let sha256 = null;
    if (kind === "image") {
      const dims = await imageSize(file.path);
      width = dims?.width ?? null;
      height = dims?.height ?? null;
      if (size <= 64 * 1024 * 1024) {
        const hash = createHash("sha256");
        const { createReadStream } = await import("node:fs");
        await new Promise((resolve, reject) => {
          createReadStream(file.path)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", resolve)
            .on("error", reject);
        });
        sha256 = hash.digest("hex");
      }
    }
    await unlink(file.path).catch(() => {});

    run(
      `INSERT INTO media (drive_id, path, name, ext, mime, kind, size, width, height, sha256, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(drive_id, path) DO UPDATE SET size = excluded.size, sha256 = excluded.sha256`,
      drive.id,
      target,
      name,
      path.extname(name).toLowerCase(),
      mimeOf(name),
      kind,
      size,
      width,
      height,
      sha256,
      user.id,
      now(),
    );
    saved.push(get("SELECT * FROM media WHERE drive_id = ? AND path = ?", drive.id, target));
  }

  return { saved, rejected };
}

/** 查询：默认全部；各过滤条件按需叠加 */
export function queryMedia({ q, kind, owner, driveId, sort = "new", limit = 200, offset = 0, excludeHidden = false } = {}) {
  const where = ["1 = 1"];
  const args = [];
  if (q) {
    where.push("(m.name LIKE ? OR m.note LIKE ? OR m.tags LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (kind && kind !== "all") {
    where.push("m.kind = ?");
    args.push(kind);
  }
  if (owner) {
    where.push("m.owner_id = ?");
    args.push(owner);
  }
  if (driveId) {
    where.push("m.drive_id = ?");
    args.push(driveId);
  }
  if (excludeHidden) where.push(HIDDEN_SQL);
  const order =
    sort === "old" ? "m.created_at ASC" : sort === "name" ? "m.name COLLATE NOCASE ASC" : sort === "size" ? "m.size DESC" : "m.created_at DESC";
  return all(
    `SELECT m.*, u.name AS owner_name, u.qq AS owner_qq, d.name AS drive_name, d.driver AS drive_driver
     FROM media m LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN drives d ON d.id = m.drive_id
     WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...args,
    Math.min(Number(limit) || 200, 500),
    Number(offset) || 0,
  );
}

export const countMedia = ({ q, kind, owner, excludeHidden = false } = {}) => {
  const where = ["1 = 1"];
  const args = [];
  if (q) {
    where.push("(name LIKE ? OR note LIKE ? OR tags LIKE ?)");
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (kind && kind !== "all") {
    where.push("kind = ?");
    args.push(kind);
  }
  if (owner) {
    where.push("owner_id = ?");
    args.push(owner);
  }
  if (excludeHidden) where.push(HIDDEN_SQL.replace(/m\./g, ""));
  return get(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM media WHERE ${where.join(" AND ")}`, ...args);
};

export const stats = () => {
  const total = get("SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM media");
  const images = get("SELECT COUNT(*) AS n FROM media WHERE kind = 'image'");
  const videos = get("SELECT COUNT(*) AS n FROM media WHERE kind = 'video'");
  const users = get("SELECT COUNT(*) AS n FROM users");
  const drives = get("SELECT COUNT(*) AS n FROM drives");
  const shares = get("SELECT COUNT(*) AS n FROM shares");
  return { total, images, videos, users, drives, shares };
};

export async function removeMedia(user, media) {
  if (!canWrite(user, media)) throw Object.assign(new Error("只能删除自己上传的内容"), { status: 403 });
  const drive = get("SELECT * FROM drives WHERE id = ?", media.drive_id);
  if (drive) {
    try {
      await driverFor(drive).remove(media.path);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  run("DELETE FROM media WHERE id = ?", media.id);
}

export async function moveMedia(user, media, destination) {
  if (!canWrite(user, media)) throw Object.assign(new Error("只能移动自己上传的内容"), { status: 403 });
  const drive = get("SELECT * FROM drives WHERE id = ?", media.drive_id);
  const driver = driverFor(drive);
  const target = await driver.move(media.path, destination);
  run("UPDATE media SET path = ? WHERE id = ?", target, media.id);
  return get("SELECT * FROM media WHERE id = ?", media.id);
}

export async function renameMedia(user, media, newName) {
  if (!canWrite(user, media)) throw Object.assign(new Error("只能改名自己上传的内容"), { status: 403 });
  const drive = get("SELECT * FROM drives WHERE id = ?", media.drive_id);
  const driver = driverFor(drive);
  const clean = safeName(newName);
  const target = await driver.rename(media.path, clean);
  run("UPDATE media SET path = ?, name = ?, ext = ?, mime = ?, kind = ? WHERE id = ?", target, clean, path.extname(clean).toLowerCase(), mimeOf(clean), kindOf(clean), media.id);
  return get("SELECT * FROM media WHERE id = ?", media.id);
}

export const updateMeta = (media, { note, tags, takenAt }) => {
  run(
    "UPDATE media SET note = COALESCE(?, note), tags = COALESCE(?, tags), taken_at = COALESCE(?, taken_at) WHERE id = ?",
    note ?? null,
    tags ?? null,
    takenAt ?? null,
    media.id,
  );
  return get("SELECT * FROM media WHERE id = ?", media.id);
};

export async function duplicateMedia(user, media) {
  const drive = get("SELECT * FROM drives WHERE id = ?", media.drive_id);
  const driver = driverFor(drive);
  const dir = media.path.replace(/\/[^/]+$/, "");
  const copyTarget = await driver.copy(media.path, dir);
  run(
    `INSERT INTO media (drive_id, path, name, ext, mime, kind, size, width, height, sha256, owner_id, note, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    media.drive_id,
    copyTarget,
    copyTarget.split("/").pop(),
    media.ext,
    media.mime,
    media.kind,
    media.size,
    media.width,
    media.height,
    media.sha256,
    user.id,
    media.note,
    media.tags,
    now(),
  );
  return get("SELECT * FROM media WHERE drive_id = ? AND path = ?", media.drive_id, copyTarget);
}
