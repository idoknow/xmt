// 分块上传：先 init 拿 uploadId 与块大小，再并发 PUT 各块，最后 complete 落库。
// 块文件落在 data/tmp/uploads/<uploadId>/，complete 时顺序拼成 data.bin 再交给 media.upload()。
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { config } from "./config.mjs";
import { get } from "./db.mjs";
import { driverFor } from "./drives.mjs";
import { kindOf, upload } from "./media.mjs";
import { readJson, sendJson } from "./util.mjs";

const CHUNK = 8 * 1024 * 1024;
const ROOT = path.join(config.dataDir, "tmp", "uploads");
const dirOf = (id) => path.join(ROOT, id);
const metaOf = (id) => path.join(ROOT, id, "meta.json");

const fail = (status, message) => Object.assign(new Error(message), { status });

async function readMeta(id) {
  try {
    return JSON.parse(await fsp.readFile(metaOf(id), "utf8"));
  } catch {
    return null;
  }
}

async function writeMeta(id, meta) {
  await fsp.writeFile(metaOf(id), JSON.stringify(meta), "utf8");
}

function limitFor(user, name, drive = null) {
  const kind = kindOf(name);
  let limit;
  if (user.role === "admin" || user.role === "owner") limit = config.limits.admin;
  else if (kind === "image") limit = config.limits.userImage;
  else if (kind === "video") limit = config.limits.userVideo;
  else return { kind, limit: 0 };
  const own = Number(drive?.max_file_bytes) || 0;
  return { kind, limit: own > 0 ? own : limit };
}

async function initUpload(req, res, user) {
  const body = await readJson(req);
  const driveId = Number(body.drive);
  const drive = get("SELECT * FROM drives WHERE id = ?", driveId);
  if (!drive) throw fail(404, "存储不存在");
  if (!drive.allow_upload && user.role === "user") throw fail(403, "这份存储没有开放上传");

  const name = String(body.name || "").trim();
  const size = Number(body.size) || 0;
  const folder = String(body.folder || "/");
  if (!name) throw fail(400, "缺少文件名");
  if (size <= 0) throw fail(400, "文件是空的");

  const { kind, limit } = limitFor(user, name, drive);
  if (!limit) throw fail(400, "只能上传照片和视频");
  if (size > limit) {
    const mb = limit / 1024 / 1024;
    throw fail(413, `单个文件不能超过 ${mb >= 1024 ? `${(mb / 1024).toFixed(0)}GB` : `${Math.round(mb)}MB`}`);
  }

  const fingerprint = [drive.id, folder, name, size, user.id].join("|");
  let id = "";
  let uploaded = [];
  try {
    const dirs = await fsp.readdir(ROOT, { withFileTypes: true });
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const meta = await readMeta(entry.name);
      if (!meta || meta.fingerprint !== fingerprint || meta.done) continue;
      const ready = (await fsp.readdir(dirOf(entry.name))).filter((file) => file.endsWith(".part"));
      if (!ready.length) continue;
      id = entry.name;
      uploaded = ready.map((file) => Number(file.replace(".part", ""))).filter((n) => Number.isInteger(n));
      break;
    }
  } catch {}

  if (!id) {
    id = randomBytes(9).toString("hex");
    await fsp.mkdir(dirOf(id), { recursive: true });
    await writeMeta(id, {
      id,
      driveId: drive.id,
      driveName: drive.name,
      folder,
      name,
      size,
      type: String(body.type || ""),
      kind,
      userId: user.id,
      fingerprint,
      chunkSize: CHUNK,
      chunks: Math.ceil(size / CHUNK),
      createdAt: new Date().toISOString(),
      done: false,
    });
  }

  return sendJson(res, 200, { ok: true, id, chunkSize: CHUNK, chunks: Math.ceil(size / CHUNK), uploaded });
}

async function status(req, res, user, id) {
  const meta = await readMeta(id);
  if (!meta) throw fail(404, "这次上传已经过期，重新传一次吧");
  if (meta.userId !== user.id && user.role !== "admin") throw fail(403, "这不是你的上传");
  let uploaded = [];
  try {
    uploaded = (await fsp.readdir(dirOf(id))).filter((file) => file.endsWith(".part")).map((file) => Number(file.replace(".part", "")));
  } catch {}
  return sendJson(res, 200, {
    ok: true,
    id,
    chunkSize: meta.chunkSize,
    chunks: meta.chunks,
    size: meta.size,
    name: meta.name,
    done: meta.done,
    uploaded: uploaded.filter((n) => Number.isInteger(n)).sort((a, b) => a - b),
  });
}

