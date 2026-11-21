// 管理台（AList 风格）的页面骨架与四个分页：文件 / 存储 / 成员 / 设置。
import { DRIVERS } from "./drives.mjs";
import { displayName, escapeHtml as e } from "./util.mjs";
import { assetVersion, fmtSize, shell } from "./ui.mjs";

const NAV = [
  { key: "files", label: "文件", href: "/memories/admin/files", hint: "浏览、上传、改名、移动" },
  { key: "storages", label: "存储", href: "/memories/admin/storages", hint: "挂载与驱动配置" },
  { key: "users", label: "成员", href: "/memories/admin/users", hint: "QQ 与权限" },
  { key: "settings", label: "设置", href: "/memories/admin/settings", hint: "站点与登录" },
];

function layout({ site, user, section, title, body, scripts = "" }) {
  const nav = NAV.map(
    (item) => `<a class="a-nav__item${item.key === section ? " is-on" : ""}" href="${item.href}">
      <span class="a-nav__label">${e(item.label)}</span>
      <span class="a-nav__hint">${e(item.hint)}</span>
    </a>`,
  ).join("");

  const inner = `
<div class="a-shell">
  <aside class="a-side">
    <a class="a-side__brand" href="/memories">
      <span class="a-side__mark">M</span>
      <span><strong>媒体库</strong><small>管理台</small></span>
    </a>
    <nav class="a-nav">${nav}</nav>
    <div class="a-side__foot">
      <a href="/memories">← 回到媒体库</a>
      <span>${e(displayName(user))}</span>
    </div>
  </aside>
  <main class="a-main">
    <header class="a-head">
      <h1>${e(title)}</h1>
      ${section === "files" ? "" : ""}
    </header>
    ${body}
  </main>
</div>`;

  return shell({
    title,
    site,
    user,
    body: inner,
    bodyClass: "m-page--admin",
    scripts: `<script src="/assets/js/admin.js?v=${assetVersion()}" type="module"></script>${scripts}`,
    head: `<link rel="stylesheet" href="/assets/css/admin.css?v=${assetVersion()}" />`,
  });
}

/* ---------- 文件 ---------- */

const crumbOf = (drive, currentPath) => {
  const parts = String(currentPath || "/").split("/").filter(Boolean);
  const base = `/memories/admin/files?drive=${drive.id}`;
  const crumbs = [`<a href="${base}&path=/">根目录</a>`];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push(`<a href="${base}&path=${encodeURIComponent(acc)}">${e(part)}</a>`);
  }
  return crumbs.join('<span class="a-crumb__sep">/</span>');
};

