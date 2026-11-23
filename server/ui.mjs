// 服务端渲染的页面片段。样式来自 /assets/css/style.css + /memories/assets/app.css。
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";
import { displayName, escapeHtml as e, qqAvatar } from "./util.mjs";
import { DRIVERS } from "./drives.mjs";

const year = new Date().getFullYear();

/* 静态资源带版本号：dist/build.txt 里的 commit（取前 12 位）。
   有 ?v= 时静态文件才按「一年不可变」缓存，否则退回 no-cache 让浏览器每次校验，
   这样发版后用户刷新就能拿到新的 CSS/JS，不会被困在旧缓存里。 */
let versionCache = { stamp: 0, value: "" };

export function assetVersion() {
  const file = path.join(config.distDir, "build.txt");
  try {
    const info = statSync(file);
    if (info.mtimeMs !== versionCache.stamp) {
      const text = readFileSync(file, "utf8");
      const commit = (text.match(/^commit\s+(\S+)/m) || [])[1] || "";
      const built = (text.match(/^built\s+(\S+)/m) || [])[1] || "";
      versionCache = { stamp: info.mtimeMs, value: (commit || built || String(info.mtimeMs)).slice(0, 12) };
    }
    return versionCache.value;
  } catch (error) {
    return "";
  }
}

export const fmtSize = (bytes) => {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

export const fmtDate = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
};

export const fmtDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
};

const roleLabel = { owner: "超级管理员", admin: "管理员", user: "成员" };

/** 头像：字母垫底，图片盖在上面；图挂了就露出字母，不至于空一个圈 */
export const avatarTag = (user, className = "m-user__img", textClass = "m-user__text") => {
  const src = user.avatar || qqAvatar(user.qq);
  const letter = String(user?.name || "").trim() ? displayName(user).slice(0, 1) : String(user?.qq || "?").slice(-2);
  const fallback = `<span class="${textClass}" aria-hidden="true">${e(letter)}</span>`;
  if (!src) return fallback;
  return `${fallback}<img class="${className}" src="${e(src)}" alt="" width="28" height="28" decoding="async" referrerpolicy="no-referrer" />`;
};

/** 右上角头像 + 下拉：里面放「我的上传 / 后台 / 退出」 */
const profile = (user) => {
  if (!user) return "";
  const face = avatarTag(user);
  const name = displayName(user);
  return `<details class="m-user" data-profile>
      <summary class="m-user__btn"><span class="m-user__ava">${face}</span><span class="m-user__label">${e(name)}</span></summary>
      <div class="m-user__menu" role="menu">
        <div class="m-user__head">
          <span class="m-user__ava m-user__ava--lg">${face}</span>
          <div><strong>${e(name)}</strong><small>${e(roleLabel[user.role] || "成员")} · QQ ${e(user.qq || "—")}</small></div>
        </div>
        <a role="menuitem" href="/memories/my">我的上传</a>
        <a role="menuitem" href="/memories/files">媒体库</a>
        ${user.role === "admin" || user.role === "owner" ? '<a role="menuitem" href="/memories/admin">后台管理</a>' : ""}
        <a role="menuitem" class="m-user__out" href="/memories/logout">退出登录</a>
      </div>
    </details>`;
};

export function shell({ title, site, user, body, bodyClass = "", scripts = "", head = "" }) {
  // 头像下拉不放在 nav 里：手机端 nav 是横向滚动容器，会把绝对定位的子弹层裁掉
  const nav = `${user ? '<a href="/memories/my">我的上传</a>' : ""}<a href="/memories/files">媒体库</a><a href="/memories/links">分享链接</a><a href="/image">图床</a>${
    user ? "" : `<a href="/memories/login">登录</a>`
  }`;
  const account = user ? `<div class="m-top__user">${profile(user)}</div>` : "";

  return `<!doctype html>
<html lang="zh-CN" data-page="memories">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(title)} · ${e(site.title || "Memories")}</title>
<meta name="description" content="${e(site.intro || "")}" />
<meta name="theme-color" content="#f6f3ec" />
<script>
  // 进页面先把配色定下来，避免闪一下
  (function () {
    try {
      var theme = localStorage.getItem("xmt-theme") || "system";
      if (theme !== "system") document.documentElement.dataset.theme = theme;
      var dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", dark ? "#14131b" : "#f6f3ec");
    } catch (error) {}
  })();
</script>
<link rel="icon" href="/assets/img/school-emblem-336.webp" />
<link rel="preload" href="/assets/fonts/newsreader-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/assets/css/style.css?v=${assetVersion()}" />
<link rel="stylesheet" href="/memories/assets/app.css?v=${assetVersion()}" />
${head}
</head>
<body class="m-body ${bodyClass}">
<header class="m-top">
  <div class="m-top__inner">
    <a class="m-brand" href="/">
      <img src="/assets/img/memories-icon.png" alt="" width="32" height="32" />
      <span><strong>${e(site.title || "Memories")}</strong><small>桂中校园媒体库</small></span>
    </a>
    <nav class="m-nav">${nav}
      <a href="/" class="m-nav__back">回站点</a>
    </nav>
    ${account}
  </div>
</header>
<main class="m-main">${body}</main>
<footer class="m-foot">
  <div class="m-foot__inner">
    <span>${e(site.title || "Memories")} — 桂林中学新媒体</span>
    <span class="m-foot__meta">
      <a class="m-foot__icp" href="/about">关于</a>
      ${site.icp ? `<a class="m-foot__icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">${e(site.icp)}</a>` : ""}
      <span>${year} · 学生维护</span>
    </span>
  </div>
</footer>
<script src="/memories/assets/app.js?v=${assetVersion()}" type="module"></script>
${scripts}
</body>
</html>`;
}

