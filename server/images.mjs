import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config, paths } from "./config.mjs";
import { all, db, get, now, run, setting } from "./db.mjs";
import { escapeHtml as e, readJson, sendJson } from "./util.mjs";
import { fmtSize } from "./ui.mjs";
import { parseMultipart } from "./multipart.mjs";
import { currentUser, isAdmin } from "./auth.mjs";

/* ---------- 图床定义 ---------- */

export const PROVIDERS = {
  scdn: {
    name: "失控图床",
    hint: "输出 WebP，支持查询图片信息",
    endpoint: "https://img.scdn.io/api/v1.php",
    field: "image",
    max: 20 * 1024 * 1024,
    query: true,
  },
  tc360: {
    name: "360 图床",
    hint: "速度快，不保留原文件名",
    endpoint: "https://api.xinyew.cn/api/360tc",
    field: "file",
    max: 8 * 1024 * 1024,
  },
  sogotc: {
    name: "搜狗图床",
    hint: "外链需 no-referrer（本站预览已处理）",
    endpoint: "https://api.xinyew.cn/api/sogotc",
    field: "file",
    max: 8 * 1024 * 1024,
    referrer: "never",
  },
  psbctc: {
    name: "中国邮政图床",
    hint: "单张不超过 2 MB",
    endpoint: "https://api.xinyew.cn/api/psbctc",
    field: "file",
    max: 2 * 1024 * 1024,
  },
};

const TABLE = `
CREATE TABLE IF NOT EXISTS image_uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  filename TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  note TEXT NOT NULL DEFAULT '',
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS image_uploads_user ON image_uploads(user_id, created_at);
CREATE INDEX IF NOT EXISTS image_uploads_created ON image_uploads(created_at);
`;

db.exec(TABLE);

/* ---------- 上传与查询 ---------- */

async function forward(provider, file) {
  const info = PROVIDERS[provider];
  const bytes = fs.readFileSync(file.path);
  const type = file.type || "application/octet-stream";
  const form = new FormData();
  form.append(info.field, new Blob([bytes], { type }), file.filename || "image");

  const response = await fetch(info.endpoint, { method: "POST", body: form, headers: info.referrer ? { referer: "" } : {} });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(`${info.name} 返回了无法解析的内容（${response.status}）`), { status: 502 });
  }

  if (provider === "scdn") {
    if (!data?.success) throw Object.assign(new Error(data?.message || data?.error || "失控图床拒绝了这次上传"), { status: 400 });
    return {
      url: data.url || data.data?.url,
      filename: data.data?.filename || "",
      meta: {
        storage: data.data?.storage_backend || "",
        originalSize: data.data?.original_size || 0,
        compressedSize: data.data?.compressed_size || 0,
        ratio: data.data?.compression_ratio ?? null,
        message: data.message || "",
      },
    };
  }

  if (data?.errno !== 0) {
    throw Object.assign(new Error(data?.error || data?.message || "图床拒绝了这次上传"), { status: 400 });
  }
  return {
    url: data.data?.url || "",
    filename: data.data?.imgFile || data.data?.fileName || "",
    meta: {},
  };
}