export function adminFilesPage({
  site,
  user,
  drives,
  drive,
  path: currentPath,
  entries,
  notice,
  error,
  quota,
  sortKey = "name",
  sortDir = "asc",
}) {
  const driveTabs = drives
    .map(
      (item) =>
        `<a class="a-chip${drive && item.id === drive.id ? " is-on" : ""}" href="/memories/admin/files?drive=${item.id}&path=/">${e(
          item.name,
        )}<small>${e(DRIVERS[item.driver]?.label || item.driver)}</small></a>`,
    )
    .join("");

  const sortHref = (key) => {
    const dir = key === sortKey && sortDir === "asc" ? "desc" : "asc";
    return `/memories/admin/files?drive=${drive ? drive.id : ""}&path=${encodeURIComponent(currentPath)}&sort=${key}&dir=${dir}`;
  };
  const sortLabel = (key, text) =>
    `<a class="a-sort${key === sortKey ? " is-on" : ""}" href="${sortHref(key)}">${text}${
      key === sortKey ? `<i>${sortDir === "asc" ? "↑" : "↓"}</i>` : ""
    }</a>`;

  const rows = entries
    .map((entry) => {
      const name = entry.isDir
        ? `<a class="a-name a-name--dir" href="/memories/admin/files?drive=${drive.id}&path=${encodeURIComponent(entry.path)}">${e(entry.name)}</a>`
        : `<button class="a-name a-name--file" type="button" data-preview="${e(entry.path)}" data-name="${e(entry.name)}" data-size="${
            entry.size || 0
          }">${e(entry.name)}</button>`;
      const preview = entry.isDir
        ? ""
        : `<button class="a-btn a-btn--tiny" type="button" data-preview="${e(entry.path)}" data-name="${e(entry.name)}" data-size="${
            entry.size || 0
          }">预览</button>`;
      return `<tr data-path="${e(entry.path)}" data-dir="${entry.isDir ? "1" : "0"}">
        <td class="a-check"><input type="checkbox" data-pick value="${e(entry.path)}" ${entry.isDir ? 'data-is-dir="1"' : ""} aria-label="${e(
          entry.name,
        )}" /></td>
        <td class="a-cell-name"><span class="a-ico${entry.isDir ? " a-ico--dir" : ""}"></span>${name}</td>
        <td class="a-num">${entry.isDir ? "—" : fmtSize(entry.size)}</td>
        <td class="a-mono">${entry.modified ? e(String(entry.modified).slice(0, 16).replace("T", " ")) : "—"}</td>
        <td class="a-actions"><div class="a-actions__row">
          ${preview}
          ${
            entry.isDir
              ? ""
              : `<a class="a-btn a-btn--tiny" href="/memories/admin/files/raw?drive=${drive.id}&path=${encodeURIComponent(
                  entry.path,
                )}&download=1">下载</a>`
          }
          <button class="a-btn a-btn--tiny" type="button" data-rename="${e(entry.path)}" data-name="${e(entry.name)}">改名</button>
          <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-remove="${e(entry.path)}" data-name="${e(
            entry.name,
          )}">删除</button>
        </div></td>
      </tr>`;
    })
    .join("");

  const body = `
  <div class="a-bar a-bar--tabs">${driveTabs}</div>
  ${notice ? `<p class="a-note a-note--ok">${e(notice)}</p>` : ""}
  ${error ? `<p class="a-note a-note--bad">${e(error)}</p>` : ""}
  ${
    drive
      ? `<div class="a-crumb">${crumbOf(drive, currentPath)}</div>
  <div class="a-toolbar">
    <label class="a-btn a-btn--primary"><input type="file" multiple data-upload hidden />上传</label>
    <button class="a-btn" type="button" data-mkdir>新建文件夹</button>
    <span class="a-toolbar__spacer"></span>
    <span class="a-sorts">${sortLabel("name", "名称")}${sortLabel("size", "大小")}${sortLabel("time", "时间")}</span>
  </div>
  <div class="a-selbar" data-selbar hidden>
    <span class="a-selbar__count" data-sel-count>已选 0 项</span>
    <button class="a-btn a-btn--tiny" type="button" data-batch="move">移动</button>
    <button class="a-btn a-btn--tiny" type="button" data-batch="copy">复制</button>
    <button class="a-btn a-btn--tiny" type="button" data-batch="download">下载</button>
    <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-batch="remove">删除</button>
    <span class="a-toolbar__spacer"></span>
    <button class="a-btn a-btn--tiny" type="button" data-clear>取消选择</button>
  </div>
  <div class="a-up" data-upload-progress hidden><div class="a-up__bar"><i data-upload-bar></i></div><span data-upload-note></span></div>
  <table class="a-table a-table--files">
    <thead><tr><th class="a-check"><input type="checkbox" data-pick-all aria-label="全选" /></th><th>名称</th><th>大小</th><th>修改时间</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="a-empty">这个目录是空的。</td></tr>`}</tbody>
  </table>
  <p class="a-hint">点一行即可选中（按住 Shift 选一段）；删除会直接生效，139 上是进回收站。</p>

  <dialog class="a-dialog" data-dialog>
    <form class="a-dialog__form" data-dialog-form>
      <div class="a-dialog__head">
        <strong data-dialog-title>操作</strong>
        <button class="a-btn a-btn--tiny" type="button" data-dialog-close>关闭</button>
      </div>
      <div class="a-dialog__body" data-dialog-body></div>
      <div class="a-dialog__foot">
        <button class="a-btn" type="button" data-dialog-close>取消</button>
        <button class="a-btn a-btn--primary" type="submit" data-dialog-ok>确定</button>
      </div>
    </form>
  </dialog>`
      : `<p class="a-empty">先在「存储」里添加一个存储。</p>`
  }`;

  return layout({ site, user, section: "files", title: drive ? `${drive.name} · 文件` : "文件", body });
}

