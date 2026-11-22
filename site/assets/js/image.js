const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const LIMITS = JSON.parse(document.querySelector("[data-limits]")?.dataset.limits || "{}");
const HISTORY_KEY = "xmt-image-history";
const LOGGED_IN = Boolean(document.querySelector("[data-user-id]")?.dataset.userId);

let provider = "scdn";
let total = Number($("[data-total]")?.dataset.total || 0);

// 只有失控图床支持输出格式 / CDN 线路 / 存储位置
const PROVIDERS = { scdn: { opts: true } };
const optsBox = $("[data-opts]");
const optValue = (key) => $(`[data-select="${key}"]`)?.dataset.value || "";
const opts = () => ({
  format: optValue("format"),
  cdn: optValue("cdn"),
  storage: optValue("storage"),
});

function initSelect(box) {
  const button = $("[data-select-btn]", box);
  const menu = $("[data-select-menu]", box);
  const text = $("[data-select-text]", box);
  if (!button || !menu || !text) return;
  const close = () => {
    box.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    $$(".im-select.is-open").forEach((other) => other !== box && other.classList.remove("is-open"));
    const open = box.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(open));
  });
  $$("[data-option]", menu).forEach((option) => {
    option.addEventListener("click", () => {
      box.dataset.value = option.dataset.option || "";
      text.textContent = option.textContent.trim();
      $$("[data-option]", menu).forEach((item) => item.setAttribute("aria-selected", String(item === option)));
      close();
      button.focus();
    });
  });
  document.addEventListener("click", (event) => {
    if (!box.contains(event.target)) close();
  });
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

$$("[data-select]").forEach(initSelect);
function syncOpts() {
  if (!optsBox) return;
  optsBox.hidden = !PROVIDERS[provider]?.opts;
}
syncOpts();

const drop = $("[data-drop]");
const fileInput = $("[data-file]");
const bar = $("[data-bar]");
const barFill = $("[data-bar-fill]");
const status = $("[data-status]");
const results = $("[data-results]");
const template = $("[data-template]");

const escapeAttr = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

let dialogEl = null;

function dialogNode() {
  if (dialogEl) return dialogEl;
  const el = document.createElement("dialog");
  el.className = "im-dialog";
  el.innerHTML = `
    <form method="dialog" class="im-dialog__inner">
      <header class="im-dialog__head">
        <h3 data-dialog-title></h3>
        <button type="button" class="im-dialog__x" data-dialog-close aria-label="关闭">×</button>
      </header>
      <div class="im-dialog__body" data-dialog-body></div>
      <label class="im-dialog__field" data-dialog-field hidden>
        <span data-dialog-label>备注</span>
        <input type="text" maxlength="200" data-dialog-input autocomplete="off" />
      </label>
      <footer class="im-dialog__foot">
        <button type="button" class="im-btn" data-dialog-cancel>取消</button>
        <button type="button" class="im-btn im-btn--primary" data-dialog-ok>确定</button>
      </footer>
    </form>`;
  document.body.appendChild(el);
  dialogEl = el;
  return el;
}

