// 极简 ZIP 打包器：只做「存储」不压缩（媒体文件本来就压不动），
// 但支持流式写入，所以 10GB 级文件也不会把内存吃爆。
import { createWriteStream } from "node:fs";
import { once } from "node:events";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer, seed = 0) {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const dosTime = (date) => {
  const d = date instanceof Date ? date : new Date();
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const day = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time: time & 0xffff, date: day & 0xffff };
};

const buffer = (size) => Buffer.alloc(size);

const localHeader = ({ nameBuf, time, date, crc, size }) => {
  const head = buffer(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4); // 需要 2.0
  head.writeUInt16LE(0x0808, 6); // UTF-8 名字 + 数据描述符
  head.writeUInt16LE(0, 8); // 存储（无压缩）
  head.writeUInt16LE(time, 10);
  head.writeUInt16LE(date, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(size, 18); // 走描述符时为 0
  head.writeUInt32LE(size, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  head.writeUInt16LE(0, 28);
  return head;
};

const dataDescriptor = ({ crc, size }) => {
  const tail = buffer(16);
  tail.writeUInt32LE(0x08074b50, 0);
  tail.writeUInt32LE(crc, 4);
  tail.writeUInt32LE(size, 8);
  tail.writeUInt32LE(size, 12);
  return tail;
};

const centralHeader = ({ nameBuf, time, date, crc, size, offset, mode }) => {
  const head = buffer(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(0x031e, 4); // 生成方：Unix
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(0x0808, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(time, 12);
  head.writeUInt16LE(date, 14);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(size, 20);
  head.writeUInt32LE(size, 24);
  head.writeUInt16LE(nameBuf.length, 28);
  head.writeUInt16LE(0, 30);
  head.writeUInt16LE(0, 32);
  head.writeUInt16LE(0, 34);
  head.writeUInt16LE(0, 36);
  head.writeUInt32LE(mode, 38);
  head.writeUInt32LE(offset, 42);
  return head;
};

const endRecord = ({ count, size, offset }) => {
  const tail = buffer(22);
  tail.writeUInt32LE(0x06054b50, 0);
  tail.writeUInt16LE(0, 4);
  tail.writeUInt16LE(0, 6);
  tail.writeUInt16LE(count, 8);
  tail.writeUInt16LE(count, 10);
  tail.writeUInt32LE(size, 12);
  tail.writeUInt32LE(offset, 16);
  tail.writeUInt16LE(0, 20);
  return tail;
};

/**
 * 把若干条目写成一个 zip 文件。
 * entries: [{ name, size, stream: () => Readable, modified?: Date }]
 */
export async function writeZip(outPath, entries) {
  const out = createWriteStream(outPath);
  const write = async (chunk) => {
    if (!out.write(chunk)) await once(out, "drain");
  };

  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/^\/+/, ""), "utf8");
    const { time, date } = dosTime(entry.modified);
    const header = localHeader({ nameBuf, time, date, crc: 0, size: 0 });
    await write(header);
    await write(nameBuf);
    offset += header.length + nameBuf.length;

    let crc = 0;
    let size = 0;
    const stream = await entry.stream();
    for await (const chunk of stream) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      crc = crc32(piece, crc);
      size += piece.length;
      await write(piece);
    }
    const tail = dataDescriptor({ crc, size });
    await write(tail);
    offset += size + tail.length;

    central.push({
      nameBuf,
      time,
      date,
      crc,
      size,
      offset: offset - size - tail.length - header.length - nameBuf.length,
      mode: (0o100664 << 16) >>> 0,
    });
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const item of central) {
    const header = centralHeader(item);
    await write(header);
    await write(item.nameBuf);
    centralSize += header.length + item.nameBuf.length;
  }
  await write(endRecord({ count: central.length, size: centralSize, offset: centralStart }));
  out.end();
  await once(out, "finish");
  return outPath;
}
