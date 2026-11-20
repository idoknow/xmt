// 服务端渲染的页面片段。样式来自 /assets/css/style.css + /memories/assets/app.css。
import { displayName, escapeHtml as e, qqAvatar } from "./util.mjs";
import { DRIVERS } from "./drives.mjs";

const year = new Date().getFullYear();

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

const roleLabel = { admin: "管理员", user: "成员" };

/** 头像：字母垫底，图片盖在上面；图挂了就露出字母，不至于空一个圈 */
const avatarTag = (user, className = "m-user__img", textClass = "m-user__text") => {
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
        <a role="menuitem" href="/memories">全部媒体</a>
        ${user.role === "admin" ? '<a role="menuitem" href="/memories/admin">后台管理</a>' : ""}
        <a role="menuitem" class="m-user__out" href="/memories/logout">退出登录</a>
      </div>
    </details>`;
};

export function shell({ title, site, user, body, bodyClass = "", scripts = "", head = "" }) {
  const nav = user
    ? `<a href="/memories">媒体库</a>${profile(user)}`
    : `<a href="/memories">媒体库</a><a href="/memories/login">登录</a>`;

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
<link rel="stylesheet" href="/assets/css/style.css" />
<link rel="stylesheet" href="/memories/assets/app.css" />
${head}
</head>
<body class="m-body ${bodyClass}">
<header class="m-top">
  <div class="m-top__inner">
    <a class="m-brand" href="/">
      <img src="/assets/img/school-emblem-336.webp" alt="" width="32" height="32" />
      <span><strong>${e(site.title || "Memories")}</strong><small>桂中校园媒体库</small></span>
    </a>
    <nav class="m-nav">${nav}
      <a href="/" class="m-nav__back">回站点</a>
    </nav>
  </div>
</header>
<main class="m-main">${body}</main>
<footer class="m-foot">
  <div class="m-foot__inner">
    <span>${e(site.title || "Memories")} — 桂林中学新媒体</span>
    <span>${year} · 学生维护</span>
  </div>
</footer>
<script src="/memories/assets/app.js" type="module"></script>
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
    <figure>${media}</figure>
    <div class="m-card__meta">
      <span class="m-card__name">${e(item.name)}</span>
      <span class="m-card__sub">${e(item.owner_name || "—")} · ${fmtSize(item.size)}</span>
    </div>
  </a>`;
};