function openDialog({
  title = "",
  body = "",
  rows = [],
  input = null,
  okText = "确定",
  cancelText = "取消",
  danger = false,
  onlyOk = false,
  onReady = null,
}) {
  const el = dialogNode();
  const form = el.querySelector("form");
  $("[data-dialog-title]", el).textContent = title;

  const bodyBox = $("[data-dialog-body]", el);

  // 内容可以先给个占位（比如「正在查询…」），拿到数据后再用 set 换掉
  const paint = (nextBody = "", nextRows = []) => {
    const list = Array.isArray(nextRows) ? nextRows.filter((row) => row && row.value != null && row.value !== "") : [];
    bodyBox.innerHTML = `${nextBody}${list.length ? `<dl class="im-dialog__rows">${list.map((row) => `<dt>${escapeAttr(row.label)}</dt><dd>${escapeAttr(row.value)}</dd>`).join("")}</dl>` : ""}`;
  };
  paint(body, rows);

  const field = $("[data-dialog-field]", el);
  const inputEl = $("[data-dialog-input]", el);
  if (input) {
    field.hidden = false;
    $("[data-dialog-label]", el).textContent = input.label || "内容";
    inputEl.value = input.value || "";
    inputEl.maxLength = input.maxLength || 200;
  } else {
    field.hidden = true;
    inputEl.value = "";
  }

  const okButton = $("[data-dialog-ok]", el);
  const cancelButton = $("[data-dialog-cancel]", el);
  okButton.textContent = okText;
  okButton.classList.toggle("im-btn--danger", Boolean(danger));
  cancelButton.textContent = cancelText;
  cancelButton.hidden = onlyOk;
  form.classList.toggle("im-dialog__inner--single", onlyOk);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      el.close();
      resolve(value);
    };
    const onOk = () => finish({ ok: true, value: inputEl.value });
    const onCancel = () => finish(null);
    okButton.addEventListener("click", onOk, { once: true });
    cancelButton.addEventListener("click", onCancel, { once: true });
    $("[data-dialog-close]", el).addEventListener("click", onCancel, { once: true });
    el.addEventListener("close", () => { if (!settled) { settled = true; resolve(null); } }, { once: true });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Escape") onCancel();
    }, { once: true });
    el.showModal();
    if (onReady) onReady({ set: paint, el });
    if (input) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 30);
    else okButton.focus();
  });
}

const showDialog = (options) => openDialog({ ...options, onlyOk: true });
const askText = (options) => openDialog(options);

const fmt = (bytes) => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const formats = (item) => {
  const url = item.url;
  const name = item.filename || "image";
  return {
    url,
    md: `![${name}](${url})`,
    mdlink: `[${name}](${url})`,
    html: `<img src="${url}" alt="${name}" />`,
    htmllink: `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" /></a>`,
    bbcode: `[img]${url}[/img]`,
    bblink: `[url=${url}][img]${url}[/img][/url]`,
    ubb: `[img=${url}]${name}[/img]`,
    css: `background-image: url("${url}");`,
    json: JSON.stringify({ url, name, size: item.size || 0 }, null, 0),
  };
};

async function copy(text, button) {
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.top = "-1000px";
    document.body.appendChild(helper);
    helper.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    helper.remove();
  }
  const original = button.textContent;
  button.textContent = ok ? "已复制" : "请手动复制";
  button.classList.add(ok ? "is-done" : "is-fail");
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("is-done", "is-fail");
  }, 1400);
  if (!ok) showDialog({ title: "没能自动复制", body: `<p>浏览器不允许写剪贴板，请手动选中复制：</p><textarea class="im-dialog__code" readonly>${escapeAttr(text)}</textarea>` });
}

function setHint() {
  const info = LIMITS[provider] || {};
  const hint = $("[data-hint]");
  if (hint) hint.textContent = `单张最大 ${fmt(info.max || 0)}，支持 jpg / png / webp / gif${info.query ? "，支持查询图片信息" : ""}`;
}

function renderResult(item) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.querySelector("img").src = item.url;
  node.querySelector("img").alt = item.filename || "上传的图片";
  node.querySelector("[data-meta]").textContent = `${item.providerName || ""} · ${fmt(item.size)}${item.meta?.ratio != null ? ` · 压缩 ${item.meta.ratio}%` : ""}`;
  const input = node.querySelector("[data-url]");
  input.value = item.url;
  input.addEventListener("focus", () => input.select());
  $$("[data-copy-format]", node).forEach((button) => {
    button.addEventListener("click", () => copy(formats(item)[button.dataset.copyFormat] || item.url, button));
  });
  if (item.note) node.querySelector("[data-note]").textContent = item.note;
  const wanted = PROVIDERS[item.provider]?.opts ? item.meta?.options?.format : "";
  const ext = (item.url.match(/\.([a-z0-9]+)(?:\?|$)/i) || [])[1] || "";
  if (wanted && ext && ext.toLowerCase() !== wanted.toLowerCase() && !(wanted === "webp_animated" && ext === "webp")) {
    node.querySelector("[data-note]").textContent = `图床没有按所选格式转换，实际返回 .${ext}`;
  }
  results.prepend(node);
}