/* ---------- 站点外壳（与静态页同一套页头/页脚，给服务端渲染的站点页面用） ---------- */

const THEME_BOOT = `<script>
  (function () {
    try {
      var theme = localStorage.getItem("xmt-theme") || "system";
      if (theme !== "system") document.documentElement.dataset.theme = theme;
      var dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", dark ? "#14131b" : "#f6f3ec");
    } catch (error) {}
  })();
</script>`;

const SITE_FOOT = `<footer class="footer" id="footer">
  <div class="wrap">
    <div class="footer__lead">
      <div class="footer__brand">
        <img src="/assets/img/school-emblem-336.webp" alt="桂林中学校徽" width="336" height="336" decoding="async" />
        <div class="footer__id">
          <strong>桂林中学新媒体</strong>
          <span>XMT · Guilin Middle School</span>
        </div>
      </div>
      <div class="footer__words">
        <p class="footer__quote">最普通的街景，只要按下快门的那一刻是真诚的，它就是杰作。</p>
        <p class="footer__quote">百年学府，风华正茂。桂中的校园藏着许多美好的点点滴滴。</p>
      </div>
    </div>

    <div class="footer__cols">
      <nav class="footer__col" aria-label="页脚 · 站点">
        <h2>站点</h2>
        <ul>
          <li><a href="/">首页</a></li>
          <li><a href="/tools">在线工具</a></li>
          <li><a href="/image">图床</a></li>
          <li><a href="/about">关于</a></li>
        </ul>
      </nav>
      <nav class="footer__col" aria-label="页脚 · 媒体库">
        <h2>媒体库</h2>
        <ul>
          <li><a href="/memories">全部媒体</a></li>
          <li><a href="/memories/links">分享链接</a></li>
          <li><a href="/memories?sort=new">最近上传</a></li>
        </ul>
      </nav>
      <div class="footer__col">
        <h2>联系</h2>
        <ul>
          <li><a href="https://v.douyin.com/WQSM2axNI2Q/" target="_blank" rel="noopener noreferrer">抖音 · glzx1905</a></li>
          <li><a href="https://v.douyin.com/4z7HjqtwpTk/" target="_blank" rel="noopener noreferrer">抖音 · Life 摄影社</a></li>
          <li><a href="https://user.qzone.qq.com/3020148211" target="_blank" rel="noopener noreferrer">QQ 空间 · 时光驿客</a></li>
        </ul>
      </div>
    </div>

    <div class="footer__base">
      <span class="footer__copy">© <span data-year>2026</span> 桂林中学新媒体</span>
      <a class="footer__icp" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
        <span class="footer__icp-dot" aria-hidden="true"></span>
        桂ICP备2020008331号-1
      </a>
      <a class="footer__up" href="#top">回到顶部 ↑</a>
    </div>
  </div>
</footer>`;

const SITE_NAV = [
  { href: "/", label: "首页", key: "home" },
  { href: "/tools", label: "工具", key: "tools" },
  { href: "/image", label: "图床", key: "image" },
  { href: "/memories", label: "媒体库", key: "memories" },
];

export function siteShell({ title, body, current = "", scripts = "", head = "", bodyClass = "", description = "" }) {
  const nav = SITE_NAV.map(
    (item) => `<a href="${item.href}"${item.key === current ? ' aria-current="page"' : ""}>${item.label}</a>`,
  ).join("\n          ");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(title)} · 桂林中学新媒体</title>
