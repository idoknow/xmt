// 在线工具页的清单数据与后台维护（工具导航 / 软件下载）。
import { all, get, now, run } from "./db.mjs";
import { currentUser, isAdmin } from "./auth.mjs";
import { escapeHtml as e } from "./util.mjs";
import { assetVersion, shell } from "./ui.mjs";
import { layout } from "./admin-ui.mjs";

const decodeLinks = (raw) => {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list)
      ? list
          .map((item) => ({ label: String(item?.label || ""), url: String(item?.url || "") }))
          .filter((item) => item.url)
      : [];
  } catch {
    return [];
  }
};

export function catalog() {
  const links = all(
    "SELECT id, name, url, note, category FROM tool_links WHERE enabled = 1 ORDER BY sort_order, id",
  ).map((row) => ({ ...row }));
  const software = all(
    "SELECT id, name, category, devices, size, note, links FROM software WHERE enabled = 1 ORDER BY sort_order, id",
  ).map((row) => ({ ...row, links: decodeLinks(row.links) }));
  return { links, software };
}

export function catalogJson() {
  return { ok: true, ...catalog() };
}

/* ---------- 后台：工具导航 ---------- */

const linkRows = (rows) =>
  rows
    .map(
      (row) => `<tr>
      <td><div class="a-name-cell"><strong>${e(row.name)}</strong><small class="a-mono">${e(row.url)}</small></div></td>
      <td data-label="说明">${e(row.note || "—")}</td>
      <td data-label="排序" class="a-mono">${row.sort_order}</td>
      <td data-label="状态"><span class="a-pill ${row.enabled ? "a-pill--on" : "a-pill--off"}">${
        row.enabled ? "展示中" : "已隐藏"
      }</span></td>
      <td><div class="a-actions__row">
        <button class="a-btn a-btn--tiny" type="button" data-edit-link="${row.id}">编辑</button>
        <button class="a-btn a-btn--tiny" type="button" data-toggle-link="${row.id}" data-enabled="${row.enabled}">${
          row.enabled ? "隐藏" : "显示"
        }</button>
        <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-remove-link="${row.id}">删除</button>
      </div></td>
    </tr>`,
    )
    .join("");

const softwareRows = (rows) =>
  rows
    .map((row) => {
      const links = decodeLinks(row.links);
      return `<tr>
      <td><div class="a-name-cell"><strong>${e(row.name)}</strong><small class="a-mono">${links.length} 条下载线路</small></div></td>
      <td data-label="分类">${row.category ? `<span class="a-chip">${e(row.category)}</span>` : "—"}</td>
      <td data-label="适配">${e(row.devices || "—")}</td>
      <td data-label="大小">${e(row.size || "—")}</td>
      <td data-label="状态"><span class="a-pill ${row.enabled ? "a-pill--on" : "a-pill--off"}">${
        row.enabled ? "展示中" : "已隐藏"
      }</span></td>
      <td><div class="a-actions__row">
        <button class="a-btn a-btn--tiny" type="button" data-edit-soft="${row.id}">编辑</button>
        <button class="a-btn a-btn--tiny" type="button" data-toggle-soft="${row.id}" data-enabled="${row.enabled}">${
          row.enabled ? "隐藏" : "显示"
        }</button>
        <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-remove-soft="${row.id}">删除</button>
      </div></td>
    </tr>`;
    })
    .join("");