function remember(item) {
  if (LOGGED_IN) return;
  const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  list.unshift({ url: item.url, filename: item.filename, size: item.size, providerName: item.providerName, createdAt: new Date().toISOString() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 60)));
  renderHistory();
}

function uploadOne(file) {
  return new Promise((resolve, reject) => {
    const info = LIMITS[provider] || {};
    if (info.max && file.size > info.max) {
      reject(new Error(`${file.name} 超过这套图床的 ${fmt(info.max)} 上限`));
      return;
    }
    const body = new FormData();
    body.append("file", file, file.name);
    body.append("provider", provider);
    if (PROVIDERS[provider]?.opts) {
      for (const [key, value] of Object.entries(opts())) if (value) body.append(key, value);
    }

    const request = new XMLHttpRequest();
    request.open("POST", "/memories/api/images/upload");
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      bar.hidden = false;
      barFill.style.width = `${percent}%`;
      status.textContent = `${file.name} · ${percent}%`;
    });
    request.addEventListener("load", () => {
      let data = null;
      try {
        data = JSON.parse(request.responseText);
      } catch {}
      if (request.status >= 200 && request.status < 300 && data?.ok) resolve(data.item);
      else reject(new Error(data?.error || `上传失败（${request.status}）`));
    });
    request.addEventListener("error", () => reject(new Error("网络中断，再试一次")));
    request.send(body);
  });
}

async function handleFiles(files) {
  const list = Array.from(files).filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|tiff)$/i.test(file.name));
  if (!list.length) {
    status.textContent = "只支持图片文件";
    status.classList.add("is-error");
    return;
  }
  status.classList.remove("is-error");
  for (const file of list) {
    try {
      status.textContent = `${file.name} · 上传中…`;
      const item = await uploadOne(file);
      renderResult(item);
      remember(item);
      total += 1;
      const stat = $("[data-total]");
      if (stat) stat.dataset.total = String(total);
      const hero = $(".im-hero__stat b");
      if (hero) hero.textContent = String(total);
      status.textContent = `已上传 ${file.name}`;
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("is-error");
    } finally {
      bar.hidden = true;
      barFill.style.width = "0%";
    }
  }
  if (LOGGED_IN) loadMine();
}

$$("[data-provider]").forEach((button) => {
  button.addEventListener("click", () => {
    provider = button.dataset.provider;
    $$("[data-provider]").forEach((item) => item.classList.toggle("is-on", item === button));
    setHint();
    syncOpts();
  });
});

$("[data-pick]")?.addEventListener("click", () => fileInput.click());
fileInput?.addEventListener("change", () => {
  if (fileInput.files?.length) handleFiles(fileInput.files);
  fileInput.value = "";
});

if (drop) {
  ["dragenter", "dragover"].forEach((name) =>
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    }),
  );
  ["dragleave", "drop"].forEach((name) =>
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove("is-over");
    }),
  );
  drop.addEventListener("drop", (event) => {
    if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
  });
  drop.addEventListener("click", (event) => {
    if (event.target.closest("[data-pick]") || event.target.closest("input")) return;
    fileInput.click();
  });
}

/* ---------- 历史 / 我的图片 ---------- */

const listBox = $("[data-list]");
const search = $("[data-search]");
const statBox = $("[data-mine-stat]");
let mineCache = [];