<meta name="description" content="${e(description)}" />
<meta name="theme-color" content="#f6f3ec" />
${THEME_BOOT}
<link rel="icon" href="/assets/img/school-emblem-336.webp" type="image/webp" />
<link rel="preload" href="/assets/fonts/newsreader-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="/assets/css/style.css?v=${assetVersion()}" />
${head}
</head>
<body id="top"${bodyClass ? ` class="${bodyClass}"` : ""}>
<a class="skip" href="#main">跳到正文</a>
<header class="masthead">
  <div class="wrap masthead__inner">
    <a class="brand" href="/">
      <img class="brand__mark" src="/assets/img/school-emblem-336.webp" width="336" height="336" alt="桂林中学校徽" decoding="async" />
      <span class="brand__text">
        <span class="brand__name">桂林中学新媒体</span>
        <span class="brand__sub">XMT · Guilin Middle School</span>
      </span>
    </a>
    <nav class="nav" aria-label="主导航">
      ${nav}
    </nav>
    <div class="tools"></div>
  </div>
</header>
<main id="main">${body}</main>
${SITE_FOOT}
<script src="/assets/js/site.js?v=${assetVersion()}" type="module"></script>
${scripts}
</body>
</html>`;
}

/* ---------- 画廊 ---------- */

const card = (item) => {
  const isVideo = item.kind === "video";
  const media = isVideo
    ? `<video class="m-card__media" src="/memories/f/${item.id}" preload="metadata" muted playsinline></video><span class="m-card__play" aria-hidden="true">▶</span>`
    : `<img class="m-card__media" src="/memories/f/${item.id}" alt="${e(item.name)}" loading="lazy" decoding="async" ${
        item.width && item.height ? `width="${item.width}" height="${item.height}"` : ""
      } />`;
  return `<a class="m-card" href="/memories/a/${item.id}" data-id="${item.id}" data-kind="${item.kind}">
    <figure>${media}${item.is_hidden ? `<span class="m-card__flag">已隐藏</span>` : ""}</figure>
    <div class="m-card__meta">
      <span class="m-card__name">${e(item.name)}</span>
      <span class="m-card__sub">${e(item.owner_name || "—")} · ${fmtSize(item.size)}</span>
    </div>
  </a>`;
};

const ICON_FOLDER = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5V9h5"/></svg>`;

export function browsePage({
  site,
  user,
  drives,
  drive,
  path: currentPath,
  pretty = "/",
  entries = [],
  error = "",
  limit = "",
  canUpload = false,
}) {
  const crumbs = [];
  const prettyParts = String(pretty || "/").split("/").filter(Boolean);
  let walk = "";
  crumbs.push(`<a href="/memories/files${drive ? `?drive=${drive.id}` : ""}">${e(drive ? drive.name : "文件")}</a>`);
  String(currentPath || "/")
    .split("/")
    .filter(Boolean)
    .forEach((segment, index) => {
      walk += `/${segment}`;
      crumbs.push(
        `<a href="/memories/files?drive=${drive?.id}&path=${encodeURIComponent(walk)}">${e(prettyParts[index] || segment)}</a>`,
      );
    });

  const chips = drives
    .map(
      (item) =>
        `<a class="m-chip${drive && item.id === drive.id ? " is-on" : ""}" href="/memories/files?drive=${item.id}&path=/">${e(
          item.name,
        )}</a>`,
    )
    .join("");

  const rows = entries
    .slice()
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || String(a.name).localeCompare(String(b.name), "zh-Hans-CN"))
    .map((entry) => {
      const url = `/memories/files/raw?drive=${drive.id}&path=${encodeURIComponent(entry.path)}`;
      const name = entry.isDir
        ? `<a class="m-row__name" href="/memories/files?drive=${drive.id}&path=${encodeURIComponent(entry.path)}">${e(
            entry.name,
          )}/</a>`
        : `<a class="m-row__name" href="${url}" target="_blank" rel="noreferrer">${e(entry.name)}</a>`;
      return `<li class="m-row">
        <span class="m-row__ico${entry.isDir ? " is-dir" : ""}" aria-hidden="true">${entry.isDir ? ICON_FOLDER : ICON_FILE}</span>
        ${name}
        <span class="m-row__meta">${entry.isDir ? "" : fmtSize(entry.size)}</span>
        ${entry.isDir ? "" : `<a class="m-row__dl" href="${url}&download=1">下载</a>`}
      </li>`;
    })
    .join("");

  const body = `
<section class="m-hero">
  <p class="m-kicker">Memories · 媒体库</p>
  <h1>${e(drive ? drive.name : "媒体库")}</h1>
  <p class="m-hero__intro">${e(drive?.description || "这里按存储整理文件；游客只读，成员按权限上传。")}</p>
</section>
<div class="m-toolbar">
  <div class="m-chips">${chips}</div>
  ${canUpload ? `<label class="m-btn m-btn--primary">上传<input type="file" multiple hidden data-browse-upload data-drive="${drive.id}" data-folder="${e(currentPath)}" /></label>` : ""}
  ${canUpload && limit ? `<span class="m-toolbar__hint">${e(limit)}</span>` : ""}
</div>
<nav class="m-crumbs">${crumbs.join('<span class="m-crumbs__sep" aria-hidden="true">/</span>')}</nav>
${error ? `<p class="m-alert">${e(error)}</p>` : ""}
${rows ? `<ul class="m-rows">${rows}</ul>` : `<p class="m-empty">${drive ? "这个目录是空的。" : "还没有可查看的存储。"}</p>`}`;

  return shell({ title: drive ? drive.name : "媒体库", site, user, body, bodyClass: "m-page--files" });
}

