// 从文件头读图片宽高（PNG / JPEG / WebP），不引第三方库。
import { open } from "node:fs/promises";

export async function imageSize(filePath) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const head = Buffer.alloc(32);
    const { bytesRead } = await handle.read(head, 0, 32, 0);
    if (bytesRead < 12) return null;

    // PNG：8 字节签名 + IHDR
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    // GIF
    if (head.subarray(0, 3).toString() === "GIF") {
      return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    }

    // WebP：RIFF....WEBP
    if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") {
      const chunk = head.subarray(12, 16).toString();
      const buf = Buffer.alloc(18);
      const { bytesRead: n } = await handle.read(buf, 0, 18, 12);
      if (n < 18) return null;
      if (chunk === "VP8 ") {
        return { width: buf.readUInt16LE(14) & 0x3fff, height: buf.readUInt16LE(16) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const b = buf.subarray(9, 14);
        const bits = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") {
        return { width: 1 + (buf[12] | (buf[13] << 8) | (buf[14] << 16)), height: 1 + (buf[15] | (buf[16] << 8) | (buf[17] << 16)) };
      }
      return null;
    }

    // JPEG：扫 SOF0/1/2/3/5/6/7/9/10/11/13/14/15
    if (head[0] === 0xff && head[1] === 0xd8) {
      const size = 64 * 1024;
      const chunk = Buffer.alloc(size);
      const { bytesRead: n } = await handle.read(chunk, 0, size, 2);
      let i = 0;
      while (i < n - 9) {
        if (chunk[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = chunk[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: chunk.readUInt16BE(i + 7), height: chunk.readUInt16BE(i + 5) };
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          i += 2;
          continue;
        }
        const length = chunk.readUInt16BE(i + 2);
        if (length < 2) return null;
        i += 2 + length;
      }
      return null;
    }

    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