export function galleryPage({ site, user, items, total, query }) {
  const sorts = [
    ["new", "最新"],
    ["old", "最早"],
    ["name", "名称"],
    ["size", "大小"],
  ];
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
    <label class="m-select"><select name="sort">${sorts
      .map(([key, label]) => `<option value="${key}"${(query.sort || "new") === key ? " selected" : ""}>${label}</option>`)
      .join("")}</select></label>
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
${user ? uploadDialog() : ""}
`;
  return shell({ title: "媒体库", site, user, body, bodyClass: "m-page--gallery" });
}

export function uploadDialog() {
  return `<dialog class="m-modal" data-upload>
  <form method="dialog" class="m-modal__form" data-upload-form>
    <h2>上传到 Memories</h2>
    <p class="m-modal__hint">照片和视频都行。照片单张不超过 30MB，视频不超过 512MB。</p>
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

export function myPage({ site, user, items, folder, drives }) {
  const body = `
<section class="m-hero m-hero--small">
  <p class="m-kicker">我的空间</p>
  <h1>${e(user.name || "我")} 的上传</h1>
  <p class="m-hero__intro">你上传的内容放在 <code>${e(folder)}</code> 里。只能改自己上传的东西。</p>
</section>
<div class="m-toolbar">
  <div class="m-chips"><a class="m-chip is-on" href="/memories/my">${items.length} 项</a></div>
  <div class="m-toolbar__right">
    ${drives.length > 1 ? `<label class="m-select"><select data-folder-drive>${drives.map((d) => `<option value="${d.id}">${e(d.name)}</option>`).join("")}</select></label>` : ""}
    <button type="button" class="m-btn m-btn--primary" data-upload-open>上传</button>
  </div>
</div>
${items.length ? `<div class="m-grid" data-grid>${items.map(card).join("")}</div>` : `<p class="m-empty">还没有上传过。点右上角开始。</p>`}
${uploadDialog()}
`;
  return shell({ title: "我的", site, user, body });
}

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

/* ---------- 后台 ---------- */

export function adminPage({ site, user, users, drives, settings, counters }) {
  const driveRows = drives
    .map(
      (drive) => `<tr>
        <td><strong>${e(drive.name)}</strong><small>${e(DRIVERS[drive.driver]?.label || drive.driver)}</small></td>
        <td data-label="目录" class="m-mono">${e(drive.root || "/")}</td>
        <td data-label="状态">${drive.enabled ? "启用" : "停用"}</td>
        <td data-label="可见">${e(drive.visibility)}</td>
        <td><div class="m-row-actions">
          <button class="m-btn m-btn--tiny" data-drive-test="${drive.id}">测试</button>
          <button class="m-btn m-btn--tiny m-btn--danger" data-drive-del="${drive.id}">删除</button>
        </div></td>
      </tr>`,
    )
    .join("");

  const userRows = users
    .map(
      (row) => `<tr data-user="${row.id}">
        <td><div class="m-member">
          <span class="m-ava">${avatarTag(row, "m-ava__img", "m-ava__text")}</span>
          <span class="m-member__text"><strong>${e(displayName(row))}</strong><small>QQ ${e(row.qq || "未绑定")}${
            row.note ? ` · ${e(row.note)}` : ""
          }</small></span>
        </div></td>
        <td data-label="角色">${e(roleLabel[row.role] || row.role)}</td>
        <td data-label="状态">${row.status === "active" ? "正常" : "停用"}</td>
        <td data-label="最近登录">${fmtDate(row.last_login_at)}</td>
        <td><div class="m-row-actions">
          <select data-role="${row.id}" class="m-select m-select--tiny">
            <option value="user"${row.role === "user" ? " selected" : ""}>成员</option>
            <option value="admin"${row.role === "admin" ? " selected" : ""}>管理员</option>
          </select>
          <button class="m-btn m-btn--tiny" data-toggle-user="${row.id}" data-status="${row.status}">${
            row.status === "active" ? "停用" : "启用"
          }</button>
        </div></td>
      </tr>`,
    )
    .join("");

  const body = `
<section class="m-hero m-hero--small">
  <p class="m-kicker">后台</p>
  <h1>${e(site.title || "Memories")} 管理</h1>
  <p class="m-hero__stats"><span>${counters.total.n || 0} 项内容</span><span>${fmtSize(counters.total.bytes)}</span><span>${
    counters.users.n || 0
  } 位成员</span><span>${counters.shares.n || 0} 个分享</span></p>
</section>

<div class="m-tabs" role="tablist">
  <button class="m-tab is-on" data-tab="users">成员</button>
  <button class="m-tab" data-tab="drives">存储</button>
  <button class="m-tab" data-tab="settings">设置</button>
</div>

<section class="m-panel is-on" data-panel="users">
  <form class="m-form m-form--row" data-add-user>
    <label><span>QQ 号</span><input name="qq" required pattern="\\d{5,12}" inputmode="numeric" placeholder="只填号码，如 1692138502" /></label>
    <label><span>备注</span><input name="note" placeholder="班级 / 职务（可选）" /></label>
    <button class="m-btn m-btn--primary" type="submit">添加成员</button>
  </form>
  <p class="m-hint">只填 QQ 号就能加人，昵称和头像等他第一次登录时从 Campux 同步；号码必须先加进来，否则登录会被拒绝。</p>
  <table class="m-table"><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>最近登录</th><th></th></tr></thead><tbody>${userRows}</tbody></table>
</section>

<section class="m-panel" data-panel="drives">
  <form class="m-form m-form--row" data-add-drive>
    <label><span>名称</span><input name="name" required placeholder="比如：移动云盘-新媒体" /></label>
    <label><span>类型</span><select name="driver">${Object.entries(DRIVERS)
      .map(([key, spec]) => `<option value="${key}">${e(spec.label)}</option>`)
      .join("")}</select></label>
    <button class="m-btn m-btn--primary" type="submit">添加存储</button>
  </form>
  <div data-drive-fields></div>
  <table class="m-table"><thead><tr><th>名称</th><th>根路径</th><th>状态</th><th>可见性</th><th></th></tr></thead><tbody>${driveRows}</tbody></table>
  <p class="m-hint">WebDAV 填地址与账号即可；移动云盘填 Authorization（网页端抓的 <code>pc:账号:令牌</code> 的 base64）。</p>
</section>

<section class="m-panel" data-panel="settings">
  <form class="m-form" data-settings>
    <label><span>站点标题</span><input name="site.title" value="${e(site.title || "")}" /></label>
    <label><span>介绍</span><input name="site.intro" value="${e(site.intro || "")}" /></label>
    <label><span>管理员 QQ</span><input name="admin.qq" value="${e(settings.adminQQ || "")}" /></label>
    <label><span>OAuth 站点</span><input name="oauth.issuer" value="${e(settings.issuer || "")}" /></label>
    <label><span>Client ID</span><input name="oauth.client_id" value="${e(settings.clientId || "")}" /></label>
    <label><span>Client Secret</span><input name="oauth.client_secret" value="${e(settings.clientSecret || "")}" type="password" /></label>
    <button class="m-btn m-btn--primary" type="submit">保存设置</button>
  </form>
</section>
`;
  return shell({ title: "后台", site, user, body, bodyClass: "m-page--admin" });
}

export const driveFieldSpecs = () =>
  Object.fromEntries(Object.entries(DRIVERS).map(([key, spec]) => [key, { label: spec.label, hint: spec.hint, fields: spec.fields }]));