function formatList(items) {
  if (!items.length) {
    listBox.innerHTML = '<p class="im-empty">还没有记录。</p>';
    return;
  }
  listBox.innerHTML = "";
  for (const item of items) {
    const node = document.createElement("article");
    node.className = "im-item";
    node.innerHTML = `
      <img class="im-item__thumb" src="${item.url}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      <div class="im-item__main">
        <span class="im-item__url" title="${item.url}">${item.url}</span>
        <span class="im-item__meta">${item.providerName || ""} · ${fmt(item.size)} · ${new Date(item.createdAt).toLocaleString("zh-CN")}</span>
        ${item.note ? `<span class="im-item__note">${item.note}</span>` : ""}
      </div>
      <div class="im-item__acts"></div>`;
    // 点缩略图直接看大图
    node.querySelector(".im-item__thumb")?.addEventListener("click", () => {
      showDialog({
        title: "预览",
        body: `<figure class="im-dialog__figure"><img class="im-dialog__preview" src="${escapeAttr(item.url)}" alt="" referrerpolicy="no-referrer" /><figcaption>${escapeAttr(item.providerName || "")} · ${fmt(item.size)}</figcaption></figure><p class="im-dialog__hint"><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">在新标签打开原图</a></p>`,
      });
    });

    const acts = node.querySelector(".im-item__acts");
    const add = (label, handler) => {
      const button = document.createElement("button");
      button.className = "im-copy";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", handler);
      acts.appendChild(button);
      return button;
    };
    add("复制", (event) => copy(item.url, event.currentTarget));
    if (LOGGED_IN) {
      if (item.provider === "scdn") {
        add("信息", async () => {
        // 先把弹窗弹出来（带加载动画），再等接口回数据填进去
        let ready;
        const opened = new Promise((resolve) => {
          ready = resolve;
        });
        const closed = showDialog({
          title: "图片信息",
          body: '<p class="im-wait"><span class="im-wait__spin" aria-hidden="true"></span>正在查询这张图的信息…</p>',
          onReady: (handle) => ready(handle),
        });
        const handle = await opened;
        try {
          const response = await fetch(`/memories/api/images/${item.id}/meta`);
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "没有信息");
          const info = data.info || {};
          handle.set("", [
            { label: "文件名", value: info.filename },
            { label: "大小", value: info.size_display },
            { label: "上传时间", value: info.upload_date },
            { label: "存储", value: info.storage_location || info.storage_backend },
            { label: "标签", value: info.tags },
            { label: "描述", value: info.content_description },
          ]);
        } catch (error) {
          handle.set(`<p class="im-wait im-wait--error">查不到信息：${escapeAttr(error.message)}</p>`);
        }
        await closed;
      });
      }
      add("备注", async () => {
        const result = await askText({
          title: "备注",
          input: { label: "备注（最多 200 字）", value: item.note || "", maxLength: 200 },
          okText: "保存",
        });
        if (!result) return;
        await fetch(`/memories/api/images/${item.id}/note`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: result.value }),
        });
        item.note = result.value;
        renderHistory();
      });
      add("删除", async () => {
        const result = await openDialog({
          title: "删除这条记录",
          body: "<p>记录会从「我的图片」里移除，图片本身仍留在图床服务上，已经用出去的链接不会失效。</p>",
          okText: "删除",
          danger: true,
        });
        if (!result) return;
        await fetch(`/memories/api/images/${item.id}`, { method: "DELETE" });
        mineCache = mineCache.filter((entry) => entry.id !== item.id);
        renderHistory();
      });
    }
    listBox.appendChild(node);
  }
}

function renderHistory() {
  const query = (search?.value || "").trim().toLowerCase();
  if (LOGGED_IN) {
    const items = mineCache.filter((item) => !query || item.url.toLowerCase().includes(query) || String(item.filename || "").toLowerCase().includes(query));
    formatList(items);
    const bytes = mineCache.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    if (statBox) statBox.textContent = `${mineCache.length} 张 · ${fmt(bytes)}`;
    return;
  }
  const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").filter(
    (item) => !query || item.url.toLowerCase().includes(query) || String(item.filename || "").toLowerCase().includes(query),
  );
  formatList(items);
  if (statBox) statBox.textContent = items.length ? `${items.length} 条本机记录` : "";
}

async function loadMine() {
  try {
    const response = await fetch("/memories/api/images");
    const data = await response.json();
    if (!data.ok) return;
    mineCache = data.items || [];
    renderHistory();
  } catch {}
}

search?.addEventListener("input", renderHistory);

setHint();
renderHistory();
if (LOGGED_IN) loadMine();