export function adminToolsPage({ site, user }) {
  const rows = all("SELECT * FROM tool_links ORDER BY sort_order, id");
  const enabled = rows.filter((row) => row.enabled).length;
  const body = `
  <header class="a-page__head">
    <div>
      <p class="a-sub">这里的条目显示在前台「在线图片工具」里，按排序值从小到大排列；隐藏的条目在前台不出现。</p>
    </div>
    <div class="a-page__aside">
      <span class="a-pill">共 ${rows.length} 条 · 展示 ${enabled}</span>
      <a class="a-btn a-btn--tiny" href="/tools#links" target="_blank" rel="noopener">前台预览</a>
    </div>
  </header>

  <section class="a-card a-card--pad">
    <header class="a-card__head a-card__head--row"><h3>条目</h3><button class="a-btn a-btn--primary" type="button" data-link-open>＋ 添加条目</button></header>
    <p class="a-hint">点「添加条目」展开表单；点表格里的「编辑」也可以直接改这一条。</p>
    <form class="a-form" data-link-form hidden>
      <input type="hidden" name="id" value="" />
      <div class="a-form__grid">
        <label><span>名称</span><input name="name" required maxlength="40" placeholder="Squoosh" /></label>
        <label><span>链接</span><input name="url" required type="url" placeholder="https://squoosh.app/" /></label>
                <label><span>排序</span><input name="sort_order" type="number" value="0" step="1" /></label>
        <label class="a-form__wide"><span>说明</span><input name="note" maxlength="80" placeholder="一行说明，展示在链接右侧" /></label>
      </div>
      <div class="a-form__actions"><button class="a-btn a-btn--primary" type="submit" data-link-submit>添加链接</button><button class="a-btn" type="button" data-link-cancel hidden>取消编辑</button></div>
    </form>
  </section>

  <section class="a-card">
    <header class="a-card__head a-card__head--row"><h3>全部条目</h3><p class="a-hint">排序值相同则按添加顺序。</p></header>
    <table class="a-table" data-link-table>
      <thead><tr><th>名称</th><th>说明</th><th>排序</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows.length ? linkRows(rows) : '<tr><td colspan="5" class="a-empty">还没有条目。上面填一条试试，例如 <strong>Squoosh</strong> → https://squoosh.app/</td></tr>'}</tbody>
    </table>
  </section>`;
  return layout({ site, user, section: "tools", title: "在线工具清单", body, scripts: toolsScript() });
}

export function adminSoftwarePage({ site, user }) {
  const rows = all("SELECT * FROM software ORDER BY sort_order, id");
  const enabled = rows.filter((row) => row.enabled).length;
  const body = `
  <header class="a-page__head">
    <div>
      <p class="a-sub">每条软件可以挂多条下载线路（网盘、官网、校内镜像都行），前台按卡片列出。</p>
    </div>
    <div class="a-page__aside">
      <span class="a-pill">共 ${rows.length} 条 · 展示 ${enabled}</span>
      <a class="a-btn a-btn--tiny" href="/tools#software" target="_blank" rel="noopener">前台预览</a>
    </div>
  </header>

  <section class="a-card a-card--pad">
    <header class="a-card__head a-card__head--row"><h3>软件</h3><button class="a-btn a-btn--primary" type="button" data-soft-open>＋ 添加软件</button></header>
    <p class="a-hint">点「添加软件」展开表单；适配设备与大小可留空，前台会自动省略这两项。</p>
    <form class="a-form" data-soft-form hidden>
      <input type="hidden" name="id" value="" />
      <div class="a-form__grid">
        <label><span>名称</span><input name="name" required maxlength="40" placeholder="Photoshop 2024" /></label>
        <label><span>分类</span><input name="category" maxlength="20" placeholder="图像 / 视频 / 工具" /></label>
        <label><span>适配设备</span><input name="devices" maxlength="60" placeholder="Windows 10/11 · macOS 12+" /></label>
        <label><span>大小</span><input name="size" maxlength="20" placeholder="2.1 GB" /></label>
        <label><span>排序</span><input name="sort_order" type="number" value="0" step="1" /></label>
        <label class="a-form__wide"><span>说明</span><input name="note" maxlength="120" placeholder="一句话说明，可写授权方式" /></label>
      </div>
      <div class="a-form__wide">
        <span class="a-fieldset__title">下载线路</span>
        <p class="a-hint">名称写「百度网盘」「官网直链」之类，前台会把它做成按钮。</p>
        <div class="a-link-editor" data-soft-links></div>
        <button class="a-btn a-btn--tiny" type="button" data-soft-add>＋ 加一条线路</button>
      </div>
      <div class="a-form__actions"><button class="a-btn a-btn--primary" type="submit" data-soft-submit>添加软件</button><button class="a-btn" type="button" data-soft-cancel hidden>取消编辑</button></div>
    </form>
  </section>

  <section class="a-card">
    <header class="a-card__head a-card__head--row"><h3>全部软件</h3><p class="a-hint">隐藏后前台不显示，但数据保留。</p></header>
    <table class="a-table" data-soft-table>
      <thead><tr><th>名称</th><th>分类</th><th>适配</th><th>大小</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows.length ? softwareRows(rows) : '<tr><td colspan="6" class="a-empty">还没有软件。上面加一条，例如 <strong>Photoshop 2024</strong>。</td></tr>'}</tbody>
    </table>
  </section>
  <script type="application/json" id="tools-data">${JSON.stringify({
    links: all("SELECT * FROM tool_links ORDER BY sort_order, id"),
    software: all("SELECT * FROM software ORDER BY sort_order, id").map((row) => ({ ...row, links: decodeLinks(row.links) })),
  }).replace(/</g, "\\u003c")}</script>`;
  return layout({ site, user, section: "software", title: "软件下载", body, scripts: toolsScript() });
}