export function galleryPage({ site, user, items, total, query, drives = [] }) {
  const sorts = [
    ["new", "最新"],
    ["old", "最早"],
    ["name", "名称"],
    ["size", "大小"],
  ];
  const currentSort = sorts.some(([key]) => key === query.sort) ? query.sort : "new";
  const sortLabel = sorts.find(([key]) => key === currentSort)[1];
  const sortHref = (key) =>
    `/memories?sort=${key}${query.q ? `&q=${encodeURIComponent(query.q)}` : ""}`;
  const body = `
<section class="m-hero">
  <p class="m-kicker">Memories · 校园媒体库</p>
  <h1>${e(site.title || "Memories")}</h1>
  <p class="m-hero__intro">${e(site.intro || "")}</p>
  <p class="m-hero__stats"><span>${total.n || 0} 项</span><span>${fmtSize(total.bytes)}</span>${
    user ? `<span>${e(roleLabel[user.role] || "成员")} · ${e(user.name || "")}</span>` : "<span>游客只读</span>"
  }</p>
</section>

<form class="m-toolbar" method="get" action="/memories">
  <div class="m-toolbar__right">
    <label class="m-search"><input type="search" name="q" value="${e(query.q || "")}" placeholder="搜索名称、备注、标签" /></label>
    <details class="m-sort" data-sort>
      <summary class="m-sort__btn" aria-label="排序：${sortLabel}">
        <span data-sort-label>${sortLabel}</span>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m4.6 6.4 3.4 3.4 3.4-3.4" /></svg>
      </summary>
      <div class="m-sort__menu" role="menu">
        ${sorts
          .map(
            ([key, label]) =>
              `<a class="m-sort__item${key === currentSort ? " is-on" : ""}" role="menuitemradio" aria-checked="${key === currentSort}" href="${sortHref(key)}">${label}</a>`,
          )
          .join("")}
      </div>
    </details>
    <div class="m-view" role="group" aria-label="视图">
      <button type="button" class="m-view__btn is-on" data-view="grid" title="网格">▦</button>
      <button type="button" class="m-view__btn" data-view="list" title="列表">☰</button>
    </div>
    ${user ? `<button type="button" class="m-btn m-btn--primary" data-upload-open>上传</button>` : `<a class="m-btn" href="/memories/login">登录后上传</a>`}
  </div>
</form>

${
  items.length
    ? `<div class="m-grid" data-grid>${items.map(card).join("")}</div>`
    : `<p class="m-empty">这里还什么都没有。${user ? "点右上角上传第一张。" : "登录后可以上传。"}</p>`
}
${user ? uploadDialog({ drives }) : ""}
`;
  return shell({ title: "媒体库", site, user, body, bodyClass: "m-page--gallery" });
}