/* ---------- 存储 ---------- */

export function adminStoragesPage({ site, user, drives }) {
  const rows = drives
    .map(
      (drive) => `<tr>
      <td><strong>${e(drive.name)}</strong></td>
      <td class="a-mono" data-label="挂载">${e(drive.mount_path || `/ ${drive.name}`)}</td>
      <td data-label="驱动">${e(DRIVERS[drive.driver]?.label || drive.driver)}</td>
      <td class="a-mono" data-label="根">${e(drive.root || "/")}</td>
      <td data-label="状态">${drive.enabled ? '<span class="a-tag a-tag--ok">启用</span>' : '<span class="a-tag">停用</span>'}</td>
      <td data-label="可见">${drive.visibility === "public" ? "公开" : "成员"}</td>
      <td data-label="隐藏">${drive.hidden?.length ? `${drive.hidden.length} 个` : "—"}</td>
      <td><div class="a-actions__row">
        <a class="a-btn a-btn--tiny" href="/memories/admin/files?drive=${drive.id}&path=/">打开</a>
        <button class="a-btn a-btn--tiny" type="button" data-drive-edit="${drive.id}">编辑</button>
        <button class="a-btn a-btn--tiny" type="button" data-drive-test="${drive.id}">测试</button>
        <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-drive-del="${drive.id}">删除</button>
      </div></td>
    </tr>`,
    )
    .join("");

  const drivesData = drives.map((drive) => ({
    id: drive.id,
    name: drive.name,
    driver: drive.driver,
    mount_path: drive.mount_path || "",
    root: drive.root || "/",
    visibility: drive.visibility,
    enabled: Boolean(drive.enabled),
    hidden: drive.hidden || [],
    config: JSON.parse(drive.config || "{}"),
  }));

  const body = `
  <form class="a-form" data-add-drive data-drive-id="">
    <div class="a-form__grid">
      <label><span>名称</span><input name="name" required placeholder="移动云盘" /></label>
      <label><span>类型</span><select name="driver">${Object.entries(DRIVERS)
        .map(([key, spec]) => `<option value="${key}">${e(spec.label)}</option>`)
        .join("")}</select></label>
      <label><span>挂载路径</span><input name="mount_path" placeholder="/139" /></label>
      <label><span>根路径</span><input name="root" value="/" placeholder="/" /></label>
      <label><span>可见性</span><select name="visibility"><option value="members">成员可见</option><option value="public">公开</option></select></label>
      <label class="a-form__check"><input type="checkbox" name="enabled" checked /><span>启用</span></label>
      <label class="a-form__wide"><span>隐藏目录</span>
        <div class="a-pick" data-hidden-box>
          <p class="a-hint" data-hidden-empty>还没有隐藏任何目录。</p>
          <ul class="a-pick__chips" data-hidden-chips></ul>
          <div class="a-pick__row">
            <button class="a-btn a-btn--tiny" type="button" data-hidden-open>选择目录</button>
            <span class="a-hint">只对成员与游客生效；管理员始终能看到。</span>
          </div>
          <input type="hidden" name="hidden" data-hidden-input value="" />
        </div>
      </label>
      <div class="a-form__actions">
        <button class="a-btn a-btn--primary" type="submit" data-drive-submit>添加存储</button>
        <button class="a-btn" type="button" data-drive-cancel hidden>取消</button>
      </div>
    </div>
  </form>
  <div data-drive-fields></div>

  <dialog class="a-dialog" data-drive-dialog>
    <div class="a-dialog__head"><strong data-dialog-title>选择目录</strong><button class="a-btn a-btn--tiny" type="button" data-dialog-close>关闭</button></div>
    <div class="a-pick__bar">
      <button class="a-btn a-btn--tiny" type="button" data-pick-up>← 上一级</button>
      <code data-pick-path>/</code>
      <button class="a-btn a-btn--tiny" type="button" data-pick-hide-here hidden>隐藏此目录</button>
    </div>
    <div class="a-pick__list" data-pick-list></div>
    <p class="a-hint" data-pick-note></p>
  </dialog>

  <table class="a-table">
    <thead><tr><th>名称</th><th>挂载</th><th>驱动</th><th>根</th><th>状态</th><th>可见</th><th>隐藏</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="8" class="a-empty">还没有存储。</td></tr>`}</tbody>
  </table>
  <script type="application/json" id="drives-data">${JSON.stringify(drivesData).replace(/</g, "\\u003c")}</script>`;

  return layout({ site, user, section: "storages", title: "存储", body });
}

/* ---------- 成员 ---------- */

const roleLabel = { admin: "管理员", user: "成员" };

export function adminUsersPage({ site, user, users }) {
  const rows = users
    .map(
      (row) => `<tr>
      <td><strong>${e(displayName(row))}</strong><small class="a-mono">QQ ${e(row.qq || "未绑定")}</small></td>
      <td data-label="备注">${e(row.note || "—")}</td>
      <td data-label="角色">${e(roleLabel[row.role] || row.role)}</td>
      <td data-label="状态">${row.status === "active" ? '<span class="a-tag a-tag--ok">正常</span>' : '<span class="a-tag">停用</span>'}</td>
      <td data-label="最近登录" class="a-mono">${row.last_login_at ? e(String(row.last_login_at).slice(0, 16).replace("T", " ")) : "—"}</td>
      <td><div class="a-actions__row">
        <select data-role="${row.id}" class="a-select">
          <option value="user"${row.role === "user" ? " selected" : ""}>成员</option>
          <option value="admin"${row.role === "admin" ? " selected" : ""}>管理员</option>
        </select>
        <button class="a-btn a-btn--tiny" type="button" data-toggle-user="${row.id}" data-status="${row.status}">${
          row.status === "active" ? "停用" : "启用"
        }</button>
        <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-remove-user="${row.id}">移除</button>
      </div></td>
    </tr>`,
    )
    .join("");

  const body = `
  <form class="a-form" data-add-user>
    <div class="a-form__grid">
      <label><span>QQ 号</span><input name="qq" required pattern="\\d{5,12}" inputmode="numeric" placeholder="1692138502" /></label>
      <label><span>备注</span><input name="note" placeholder="高一 3 班 / 摄影社" /></label>
      <div class="a-form__actions"><button class="a-btn a-btn--primary" type="submit">添加成员</button></div>
    </div>
  </form>
  <p class="a-hint">只填 QQ 号就能加人；昵称与头像等他第一次登录时从 Campux 同步，没加进来的 QQ 登录会被拒绝。</p>
  <table class="a-table">
    <thead><tr><th>成员</th><th>备注</th><th>角色</th><th>状态</th><th>最近登录</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="a-empty">还没有成员。</td></tr>`}</tbody>
  </table>`;

  return layout({ site, user, section: "users", title: "成员", body });
}

