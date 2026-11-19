// 本地预览：模拟 nginx 的干净路径与缓存头
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), process.argv[2] ?? "dist");
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidates = clean === "/" ? ["index.html"] : [clean.slice(1), `${clean.slice(1)}.html`];
  for (const candidate of candidates) {
    const abs = path.join(ROOT, candidate);
    if (!abs.startsWith(ROOT)) continue;
    try {
      if ((await stat(abs)).isFile()) return abs;
    } catch {
      /* 继续找 */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const file = await resolve(req.url ?? "/");
  if (!file) {
    const notFound = await resolve("/404.html");
    res.writeHead(404, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
    res.end(notFound ? await readFile(notFound) : "404");
    return;
  }
  const ext = path.extname(file);
  const body = await readFile(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(body);
}).listen(PORT, () => {
  console.log(`预览：http://localhost:${PORT}  （${ROOT}）`);
});