export function uploadDialog({ drives = [] } = {}) {
  const usable = drives.filter((drive) => drive.enabled && (drive.allow_upload || drive.allow_upload === undefined));
  const options = usable
    .map(
      (drive) =>
        `<option value="${drive.id}" data-limit="${Number(drive.max_file_bytes) || 0}" data-desc="${e(
          drive.description || "",
        )}">${e(drive.name)}${drive.description ? ` · ${e(drive.description)}` : ""}</option>`,
    )
    .join("");
  return `<dialog class="m-modal" data-upload>
  <form method="dialog" class="m-modal__form" data-upload-form>
    <h2>上传到 Memories</h2>
    ${
      usable.length > 1
        ? `<label class="m-field"><span>上传到</span><select data-folder-drive name="drive">${options}</select></label>`
        : usable.length === 1
          ? `<input type="hidden" data-folder-drive name="drive" value="${usable[0].id}" />`
          : ""
    }
    <p class="m-modal__hint" data-limit-hint>照片和视频都行。照片单张不超过 250MB，视频不超过 10GB；存储如果单独设了上限，以存储的为准。</p>
    <label class="m-drop" data-drop>
      <input type="file" name="files" accept="image/*,video/*" multiple data-file />
      <span class="m-drop__text">点这里选文件，或者把文件拖进来</span>
    </label>
    <ul class="m-queue" data-queue></ul>
    <div class="m-modal__actions">
      <button type="button" class="m-btn" data-upload-cancel>取消</button>
      <button type="submit" class="m-btn m-btn--primary" data-upload-submit disabled>开始上传</button>
    </div>
    <div class="m-up" data-upload-progress hidden>
      <div class="m-up__bar"><i data-upload-bar></i></div>
      <div class="m-up__meta"><span data-upload-pct>0%</span><span data-upload-note>准备上传…</span></div>
    </div>
  </form>
</dialog>`;
}

/* ---------- 详情 ---------- */

export function detailPage({ site, user, item, neighbors }) {
  const isVideo = item.kind === "video";
  const canWrite = user && (user.role === "admin" || item.owner_id === user.id);
  const body = `
<article class="m-detail">
  <div class="m-detail__stage">
    ${isVideo
      ? `<video src="/memories/f/${item.id}" controls playsinline preload="metadata"></video>`
      : `<img src="/memories/f/${item.id}" alt="${e(item.name)}" />`}
  </div>
  <aside class="m-detail__side">
    <p class="m-kicker">${item.kind === "video" ? "视频" : "照片"} · ${e(item.drive_name || "")}</p>
    <h1 class="m-detail__name">${e(item.name)}</h1>
    ${item.is_hidden ? `<p class="m-alert m-alert--soft">这条内容在隐藏目录里，成员与游客看不到；管理员仍可查看和管理。</p>` : ""}
    <dl class="m-meta">
      <div><dt>上传者</dt><dd>${e(item.owner_name || "—")}</dd></div>
      <div><dt>时间</dt><dd>${fmtDate(item.created_at)}</dd></div>
      <div><dt>大小</dt><dd>${fmtSize(item.size)}</dd></div>
      ${item.width ? `<div><dt>尺寸</dt><dd>${item.width} × ${item.height}</dd></div>` : ""}
      <div><dt>路径</dt><dd class="m-meta__path">${e(item.path)}</dd></div>
    </dl>
    ${canWrite ? `<form class="m-form" data-meta-form data-id="${item.id}">
      <label><span>备注</span><input name="note" value="${e(item.note || "")}" placeholder="这张照片拍的是什么" /></label>
      <label><span>标签</span><input name="tags" value="${e(item.tags || "")}" placeholder="用逗号分开，比如：运动会, 高二" /></label>
      <button class="m-btn m-btn--primary" type="submit">保存</button>
    </form>` : item.note ? `<p class="m-note">${e(item.note)}</p>` : ""}
    <div class="m-actions">
      <a class="m-btn" href="/memories/f/${item.id}?download=${canWrite || user ? 1 : 0}" download>下载</a>
      <button class="m-btn" type="button" data-copy-link="${item.id}">复制链接</button>
      ${canWrite ? `<button class="m-btn m-btn--danger" type="button" data-delete="${item.id}">删除</button>` : ""}
    </div>
    <nav class="m-detail__nav">
      ${neighbors.prev ? `<a href="/memories/a/${neighbors.prev.id}">← 上一张</a>` : "<span></span>"}
      ${neighbors.next ? `<a href="/memories/a/${neighbors.next.id}">下一张 →</a>` : "<span></span>"}
    </nav>
  </aside>
</article>`;
  return shell({ title: item.name, site, user, body, bodyClass: "m-page--detail" });
}

/* ---------- 我的 ---------- */

/* ---------- 登录 ---------- */

