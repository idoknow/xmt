import { all, get, now, run } from "./db.mjs";
import { currentUser, isAdmin } from "./auth.mjs";
import { escapeHtml as e, html, redirect, sendJson } from "./util.mjs";
import { shell } from "./ui.mjs";
import { layout } from "./admin-ui.mjs";

/* ---------- 数据 ---------- */

export const listLinks = () => all("SELECT * FROM share_links ORDER BY sort_order, id");

const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

const normalizeUrl = (value) => {
  const text = clean(value, 500);
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
};

/* ---------- 前台页面 ---------- */

export function linksPage({ site, user }) {
  const links = listLinks();
  const rows = links
    .map((row, index) => {
      const number = String(index + 1).padStart(2, "0");
      return `<article class="m-link">
        <span class="m-link__no">${number}</span>
        <div class="m-link__body">
          <h3 class="m-link__name"><a href="${e(row.url)}" target="_blank" rel="noopener noreferrer">${e(row.title)}</a></h3>
          ${row.note ? `<p class="m-link__note">${e(row.note)}</p>` : ""}
          <p class="m-link__url"><a href="${e(row.url)}" target="_blank" rel="noopener noreferrer">${e(row.url)}</a></p>
        </div>
        ${
          row.code
            ? `<div class="m-link__code"><span>提取码</span><button class="m-chip" type="button" data-copy="${e(row.code)}">${e(row.code)}</button></div>`
            : ""
        }
      </article>`;
    })
    .join("");

  const body = `
<section class="m-hero">
  <p class="m-kicker">Shared links · 资料库</p>
  <h1>分享链接</h1>
  <p class="m-hero__intro">管理员放出来的资料库链接，提取码点一下就能复制。</p>
  <p class="m-hero__stats"><span>${links.length} 条链接</span><span>由管理员维护</span></p>
</section>
<section class="m-links">
  ${rows || `<p class="m-empty">还没有分享链接。</p>`}
</section>`;

  return shell({ title: "分享链接", site, user, body });
}

/* ---------- 后台页面 ---------- */

export function adminLinksPage({ site, user }) {
  const links = listLinks();
  const rows = links
    .map(
      (row) => `<tr>
      <td class="a-links__title"><strong>${e(row.title)}</strong></td>
      <td class="a-mono a-links__url" data-label="链接"><a href="${e(row.url)}" target="_blank" rel="noopener noreferrer" title="${e(row.url)}">${e(row.url)}</a></td>
      <td class="a-mono" data-label="提取码">${row.code ? e(row.code) : '<span class="a-hint">无</span>'}</td>
      <td data-label="备注">${row.note ? e(row.note) : '<span class="a-hint">—</span>'}</td>
      <td data-label="排序">${row.sort_order ?? 0}</td>
      <td><div class="a-actions__row">
        <button class="a-btn a-btn--tiny" type="button" data-link-edit="${row.id}">编辑</button>
        <button class="a-btn a-btn--tiny a-btn--danger" type="button" data-link-del="${row.id}">删除</button>
      </div></td>
    </tr>`,
    )
    .join("");

  const body = `
  <form class="a-form" data-link-form data-region>
    <input type="hidden" name="id" value="" />
    <div class="a-form__grid a-form__grid--links">
      <label><span>标题</span><input name="title" required maxlength="60" placeholder="中国移动云盘 ·「新媒体」" /></label>
      <label><span>链接</span><input name="url" required maxlength="500" placeholder="https://yun.139.com/shareweb/#/w/i/..." /></label>
      <label><span>提取码</span><input name="code" maxlength="20" placeholder="evaq" /></label>
      <label><span>备注</span><input name="note" maxlength="80" placeholder="活动的原片、成片与素材" /></label>
      <label><span>排序</span><input name="sort_order" type="number" value="0" /></label>
      <div class="a-form__actions">
        <button class="a-btn a-btn--primary" type="submit" data-link-submit>添加链接</button>
        <button class="a-btn" type="button" data-link-cancel hidden>取消编辑</button>
      </div>
    </div>
  </form>
  <p class="a-hint">前台「媒体库 → 分享链接」按这里的顺序展示；提取码在前台是一键复制的。</p>
  <div class="a-scroll" data-region><table class="a-table">
    <thead><tr><th>标题</th><th>链接</th><th>提取码</th><th>备注</th><th>排序</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="a-empty">还没有分享链接。上面加一条试试。</td></tr>`}</tbody>
  </table></div>
  <script type="application/json" id="links-data">${JSON.stringify(links).replace(/</g, "\\u003c")}</script>`;

  return layout({ site, user, section: "links", title: "分享链接", body });
}

/* ---------- 路由 ---------- */

export async function handleShareLinksAdmin(req, res, url) {
  const user = currentUser(req);
  if (!user) return redirect(res, "/memories/login");
  if (!isAdmin(user)) return html(res, 403, `<!doctype html><meta charset="utf-8"><p>只有管理员能进后台。</p>`);

  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/memories/admin/links" && method === "GET") {
    return html(res, 200, adminLinksPage({ site: "Memories", user }));
  }

  if (path === "/memories/api/links" && method === "GET") {
    return sendJson(res, 200, { ok: true, links: listLinks() });
  }

  if (path === "/memories/api/links" && method === "POST") {
    const body = await readJson(req);
    const title = clean(body.title, 60);
    const linkUrl = normalizeUrl(body.url);
    const code = clean(body.code, 20);
    const note = clean(body.note, 80);
    const sortOrder = Number(body.sort_order) || 0;
    if (!title || !linkUrl) return sendJson(res, 400, { ok: false, error: "标题和链接都要填，链接要以 http(s):// 开头" });

    if (body.id) {
      run(
        "UPDATE share_links SET title = ?, url = ?, code = ?, note = ?, sort_order = ? WHERE id = ?",
        title,
        linkUrl,
        code,
        note,
        sortOrder,
        Number(body.id),
      );
    } else {
      run(
        "INSERT INTO share_links (title, url, code, note, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        title,
        linkUrl,
        code,
        note,
        sortOrder,
        now(),
      );
    }
    return sendJson(res, 200, { ok: true, links: listLinks() });
  }

  const del = path.match(/^\/memories\/api\/links\/(\d+)$/);
  if (del && method === "DELETE") {
    run("DELETE FROM share_links WHERE id = ?", Number(del[1]));
    return sendJson(res, 200, { ok: true, links: listLinks() });
  }

  return html(res, 404, `<!doctype html><meta charset="utf-8"><p>没有这个地址：${e(path)}</p>`);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error("请求体太大"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

export const countLinks = () => (get("SELECT COUNT(*) AS n FROM share_links") || { n: 0 }).n;
