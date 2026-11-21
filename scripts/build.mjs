// 构建：site/ → dist/
// 做五件事：给资源加内容指纹、压掉 CSS/JS 的多余空白、注入构建信息、校验站内链接、生成 .gz 供 nginx gzip_static 直出。
// 不做混淆：源码仍可读，收益来自去注释/缩进与 gzip。

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "site");
const OUT = path.join(ROOT, "dist");

const TEXT_EXT = new Set([".html", ".css", ".js", ".svg", ".json", ".txt", ".xml", ".webmanifest"]);
const ASSET_PREFIX = "/assets/";

/** 递归列出相对路径（posix 风格） */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(abs, base)));
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

/** 资源指纹：内容变了，URL 才变，缓存可以放心长期 */
async function buildVersions(files) {
  const versions = new Map();
  for (const rel of files) {
    if (!rel.startsWith("assets/")) continue;
    const buf = await readFile(path.join(SRC, rel));
    versions.set(`/${rel}`, sha(buf));
  }
  return versions;
}

/** 给 html 里的 /assets/ 引用与 css 里的相对 url() 加 ?v=指纹 */
function stampHtml(html, versions) {
  return html.replace(/(\b(?:href|src)=")(\/assets\/[^"?#]+)(")/g, (whole, pre, url, post) => {
    const version = versions.get(url);
    return version ? `${pre}${url}?v=${version}${post}` : whole;
  });
}

function stampCss(css, versions) {
  return css.replace(/url\((["']?)(\.\.?\/[^"')]+)\1\)/g, (whole, quote, url) => {
    const resolved = path.posix.normalize(path.posix.join("/assets/css", url));
    const version = versions.get(resolved);
    return version ? `url(${quote}${url}?v=${version}${quote})` : whole;
  });
}

/** CSS：去注释、并空白。只动结构性空白，不碰字符串与 calc 里的运算符 */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/** JS：去掉整行注释与行尾空白、合并空行；不做行内压缩（避免碰坏正则与字符串） */
function minifyJs(js) {
  return js
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n")
    .replace(/\n{2,}/g, "\n");
}

/** 站内链接与资源存在性校验 */
function validate(file, html, filesSet) {
  const problems = [];
  const targets = [...html.matchAll(/\b(?:href|src)="(\/[^"#?]*)/g)].map((m) => m[1]);
  /* 由 Node 服务端直接处理的路径，不产生静态文件 */
  const dynamic = /^\/(memories|tools|image|healthz\.txt|build\.txt)(\/|$)/;

  for (const target of targets) {
    if (target === "/" || dynamic.test(target)) continue;
    const clean = target.replace(/\/+$/, "");
    const candidates = [clean.slice(1), `${clean.slice(1)}.html`, `${clean.slice(1)}/index.html`];
    if (!candidates.some((c) => filesSet.has(c))) {
      problems.push(`  ${file}: ${target} 指向的文件不存在`);
    }
  }
  return problems;
}

async function main() {
  const files = await walk(SRC);
  const filesSet = new Set(files);
  const versions = await buildVersions(files);
  const commit = (process.env.GITHUB_SHA || "").slice(0, 7) || "local";
  const builtAt = new Date().toISOString();

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const problems = [];
  const stats = { files: 0, bytes: 0, gz: 0 };

  for (const rel of files) {
    const srcPath = path.join(SRC, rel);
    const outPath = path.join(OUT, rel);
    await mkdir(path.dirname(outPath), { recursive: true });

    let buf = await readFile(srcPath);
    if (rel.endsWith(".html")) {
      let html = buf.toString("utf8");
      problems.push(...validate(rel, html, filesSet));
      html = stampHtml(html, versions);
      html = html.replace(
        "</head>",
        `  <meta name="xmt-build" content="${commit} · ${builtAt}" />\n  </head>`,
      );
      buf = Buffer.from(html, "utf8");
    } else if (rel.endsWith(".css")) {
      buf = Buffer.from(minifyCss(stampCss(buf.toString("utf8"), versions)), "utf8");
    } else if (rel.endsWith(".js")) {
      buf = Buffer.from(minifyJs(buf.toString("utf8")), "utf8");
    }

    await writeFile(outPath, buf);
    stats.files += 1;
    stats.bytes += buf.byteLength;

    if (TEXT_EXT.has(path.extname(rel))) {
      const gz = gzipSync(buf, { level: 9 });
      if (gz.byteLength < buf.byteLength) {
        await writeFile(`${outPath}.gz`, gz);
        stats.gz += 1;
      }
    }
  }

  // 探活文件：集群 readiness 与外部探针都用它
  await writeFile(path.join(OUT, "healthz.txt"), "ok\n");
  await writeFile(
    path.join(OUT, "build.txt"),
    `commit ${commit}\nbuilt ${builtAt}\nfiles ${stats.files}\n`,
  );

  if (problems.length) {
    console.error("构建失败：站内链接有问题");
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
    return;
  }

  console.log(
    `dist 就绪：${stats.files} 个文件，${(stats.bytes / 1024).toFixed(1)} KB，预压缩 ${stats.gz} 个`,
  );
  console.log(`版本：${commit}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