/* ---------- 设置 ---------- */

export function adminSettingsPage({ site, user, settings, counters }) {
  const body = `
  <p class="a-hint">站点统计：${counters.total.n || 0} 项内容 · ${fmtSize(counters.total.bytes)} · ${counters.users.n || 0} 位成员 · ${
    counters.shares.n || 0
  } 个分享</p>
  <form class="a-form" data-settings>
    <div class="a-form__grid">
      <label><span>站点标题</span><input name="site.title" value="${e(site.title || "")}" /></label>
      <label><span>介绍</span><input name="site.intro" value="${e(site.intro || "")}" /></label>
      <label><span>管理员 QQ</span><input name="admin.qq" value="${e(settings.adminQQ || "")}" /></label>
      <label><span>OAuth 站点</span><input name="oauth.issuer" value="${e(settings.issuer || "")}" /></label>
      <label><span>Client ID</span><input name="oauth.client_id" value="${e(settings.clientId || "")}" /></label>
      <label><span>Client Secret</span><input name="oauth.client_secret" type="password" value="${e(settings.clientSecret || "")}" /></label>
      <div class="a-form__actions"><button class="a-btn a-btn--primary" type="submit">保存设置</button></div>
    </div>
  </form>
  <p class="a-hint">OAuth 凭据也可以由集群 Secret 注入；这里改过就以数据库里的为准。回调地址固定为 <code>https://xmt.idoknow.top/memories/oauth/callback</code>。</p>`;

  return layout({ site, user, section: "settings", title: "设置", body });
}
