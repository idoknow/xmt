// HTTP 小工具：cookie、JSON、HTML 转义、MIME、响应封装。
import { createReadStream, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

export const mimeOf = (name = "") => {
  const dot = name.lastIndexOf(".");
  return MIME[dot >= 0 ? name.slice(dot).toLowerCase() : ""] || "application/octet-stream";
};

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export const parseCookies = (header = "") => {
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
};

export const cookie = (name, value, { maxAge, path = "/", httpOnly = true, secure = false, sameSite = "Lax" } = {}) => {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) bits.push("HttpOnly");
  if (secure) bits.push("Secure");
  if (maxAge != null) bits.push(`Max-Age=${Math.floor(maxAge)}`);
  return bits.join("; ");
};

export const send = (res, status, body, headers = {}) => {
  if (res.writableEnded) return;
  res.writeHead(status, headers);
  res.end(body);
};

export const sendJson = (res, status, data, headers = {}) =>
  send(res, status, JSON.stringify(data), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });

export const redirect = (res, location, headers = {}) =>
  send(res, 302, "", { location, "cache-control": "no-store", ...headers });

export const html = (res, status, markup, headers = {}) =>
  send(res, status, markup, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });

/** 读取请求体（有上限，超过就断开） */
export const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

export const readJson = async (req, limit = 256 * 1024) => {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON 解析失败"), { status: 400 });
  }
};

/** 发送文件：支持 ETag/If-None-Match、Range（视频拖动进度用）、gzip_static */
export const sendFile = (req, res, filePath, { mime, cache = "public, max-age=31536000, immutable", downloadAs, status = 200 } = {}) => {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return send(res, 404, "Not Found", { "content-type": "text/plain; charset=utf-8" });
  }
  if (stat.isDirectory()) return send(res, 404, "Not Found");

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "content-type": mime || mimeOf(filePath),
    "cache-control": cache,
    etag,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  };
  if (downloadAs) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(downloadAs)}`;

  if (req.headers["if-none-match"] === etag) {
    return send(res, 304, "", headers);
  }

  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [startRaw, endRaw] = range.replace("bytes=", "").split("-");
    let start = startRaw === "" ? null : Number(startRaw);
    let end = endRaw === "" ? null : Number(endRaw);
    if (start == null) {
      start = Math.max(0, stat.size - Number(end));
      end = stat.size - 1;
    }
    end = end == null ? stat.size - 1 : Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      return send(res, 416, "", { "content-range": `bytes */${stat.size}` });
    }
    res.writeHead(206, {
      ...headers,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
      "content-length": String(end - start + 1),
    });
    if (req.method === "HEAD") return res.end();
    return createReadStream(filePath, { start, end }).pipe(res);
  }

  headers["content-length"] = String(stat.size);
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
};

export { gzipSync };