const toolsScript = () =>
  `<script src="/assets/js/tools-admin.js?v=${assetVersion()}" type="module"></script>`;

/* ---------- 路由 ---------- */

const json = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const cleanText = (value, max = 200) => String(value ?? "").trim().slice(0, max);

export function toolsDataHandler(req, res) {
  json(res, 200, catalogJson());
}

export function handleToolsAdmin(req, res, url) {
  return router(req, res, url);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw Object.assign(new Error("请求体太大"), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function router(req, res, url) {
  const user = currentUser(req);
  if (!user) {
    res.writeHead(302, { location: "/memories/login" });
    res.end();
    return;
  }
  if (!isAdmin(user)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("需要管理员权限");
    return;
  }
  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/memories/admin/tools" && method === "GET") {
    return sendPage(res, adminToolsPage({ site: "Memories", user }));
  }
  if (path === "/memories/admin/software" && method === "GET") {
    return sendPage(res, adminSoftwarePage({ site: "Memories", user }));
  }

  if (path === "/memories/api/tools/links" && method === "POST") {
    const body = await readJsonBody(req);
    const name = cleanText(body.name, 40);
    const linkUrl = cleanText(body.url, 300);
    if (!name || !linkUrl) return json(res, 400, { ok: false, error: "名称和链接都要填" });
    const fields = [name, linkUrl, cleanText(body.note, 80), cleanText(body.category, 20), Number(body.sort_order) || 0];
    if (body.id) {
      run("UPDATE tool_links SET name = ?, url = ?, note = ?, category = ?, sort_order = ? WHERE id = ?", ...fields, Number(body.id));
    } else {
      run("INSERT INTO tool_links (name, url, note, category, sort_order, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)", ...fields, now());
    }
    return json(res, 200, { ok: true, links: all("SELECT * FROM tool_links ORDER BY sort_order, id") });
  }

  const linkId = path.match(/^\/memories\/api\/tools\/links\/(\d+)(\/toggle)?$/);
  if (linkId) {
    const id = Number(linkId[1]);
    if (method === "DELETE") {
      run("DELETE FROM tool_links WHERE id = ?", id);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && linkId[2]) {
      run("UPDATE tool_links SET enabled = 1 - enabled WHERE id = ?", id);
      return json(res, 200, { ok: true });
    }
  }

  if (path === "/memories/api/tools/software" && method === "POST") {
    const body = await readJsonBody(req);
    const name = cleanText(body.name, 40);
    if (!name) return json(res, 400, { ok: false, error: "名称要填" });
    const links = Array.isArray(body.links)
      ? body.links
          .map((item) => ({ label: cleanText(item?.label, 40), url: cleanText(item?.url, 300) }))
          .filter((item) => item.url)
      : [];
    const fields = [
      name,
      cleanText(body.category, 20),
      cleanText(body.devices, 60),
      cleanText(body.size, 20),
      cleanText(body.note, 120),
      JSON.stringify(links),
      Number(body.sort_order) || 0,
    ];
    if (body.id) {
      run(
        "UPDATE software SET name = ?, category = ?, devices = ?, size = ?, note = ?, links = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        ...fields,
        now(),
        Number(body.id),
      );
    } else {
      run(
        "INSERT INTO software (name, category, devices, size, note, links, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
        ...fields,
        now(),
      );
    }
    return json(res, 200, { ok: true });
  }

  const softId = path.match(/^\/memories\/api\/tools\/software\/(\d+)(\/toggle)?$/);
  if (softId) {
    const id = Number(softId[1]);
    if (method === "DELETE") {
      run("DELETE FROM software WHERE id = ?", id);
      return json(res, 200, { ok: true });
    }
    if (method === "POST" && softId[2]) {
      run("UPDATE software SET enabled = 1 - enabled WHERE id = ?", id);
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { ok: false, error: "接口不存在" });
}

function sendPage(res, markup) {
  const body = Buffer.from(markup, "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
    "content-length": body.length,
  });
  res.end(body);
}
