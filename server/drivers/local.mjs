// 本地磁盘驱动：所有路径都限制在 root 之内，拒绝 ..
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename as fsRename, rm, stat as fsStat, copyFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const clean = (input = "/") => {
  const parts = String(input)
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  return "/" + parts.join("/");
};

export function safeJoin(root, relPath) {
  const abs = path.resolve(root, "." + clean(relPath));
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw Object.assign(new Error("路径越界"), { status: 400 });
  }
  return abs;
}

export function localDriver({ root }) {
  return {
    name: "local",
    root,

    async list(dir = "/") {
      const abs = safeJoin(root, dir);
      let entries = [];
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      const out = [];
      for (const entry of entries) {
        const rel = clean(`${clean(dir)}/${entry.name}`);
        let info = null;
        try {
          info = await fsStat(path.join(abs, entry.name));
        } catch {}
        out.push({
          name: entry.name,
          path: rel,
          isDir: entry.isDirectory(),
          size: info?.size ?? 0,
          modified: info?.mtime?.toISOString?.() ?? null,
        });
      }
      return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh"));
    },

    async stat(target) {
      try {
        const info = await fsStat(safeJoin(root, target));
        return { path: clean(target), isDir: info.isDirectory(), size: info.size, modified: info.mtime.toISOString() };
      } catch {
        return null;
      }
    },

    async ensureDir(dir) {
      await mkdir(safeJoin(root, dir), { recursive: true });
      return clean(dir);
    },

    async read(target) {
      const abs = safeJoin(root, target);
      const info = await fsStat(abs);
      if (info.isDirectory()) throw Object.assign(new Error("这是目录"), { status: 400 });
      return { stream: createReadStream(abs), size: info.size };
    },

    async write(target, { filePath, size }) {
      const abs = safeJoin(root, target);
      await mkdir(path.dirname(abs), { recursive: true });
      await pipeline(createReadStream(filePath), createWriteStream(abs));
      const info = await fsStat(abs);
      return { path: clean(target), size: size ?? info.size };
    },

    async rename(target, newName) {
      const from = safeJoin(root, target);
      const to = safeJoin(root, clean(`/${path.posix.dirname(clean(target))}/${newName}`));
      await fsRename(from, to);
      return clean(`/${path.posix.dirname(clean(target))}/${newName}`);
    },

    async move(target, destinationDir) {
      const from = safeJoin(root, target);
      const to = safeJoin(root, clean(`${clean(destinationDir)}/${path.posix.basename(clean(target))}`));
      await mkdir(path.dirname(to), { recursive: true });
      await fsRename(from, to);
      return clean(`${clean(destinationDir)}/${path.posix.basename(clean(target))}`);
    },

    async copy(target, destinationDir) {
      const from = safeJoin(root, target);
      const to = safeJoin(root, clean(`${clean(destinationDir)}/${path.posix.basename(clean(target))}`));
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
      return clean(`${clean(destinationDir)}/${path.posix.basename(clean(target))}`);
    },

    async remove(target) {
      await rm(safeJoin(root, target), { recursive: true, force: true });
      return true;
    },

    async filePath(target) {
      return safeJoin(root, target);
    },

    // 磁盘剩余量：块大小 × 可用块数（拿不到就返回 null，由上层显示「未获取」）
    async capacity() {
      const statfs = (await import("node:fs/promises")).statfs;
      // 存储目录可能还没建出来，往上找第一个存在的目录问磁盘
      const candidates = [];
      let current = path.resolve(root);
      for (let i = 0; i < 6; i += 1) {
        candidates.push(current);
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      for (const dir of candidates) {
        try {
          const info = await statfs(dir);
          const unit = Number(info.bsize) || 0;
          const total = unit * Number(info.blocks || 0);
          const free = unit * Number(info.bavail ?? info.bfree ?? 0);
          if (total) return { total, free };
        } catch {
          continue;
        }
      }
      return null;
    },
  };
}