async function putChunk(req, res, user, id, index) {
  const meta = await readMeta(id);
  if (!meta) throw fail(404, "这次上传已经过期，重新传一次吧");
  if (meta.userId !== user.id && user.role !== "admin") throw fail(403, "这不是你的上传");
  if (!Number.isInteger(index) || index < 0 || index >= meta.chunks) throw fail(400, "块序号不对");

  const start = index * meta.chunkSize;
  const expected = Math.min(meta.chunkSize, meta.size - start);
  const file = path.join(dirOf(id), `${index}.part`);

  let written = 0;
  const out = fs.createWriteStream(file);
  try {
    await new Promise((resolve, reject) => {
      req.on("data", (chunk) => {
        written += chunk.length;
        if (written > expected) {
          req.destroy();
          reject(fail(413, "这个块比预期大"));
          return;
        }
        if (!out.write(chunk)) {
          req.pause();
          out.once("drain", () => req.resume());
        }
      });
      req.on("end", () => out.end(resolve));
      req.on("error", reject);
      out.on("error", reject);
    });
  } catch (error) {
    await fsp.rm(file, { force: true });
    throw error;
  }

  if (written !== expected) {
    await fsp.rm(file, { force: true });
    throw fail(400, `这个块只收到 ${written} 字节，应为 ${expected}`);
  }

  return sendJson(res, 200, { ok: true, index, received: written });
}

async function complete(req, res, user, id) {
  const meta = await readMeta(id);
  if (!meta) throw fail(404, "这次上传已经过期，重新传一次吧");
  if (meta.userId !== user.id && user.role !== "admin") throw fail(403, "这不是你的上传");

  const parts = [];
  for (let index = 0; index < meta.chunks; index += 1) {
    const file = path.join(dirOf(id), `${index}.part`);
    try {
      await fsp.access(file);
      parts.push(file);
    } catch {
      throw fail(400, `还缺第 ${index + 1} 块，先续传再合并`);
    }
  }

  const assembled = path.join(dirOf(id), "data.bin");
  const out = fs.createWriteStream(assembled);
  for (const part of parts) {
    await pipeline(createReadStream(part), out, { end: false });
  }
  await new Promise((resolve) => out.end(resolve));

  const stat = await fsp.stat(assembled);
  if (stat.size !== meta.size) throw fail(400, `合并后大小不对：${stat.size} / ${meta.size}`);

  const drive = get("SELECT * FROM drives WHERE id = ?", meta.driveId);
  if (!drive) throw fail(404, "存储已经不在了");

  const result = await upload({
    user,
    drive,
    folder: meta.folder === "/" ? "" : meta.folder,
    files: [{ path: assembled, filename: meta.name, size: meta.size, type: meta.type }],
  });

  meta.done = true;
  await writeMeta(id, meta).catch(() => {});
  await fsp.rm(dirOf(id), { recursive: true, force: true }).catch(() => {});

  if (!result.saved.length) {
    throw fail(400, result.rejected[0]?.reason || "没有存进去");
  }
  return sendJson(res, 200, { ok: true, media: result.saved, rejected: result.rejected });
}

async function abort(req, res, user, id) {
  const meta = await readMeta(id);
  if (!meta) return sendJson(res, 200, { ok: true });
  if (meta.userId !== user.id && user.role !== "admin") throw fail(403, "这不是你的上传");
  await fsp.rm(dirOf(id), { recursive: true, force: true }).catch(() => {});
  return sendJson(res, 200, { ok: true });
}

export async function handleUploads(req, res, url, user) {
  if (!user) throw fail(401, "先登录");
  const parts = url.pathname.replace(/^\/memories\/api\/uploads\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  if (!parts.length && method === "POST") return initUpload(req, res, user);
  const id = parts[0];
  if (!id) throw fail(404, "接口不存在");

  if (parts.length === 1 && method === "GET") return status(req, res, user, id);
  if (parts.length === 1 && method === "DELETE") return abort(req, res, user, id);
  if (parts[1] === "chunks" && method === "PUT") return putChunk(req, res, user, id, Number(parts[2]));
  if (parts[1] === "complete" && method === "POST") return complete(req, res, user, id);

  throw fail(404, "接口不存在");
}

export const driverForUpload = driverFor;