async function metadata(item) {
  if (item.provider !== "scdn") return null;
  const name = item.meta && JSON.parse(item.meta || "{}").filename ? JSON.parse(item.meta).filename : item.filename;
  if (!name) return null;
  const response = await fetch(`https://img.scdn.io/api/v1.php?q=${encodeURIComponent(name)}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw Object.assign(new Error("没有查到这张图的信息（可能已被清理）"), { status: 404 });
  return data.data;
}

/* ---------- 页面 ---------- */

const COPY = [
  ["url", "链接"],
  ["md", "MD 图"],
  ["mdlink", "MD 链接"],
  ["html", "HTML"],
  ["htmllink", "HTML 链接"],
  ["bbcode", "BBCode"],
  ["bblink", "BB 链接"],
  ["ubb", "UBB"],
  ["css", "CSS"],
  ["json", "JSON"],
];

export function imagePage({ site, user, total }) {
  const attrs =
    '<div hidden data-limits=\'' +
    JSON.stringify(providerLimits()) +
    '\' data-user-id="' +
    (user ? user.id : "") +
    '" data-total="' +
    total +
    '"></div>';
  const chips = Object.entries(PROVIDERS)
    .map(
      ([key, item], index) =>
        `<button class="im-provider${index === 0 ? " is-on" : ""}" type="button" data-provider="${key}">
          <strong>${e(item.name)}</strong><small>${e(item.hint)}</small>
        </button>`,
    )
    .join("");

  const copyButtons = COPY.map(
    ([key, label]) => `<button class="im-copy" type="button" data-copy-format="${key}">${e(label)}</button>`,
  ).join("");

  return `${attrs}<section class="im-hero">
  <div class="wrap">
    <p class="eyebrow">Image Host</p>
    <h1 class="im-hero__title">图床</h1>
    <p class="im-hero__lead">
      选一个图床，把图片拖进来。上传完可以一键复制链接、Markdown、HTML、BBCode 这些格式。
      ${user ? "登录状态下上传的图片会记在「我的图片」里，可以备注、删除、查信息。" : "未登录也能用，历史记录只存在这台设备的浏览器里。"}
    </p>
    <p class="im-hero__stat">全站已上传 <b>${total}</b> 次</p>
  </div>
</section>

<section class="section" style="border-top:0">
  <div class="wrap">
    <div class="im-providers">${chips}</div>

    <div class="im-drop" data-drop>
      <input type="file" accept="image/*" multiple hidden data-file />
      <div class="im-drop__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
      </div>
      <p class="im-drop__text">拖图片到这里，或者 <button class="im-link" type="button" data-pick>选文件</button></p>
      <p class="im-drop__hint" data-hint>单张最大 20 MB，支持 jpg / png / webp / gif</p>
      <div class="im-bar" data-bar hidden><i data-bar-fill></i></div>
      <p class="im-status" data-status></p>
    </div>

    <div class="im-results" data-results></div>

    <template data-template>
      <article class="im-card">
        <figure class="im-card__thumb"><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></figure>
        <div class="im-card__body">
          <p class="im-card__meta" data-meta></p>
          <label class="im-card__field"><span>链接</span><input readonly data-url /></label>
          <div class="im-card__copies">${copyButtons}</div>
          <p class="im-card__note" data-note></p>
        </div>
      </article>
    </template>
  </div>
</section>

<section class="section" id="mine">
  <div class="wrap">
    <header class="section__head">
      <div>
        <p class="eyebrow">${user ? "我的图片" : "本机历史"}</p>
        <h2 class="section__title">${user ? "我上传过的图" : "这台设备传过的图"}</h2>
      </div>
      <div class="im-mine__tools">
        <input class="im-search" type="search" placeholder="按链接或文件名搜索" data-search />
        <span class="im-mine__stat" data-mine-stat></span>
      </div>
    </header>
    <div class="im-list" data-list><p class="im-empty">还没有记录。</p></div>
  </div>
</section>`;
}

/* ---------- 接口 ---------- */

export async function handleImages(req, res, url, user) {
  const parts = url.pathname.replace(/^\/memories\/api\/images\/?/, "").split("/").filter(Boolean);
  const method = req.method || "GET";
  const isUpload = parts[0] === "upload";

  if ((!parts.length || isUpload) && method === "POST") {
    const type = req.headers["content-type"] || "";
    if (!type.includes("multipart/form-data")) throw Object.assign(new Error("请用表单上传"), { status: 400 });
    const boundary = type.split("boundary=")[1];
    const uploaded = await parseMultipart(req, { boundary, dir: path.join(paths.files, "..", "tmp", "images"), limit: 24 * 1024 * 1024 });
    const file = uploaded.files[0];
    if (!file) throw Object.assign(new Error("没有收到文件"), { status: 400 });
    const provider = String(uploaded.fields.provider || "scdn");
    if (!PROVIDERS[provider]) throw Object.assign(new Error("未知的图床"), { status: 400 });
    if (file.size > PROVIDERS[provider].max) {
      fs.rmSync(file.path, { force: true });
      throw Object.assign(new Error(`这套图床单张不能超过 ${fmtSize(PROVIDERS[provider].max)}`), { status: 413 });
    }

    try {
      const result = await forward(provider, file);
      const id = randomUUID();
      const meta = JSON.stringify({ ...result.meta, filename: result.filename });
      run(
        "INSERT INTO image_uploads (id, user_id, provider, url, filename, size, mime, note, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        id,
        user?.id || null,
        provider,
        result.url,
        result.filename,
        file.size,
        file.type || "",
        "",
        meta,
        now(),
      );
      return sendJson(res, 200, {
        ok: true,
        item: {
          id,
          provider,
          providerName: PROVIDERS[provider].name,
          url: result.url,
          filename: result.filename,
          size: file.size,
          mime: file.type || "",
          note: "",
          meta: { ...result.meta, filename: result.filename },
          createdAt: now(),
        },
      });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }

  if (!parts.length && method === "GET") {
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const total = get("SELECT COUNT(*) AS n FROM image_uploads")?.n || 0;
    if (!user) return sendJson(res, 200, { ok: true, total, items: [], stats: { count: 0, bytes: 0 } });

    const rows = all("SELECT * FROM image_uploads WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", user.id);
    const items = rows
      .filter((row) => !query || String(row.url).toLowerCase().includes(query) || String(row.filename || "").toLowerCase().includes(query))
      .map((row) => ({
        id: row.id,
        provider: row.provider,
        providerName: PROVIDERS[row.provider]?.name || row.provider,
        url: row.url,
        filename: row.filename,
        size: row.size,
        mime: row.mime,
        note: row.note,
        meta: row.meta ? JSON.parse(row.meta) : {},
        createdAt: row.created_at,
      }));
    const stat = get("SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM image_uploads WHERE user_id = ?", user.id);
    return sendJson(res, 200, { ok: true, total, items, stats: { count: stat?.count || 0, bytes: stat?.bytes || 0 } });
  }

  const item = parts[0] ? get("SELECT * FROM image_uploads WHERE id = ?", parts[0]) : null;
  if (parts[0] && !item) throw Object.assign(new Error("这张图不在记录里"), { status: 404 });
  if (item && item.user_id !== user?.id && !isAdmin(user)) throw Object.assign(new Error("只能管理自己上传的图片"), { status: 403 });

  if (parts[1] === "note" && method === "POST") {
    const body = await (await import("./util.mjs")).readJson(req);
    run("UPDATE image_uploads SET note = ? WHERE id = ?", String(body.note || "").slice(0, 200), item.id);
    return sendJson(res, 200, { ok: true });
  }

  if (parts[1] === "meta" && method === "GET") {
    const info = await metadata(item);
    return sendJson(res, 200, { ok: true, info });
  }

  if (!parts[1] && method === "DELETE") {
    run("DELETE FROM image_uploads WHERE id = ?", item.id);
    return sendJson(res, 200, { ok: true });
  }

  throw Object.assign(new Error("接口不存在"), { status: 404 });
}

export function providerLimits() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([key, value]) => [key, { name: value.name, max: value.max, query: Boolean(value.query) }]));
}

export function imageTotal() {
  return get("SELECT COUNT(*) AS n FROM image_uploads")?.n || 0;
}