export function loginPage({ site, error }) {
  const body = `
<section class="m-login">
  <p class="m-kicker">Memories</p>
  <h1>用校园墙账号登录</h1>
  <p class="m-hero__intro">${e(site.intro || "")}</p>
  ${error ? `<p class="m-alert">${e(error)}</p>` : ""}
  <a class="m-btn m-btn--primary m-btn--wide" href="/memories/oauth/start">使用 Campux 校园墙登录</a>
  <p class="m-login__hint">账号由管理员手动开通；没有开通的 QQ 号登录会被拒绝。游客可以直接浏览。</p>
</section>`;
  return shell({ title: "登录", site, user: null, body });
}

/* ---------- 分享页 ---------- */

export function sharePage({ site, share, items, owner }) {
  const body = `
<section class="m-hero m-hero--small">
  <p class="m-kicker">分享 · ${e(owner || "Memories")}</p>
  <h1>${items.length} 项内容</h1>
  <p class="m-hero__intro">这是一份只读分享${share.allow_download ? "，可以下载" : "，不允许下载"}。${
    share.expires_at ? `有效期到 ${fmtDate(share.expires_at)}。` : ""
  }</p>
</section>
${items.length ? `<div class="m-grid" data-grid>${items.map(card).join("")}</div>` : `<p class="m-empty">分享的内容已经不存在了。</p>`}
`;
  return shell({ title: "分享", site, user: null, body });
}

/* ---------- 分享（按路径分享的单文件 / 目录） ---------- */

const previewOf = (file, url) => {
  const mime = String(file.mime || "");
  if (mime.startsWith("image/")) return `<img class="m-view__img" src="${url}" alt="${e(file.name)}" decoding="async" />`;
  if (mime.startsWith("video/")) return `<video class="m-view__video" src="${url}" controls preload="metadata" playsinline></video>`;
  if (mime.startsWith("audio/")) return `<audio class="m-view__audio" src="${url}" controls preload="metadata"></audio>`;
  if (mime === "application/pdf") return `<iframe class="m-view__frame" src="${url}" title="${e(file.name)}"></iframe>`;
  if (mime.startsWith("text/") || /\.(md|txt|json|csv)$/i.test(file.name || "")) {
    return `<iframe class="m-view__frame" src="${url}" title="${e(file.name)}"></iframe>`;
  }
  return `<p class="m-empty">这种文件不内嵌预览。<a href="${url}">直接打开</a></p>`;
};

export function shareFilePage({ site, share, owner, file, entries = [], base }) {
  const rows = [
    ["名称", file.name],
    ["大小", fmtSize(file.size)],
    ["类型", file.mime || "—"],
    file.width && file.height ? ["分辨率", `${file.width} × ${file.height}`] : null,
    file.duration ? ["时长", fmtDuration(file.duration)] : null,
    file.fps ? ["帧率", `${file.fps} fps`] : null,
    file.modified ? ["修改时间", fmtDate(file.modified)] : null,
  ].filter(Boolean);

  const list = entries.length
    ? `<ul class="m-files">${entries
        .map(
          (entry) =>
            `<li><a href="${base}/file?path=${encodeURIComponent(entry.path)}">${
              entry.isDir ? "📁 " : ""
            }${e(entry.name)}</a><span>${entry.isDir ? "" : fmtSize(entry.size)}</span></li>`,
        )
        .join("")}</ul>`
    : "";

  const body = `
<section class="m-hero m-hero--small">
  <p class="m-kicker">分享 · ${e(owner || "Memories")}</p>
  <h1>${e(file.name || "分享")}</h1>
  <p class="m-hero__intro">这是一份只读分享${share.allow_download ? "，可以下载" : "，不允许下载"}。${
    share.expires_at ? `有效期到 ${fmtDate(share.expires_at)}。` : ""
  }</p>
</section>
${file.isDir ? "" : `<div class="m-media">${previewOf(file, `${base}/raw`)}</div>`}
${list}
<section class="m-panel">
  <dl class="m-dl">${rows.map(([key, value]) => `<div><dt>${e(key)}</dt><dd>${e(String(value))}</dd></div>`).join("")}</dl>
  ${
    share.allow_download && !file.isDir
      ? `<p><a class="m-btn" href="${base}/raw?download=1">下载文件</a></p>`
      : ""
  }
</section>
`;
  return shell({ title: file.name || "分享", site, user: null, body });
}


export const driveFieldSpecs = () =>
  Object.fromEntries(Object.entries(DRIVERS).map(([key, spec]) => [key, { label: spec.label, hint: spec.hint, fields: spec.fields }]));


/* ---------- 前台文件库（带操作的文件管理器） ---------- */

