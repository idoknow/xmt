// 流式 multipart/form-data 解析：文件直接落盘，内存只留一个滑动窗口。
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const CRLF = Buffer.from("\r\n");

const indexOf = (haystack, needle, from = 0) => haystack.indexOf(needle, from);

export function parseMultipart(req, { boundary, dir, limit = 2 * 1024 ** 3 }) {
  if (!boundary) throw Object.assign(new Error("缺少 multipart boundary"), { status: 400 });
  mkdirSync(dir, { recursive: true });

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  const pending = [];
  let total = 0;

  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let state = "preamble"; // preamble → headers → body → done
    let part = null; // { name, filename, type, stream, path, size }
    let failed = false;

    const fail = (error) => {
      if (failed) return;
      failed = true;
      try {
        part?.stream?.destroy();
      } catch {}
      req.destroy();
      reject(error);
    };

    const openPart = () => {
      if (part?.chunks) fields[part.name] = Buffer.concat(part.chunks).toString("utf8");
      if (part?.stream) pending.push(part.stream);
      part = null;
    };

    const handleHeaders = (raw) => {
      const lines = raw.toString("utf8").split("\r\n");
      const headers = {};
      for (const line of lines) {
        const index = line.indexOf(":");
        if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }
      const disposition = headers["content-disposition"] || "";
      const name = /name="([^"]*)"/.exec(disposition)?.[1] || "";
      const filename = /filename="([^"]*)"/.exec(disposition)?.[1];
      if (filename != null) {
        const safe = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "file";
        const temp = join(dir, `${Date.now()}-${randomUUID()}`);
        const stream = createWriteStream(temp);
        stream.on("error", fail);
        part = { name, filename: safe, type: headers["content-type"] || "", stream, path: temp, size: 0 };
        files.push(part);
      } else {
        part = { name, chunks: [] };
      }
      state = "body";
    };

    const consume = (chunk) => {
      total += chunk.length;
      if (total > limit) return fail(Object.assign(new Error("上传内容超过限制"), { status: 413 }));
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;

      for (;;) {
        if (state === "preamble") {
          const at = indexOf(buf, delimiter);
          if (at < 0) {
            buf = buf.subarray(Math.max(0, buf.length - delimiter.length));
            return;
          }
          buf = buf.subarray(at + delimiter.length);
          if (buf.subarray(0, 2).toString() === "--") {
            state = "done";
            break;
          }
          if (buf.subarray(0, 2).toString() === "\r\n") {
            buf = buf.subarray(2);
            state = "headers";
          } else if (buf.length < 2) return;
          else return;
          continue;
        }

        if (state === "headers") {
          const at = indexOf(buf, Buffer.from("\r\n\r\n"));
          if (at < 0) {
            if (buf.length > 64 * 1024) return fail(Object.assign(new Error("multipart 头部过长"), { status: 400 }));
            return;
          }
          const raw = buf.subarray(0, at);
          buf = buf.subarray(at + 4);
          handleHeaders(raw);
          continue;
        }

        if (state === "body") {
          const mark = Buffer.concat([CRLF, delimiter]);
          const at = indexOf(buf, mark);
          if (at < 0) {
            const keep = mark.length + 2;
            if (buf.length > keep) {
              const flush = buf.subarray(0, buf.length - keep);
              buf = buf.subarray(buf.length - keep);
              writePart(flush);
            }
            return;
          }
          writePart(buf.subarray(0, at));
          buf = buf.subarray(at + mark.length);
          openPart();
          if (buf.subarray(0, 2).toString() === "--") {
            state = "done";
            break;
          }
          if (buf.subarray(0, 2).toString() === "\r\n") {
            buf = buf.subarray(2);
            state = "headers";
            continue;
          }
          if (buf.length < 2) return;
          return;
        }

        return;
      }

      // done：收尾
      finish();
    };

    const writePart = (data) => {
      if (!part || !data.length) return;
      if (part.stream) {
        part.size += data.length;
        part.stream.write(data);
      } else {
        part.chunks.push(data);
      }
    };

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      if (part?.chunks) fields[part.name] = Buffer.concat(part.chunks).toString("utf8");
      if (part?.stream) pending.push(part.stream);
      part = null;
      await Promise.all(pending.map((stream) => new Promise((done) => stream.end(done))));
      resolve({ fields, files });
    };

    req.on("data", consume);
    req.on("end", () => {
      if (failed) return;
      if (part?.chunks) fields[part.name] = Buffer.concat(part.chunks).toString("utf8");
      if (part?.stream) part.stream.end();
      finish();
    });
    req.on("error", fail);
    req.on("aborted", () => fail(Object.assign(new Error("上传中断"), { status: 400 })));
  });
}
