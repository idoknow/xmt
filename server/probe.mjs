// 轻量媒体探测：图片读文件头，MP4/MOV 解析 moov 里的 mvhd / tkhd / mdhd / stts / stsd。
// 不引第三方依赖（镜像里没有 ffprobe），够用就好：分辨率、时长、帧率、编码。
import { open } from "node:fs/promises";
import { imageSize } from "./imgsize.mjs";

const MP4_HINT = /\.(mp4|m4v|mov|m4a|3gp)$/i;

async function readBoxHeader(handle, offset) {
  const head = Buffer.alloc(16);
  const { bytesRead } = await handle.read(head, 0, 16, offset);
  if (bytesRead < 8) return null;
  let size = head.readUInt32BE(0);
  const type = head.toString("latin1", 4, 8);
  let headSize = 8;
  if (size === 1) {
    if (bytesRead < 16) return null;
    size = Number(head.readBigUInt64BE(8));
    headSize = 16;
  } else if (size === 0) {
    const stat = await handle.stat();
    size = stat.size - offset;
  }
  if (size < headSize) return null;
  return { size, type, headSize, start: offset, body: offset + headSize };
}

async function findBox(handle, { body, end }, type) {
  let offset = body;
  while (offset < end) {
    const box = await readBoxHeader(handle, offset);
    if (!box) return null;
    if (box.type === type) return { ...box, end: Math.min(box.start + box.size, end) };
    offset = box.start + box.size;
  }
  return null;
}

const readAt = async (handle, offset, length) => {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
};

async function parseMp4(handle) {
  const stat = await handle.stat();
  const root = { body: 0, end: stat.size };
  const moov = await findBox(handle, root, "moov");
  if (!moov) return {};

  const out = {};
  const mvhd = await findBox(handle, moov, "mvhd");
  if (mvhd) {
    const head = await readAt(handle, mvhd.body, 32);
    const version = head.readUInt8(0);
    if (version === 1) {
      out.timescale = head.readUInt32BE(20);
      out.duration = Number(head.readBigUInt64BE(24)) / (out.timescale || 1);
    } else {
      out.timescale = head.readUInt32BE(12);
      out.duration = head.readUInt32BE(16) / (out.timescale || 1);
    }
  }

  let offset = moov.body;
  while (offset < moov.end) {
    const box = await readBoxHeader(handle, offset);
    if (!box) break;
    if (box.type === "trak") {
      const trak = { ...box, end: Math.min(box.start + box.size, moov.end) };
      const tkhd = await findBox(handle, trak, "tkhd");
      if (tkhd) {
        const head = await readAt(handle, tkhd.body, 92);
        const version = head.readUInt8(0);
        const size = version === 1 ? 96 : 84;
        if (head.length >= size) {
          const width = head.readUInt32BE(size - 8) / 65536;
          const height = head.readUInt32BE(size - 4) / 65536;
          if (width > 0 && height > 0 && !out.width) {
            out.width = Math.round(width);
            out.height = Math.round(height);
          }
        }
      }
      const mdia = await findBox(handle, trak, "mdia");
      if (mdia) {
        const mdhd = await findBox(handle, mdia, "mdhd");
        let trackScale = 0;
        if (mdhd) {
          const head = await readAt(handle, mdhd.body, 24);
          const version = head.readUInt8(0);
          trackScale = version === 1 ? head.readUInt32BE(20) : head.readUInt32BE(12);
        }
        const stbl = await findBox(handle, mdia, "stbl");
        if (stbl && !out.fps) {
          const stts = await findBox(handle, stbl, "stts");
          if (stts) {
            const head = await readAt(handle, stts.body, 16);
            const count = head.readUInt32BE(4);
            let samples = 0;
            let ticks = 0;
            let cursor = stts.body + 8;
            for (let i = 0; i < Math.min(count, 256); i += 1) {
              const row = await readAt(handle, cursor, 8);
              if (row.length < 8) break;
              const n = row.readUInt32BE(0);
              const delta = row.readUInt32BE(4);
              samples += n;
              ticks += n * delta;
              cursor += 8;
            }
            if (samples > 1 && ticks > 0 && trackScale > 0 && (out.duration ?? 0) > 0) {
              out.fps = Math.round((samples / (ticks / trackScale)) * 100) / 100;
            }
          }
        }
        const stsd = stbl ? await findBox(handle, stbl, "stsd") : null;
        if (stsd && !out.codec) {
          const head = await readAt(handle, stsd.body + 8, 8);
          if (head.length >= 8) out.codec = head.toString("latin1", 4, 8);
        }
      }
    }
    offset = box.start + box.size;
  }
  return out;
}

/** 探测一个本地文件。远端存储会先落到临时文件再调用它。 */
export async function probeMedia(absPath, name = absPath) {
  const result = { width: null, height: null, duration: null, fps: null, codec: null };
  try {
    if (MP4_HINT.test(name)) {
      const handle = await open(absPath, "r");
      try {
        Object.assign(result, await parseMp4(handle));
      } finally {
        await handle.close();
      }
      if (result.duration != null) result.duration = Math.round(result.duration * 100) / 100;
      return result;
    }
    const size = await imageSize(absPath);
    if (size?.width) {
      result.width = size.width;
      result.height = size.height;
    }
  } catch {
    // 探测失败就当未知，别让详情页挂掉
  }
  return result;
}