const fmIcon = (kind) =>
  kind === "dir"
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6.5 3.5h6l5 5V19a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" stroke-linejoin="round"/><path d="M12.5 3.5V9h5" stroke-linejoin="round"/></svg>';

const fmKindOf = (name) =>
  /\.(jpe?g|png|webp|gif|avif|bmp|heic)$/i.test(name)
    ? "image"
    : /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(name)
      ? "video"
      : /\.(mp3|wav|flac|m4a|aac|ogg)$/i.test(name)
        ? "audio"
        : /\.pdf$/i.test(name)
          ? "pdf"
          : "file";

export function filesPage({
  site,
  user,
  drives = [],
  drive = null,
  path: currentPath = "/",
  entries = [],
  stats = { files: 0, bytes: 0 },
  mine = null,
  canManage = false,
  rootLabel = "媒体库",
  strip = "",
  error = "",
  baseHref = "/memories/files",
  scope = "",
}) {
  if (!drive) {
    return shell({
      site,
      user,
      title: "媒体库",
      body: '<section class="page-head"><div class="wrap"><p class="kicker">Memories</p><h1>还没有可浏览的存储</h1><p class="lead">请管理员先在后台添加存储。</p></div></section>',
    });
  }

  const root = rootLabel;
  const base = strip && String(currentPath).startsWith(strip) ? strip : "";
  const relative = base ? String(currentPath).slice(base.length) : String(currentPath);
  const parts = String(relative)
    .split("/")
    .filter(Boolean);
  const crumbs = [
    `<a href="${baseHref}?drive=${drive.id}${scope ? `&scope=${scope}` : ""}">${e(root)}</a>`,
    ...parts.map((_, index) => {
      const sub = `${base}/${parts.slice(0, index + 1).join("/")}`;
      const name = parts[index];
      return `<a href="${baseHref}?drive=${drive.id}&path=${encodeURIComponent(sub)}${scope ? `&scope=${scope}` : ""}">${e(name)}</a>`;
    }),
  ].join('<span class="m-crumbs__sep">/</span>');

  const chips = drives
    .map(
      (item) =>
        `<a class="m-chip${item.id === drive.id ? " is-on" : ""}" href="${baseHref}?drive=${item.id}${scope ? `&scope=${scope}` : ""}">${e(item.name)}</a>`,
    )
    .join("");

  const skeletonRows = Array.from(
    { length: 5 },
    () => `<tr class="fm-skel"><td class="fm-tick"></td><td class="fm-name-cell"><span class="fm-skel__bar"></span></td><td class="fm-size"><span class="fm-skel__bar fm-skel__bar--short"></span></td><td class="fm-time"><span class="fm-skel__bar fm-skel__bar--short"></span></td><td class="fm-actions"></td></tr>`,
  ).join("");

  const deferred = entries === null;
  const rows = (entries || [])
    .map((entry) => {      const kind = entry.isDir ? "dir" : fmKindOf(entry.name);
      const name = entry.isDir
        ? `<a class="fm-name fm-name--dir" href="${baseHref}?drive=${drive.id}&path=${encodeURIComponent(entry.path)}${scope ? `&scope=${scope}` : ""}">${e(entry.name)}</a>`
        : `<button class="fm-name" type="button" data-fm-preview="${e(entry.path)}" data-fm-kind="${kind}">${e(entry.name)}</button>`;
      return `<tr data-fm-path="${e(entry.path)}" data-fm-dir="${entry.isDir ? 1 : 0}" data-fm-kind="${kind}" data-fm-size="${entry.size || 0}" data-fm-name="${e(entry.name)}">
        <td class="fm-tick"><button class="a-tick" type="button" data-fm-pick data-value="${e(entry.path)}" aria-pressed="false" aria-label="选择 ${e(entry.name)}"></button></td>
        <td class="fm-name-cell"><span class="fm-ico fm-ico--${kind}">${fmIcon(kind)}</span>${name}</td>
        <td class="fm-size">${entry.isDir ? "—" : fmtSize(entry.size)}</td>
        <td class="fm-time">${entry.modified ? e(String(entry.modified).slice(0, 16).replace("T", " ")) : "—"}</td>
        <td class="fm-actions">
          ${entry.isDir ? "" : `<button class="a-btn a-btn--tiny" type="button" data-fm-preview="${e(entry.path)}" data-fm-kind="${kind}">预览</button>`}
          <a class="a-btn a-btn--tiny" href="/memories/files/raw?drive=${drive.id}&path=${encodeURIComponent(entry.path)}&download=1">下载</a>
          <button class="a-btn a-btn--tiny" type="button" data-fm-info="${e(entry.path)}">信息</button>
          <button class="a-btn a-btn--tiny" type="button" data-fm-share="${e(entry.path)}">分享</button>
          ${canManage ? `<button class="a-btn a-btn--tiny" type="button" data-fm-rename="${e(entry.path)}" data-fm-name="${e(entry.name)}">改名</button><button class="a-btn a-btn--tiny a-btn--danger" type="button" data-fm-remove="${e(entry.path)}">删除</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  const statsLine = `<p class="fm-stats">全站 ${stats.files} 个文件 · ${fmtSize(stats.bytes)}${
    mine ? `　·　我的 ${mine.files} 个 · ${fmtSize(mine.bytes)}` : ""
  }</p>`;

  const body = `<section class="page-head">
    <div class="wrap">
      <p class="kicker">Memories · ${e(root)}</p>
      <h1>${e(drive.name)}</h1>
      <p class="lead">${e(drive.description || "按目录归档的校园影像。")}</p>
      ${statsLine}
      ${error ? `<p class="m-alert">${e(error)}</p>` : ""}
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <nav class="m-crumbs">${crumbs}</nav>
      <div class="fm-toolbar">
        <div class="m-chips">${chips}</div>
        <div class="fm-tools">
          ${user ? '<a class="a-btn" href="/image#mine">图床图片</a>' : ""}
          ${canManage ? '<button class="a-btn a-btn--primary" type="button" data-fm-mkdir>新建文件夹</button>' : ""}
          ${canManage ? `<label class="a-btn">上传<input type="file" multiple hidden data-fm-upload data-drive="${drive.id}" data-path="${e(currentPath)}" /></label>` : ""}
        </div>
      </div>

      <div class="a-selbar fm-selbar" data-fm-bar hidden>
        <span data-fm-count>已选 0 项</span>
        <button class="a-btn a-btn--tiny" type="button" data-fm-batch="download">下载</button>
        <button class="a-btn a-btn--tiny" type="button" data-fm-batch="share">分享</button>
        ${canManage ? '<button class="a-btn a-btn--tiny" type="button" data-fm-batch="move">移动</button><button class="a-btn a-btn--tiny" type="button" data-fm-batch="copy">复制</button><button class="a-btn a-btn--tiny" type="button" data-fm-batch="remove">删除</button>' : ""}
        <button class="a-btn a-btn--tiny" type="button" data-fm-clear>取消选择</button>
      </div>

      <table class="a-table fm-table" data-fm-drive="${drive.id}" data-fm-path="${e(currentPath)}" data-fm-base="${baseHref}" data-fm-scope="${scope}"${deferred ? ' data-fm-defer="1"' : ""}>
        <thead><tr>
          <th class="fm-tick"><button class="a-tick a-tick--all" type="button" data-fm-all aria-pressed="false" aria-label="全选"></button></th>
          <th>名称</th><th class="fm-size">大小</th><th class="fm-time">修改时间</th><th class="fm-actions">操作</th>
        </tr></thead>
        <tbody data-fm-rows>${deferred ? skeletonRows : rows || '<tr><td colspan="5" class="fm-empty">这个目录是空的。</td></tr>'}</tbody>
      </table>
      ${deferred ? `<script type="application/json" data-fm-boot>${JSON.stringify({ drive: drive.id, path: currentPath, scope, base: baseHref })}</script>` : ""}
      <p class="fm-note">点一行即可选中（按住 Shift 连选）。${
        canManage
          ? "删除会直接生效；移动 / 复制 / 打包在选中后出现。"
          : user
            ? "媒体库是只读的；要整理自己的文件，去「我的上传」。"
            : "游客只读。"
      }</p>
    </div>
  </section>

  <dialog class="a-dialog" data-fm-dialog>
    <form method="dialog" class="a-dialog__form">
      <header class="a-dialog__head"><h3 data-fm-title>预览</h3><button class="a-dialog__x" value="close" aria-label="关闭">×</button></header>
      <div class="a-dialog__body" data-fm-body></div>
      <footer class="a-dialog__foot" data-fm-foot></footer>
    </form>
  </dialog>`;

  return shell({
    site,
    user,
    title: `媒体库 · ${drive.name}`,
    body,
    head: `<link rel="stylesheet" href="/assets/css/admin.css?v=${assetVersion()}" />`,
    scripts: `<script src="/assets/js/files.js?v=${assetVersion()}" defer></script>`,
  });
}
