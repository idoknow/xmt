const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const LIMITS = JSON.parse(document.querySelector("[data-limits]")?.dataset.limits || "{}");
const HISTORY_KEY = "xmt-image-history";
const LOGGED_IN = Boolean(document.querySelector("[data-user-id]")?.dataset.userId);

let provider = "scdn";
let total = Number($("[data-total]")?.dataset.total || 0);

const drop = $("[data-drop]");
const fileInput = $("[data-file]");
const bar = $("[data-bar]");
const barFill = $("[data-bar-fill]");
const status = $("[data-status]");
const results = $("[data-results]");
const template = $("[data-template]");

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
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  const original = button.textContent;
  button.textContent = "已复制";
  button.classList.add("is-done");
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove("is-done");
  }, 1200);
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
  $$("[data-copy-format]").forEach((button) => {
    button.addEventListener("click", () => copy(formats(item)[button.dataset.copyFormat] || item.url, button));
  });
  if (item.note) node.querySelector("[data-note]").textContent = item.note;
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
          try {
            const response = await fetch(`/memories/api/images/${item.id}/meta`);
            const data = await response.json();
            if (!data.ok) throw new Error(data.error || "没有信息");
            const info = data.info || {};
            alert(`文件名：${info.filename || "-"}\n大小：${info.size_display || "-"}\n上传：${info.upload_date || "-"}\n存储：${info.storage_location || info.storage_backend || "-"}\n标签：${info.tags || "-"}\n描述：${info.content_description || "-"}`);
          } catch (error) {
            alert(error.message);
          }
        });
      }
      add("备注", async () => {
        const note = prompt("备注（最多 200 字）", item.note || "");
        if (note == null) return;
        await fetch(`/memories/api/images/${item.id}/note`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note }),
        });
        item.note = note;
        renderHistory();
      });
      add("删除", async () => {
        if (!confirm("删除这条记录？图片本身仍留在图床服务上。")) return;
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
