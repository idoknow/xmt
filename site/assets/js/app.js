// Memories 前端：视图切换、上传、备注、多选分享、后台表单。
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const api = async (url, body, method = "POST") => {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
};

const fmt = (bytes) => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/* ---------- 配色 ----------
   媒体库页头不再提供切换入口：这里只负责把站点里选过的配色（localStorage["xmt-theme"]）
   落到 <html data-theme> 上，并在「跟随系统」时跟着系统走。 */

const THEME_KEY = "xmt-theme";
const prefersDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

const readTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch (error) {
    return "system";
  }
};

const applyTheme = (theme) => {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#14131b" : "#f6f3ec");
};

applyTheme(readTheme());

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (readTheme() === "system") applyTheme("system");
});

/* ---------- 视图切换 ---------- */

const setView = (view) => {
  document.documentElement.dataset.view = view;
  localStorage.setItem("mem-view", view);
  $$("[data-view]").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.view === view));
};

setView(localStorage.getItem("mem-view") || "grid");
$$("[data-view]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));

/* 排序菜单：点外面收起来，Esc 也收 */
document.addEventListener("click", (event) => {
  for (const box of $$("[data-sort][open]")) {
    if (!box.contains(event.target)) box.removeAttribute("open");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("[data-sort][open]")?.removeAttribute("open");
});

/* ---------- 多选与分享 ---------- */

const picks = new Set();
const bar = document.createElement("div");
bar.className = "m-pickbar";
bar.hidden = true;
bar.innerHTML = `<span data-pick-count>已选 0 项</span>
  <button class="m-btn m-btn--tiny" data-pick-share>生成分享链接</button>
  <button class="m-btn m-btn--tiny" data-pick-clear>取消</button>`;
document.body.append(bar);

const syncBar = () => {
  bar.hidden = picks.size === 0;
  $("[data-pick-count]", bar).textContent = `已选 ${picks.size} 项`;
  $$("[data-pick]").forEach((btn) => btn.classList.toggle("is-on", picks.has(Number(btn.dataset.pick))));
};

document.addEventListener("click", async (event) => {
  const pick = event.target.closest("[data-pick]");
  if (pick) {
    event.preventDefault();
    event.stopPropagation();
    const id = Number(pick.dataset.pick);
    picks.has(id) ? picks.delete(id) : picks.add(id);
    syncBar();
    return;
  }
  if (event.target.closest("[data-pick-clear]")) {
    picks.clear();
    syncBar();
    return;
  }
  if (event.target.closest("[data-pick-share]")) {
    try {
      const { url } = await api("/memories/api/share", { ids: [...picks], days: 7 });
      await navigator.clipboard?.writeText(url).catch(() => {});
      alert(`分享链接已生成并复制：\n${url}`);
      picks.clear();
      syncBar();
    } catch (error) {
      alert(error.message);
    }
  }
});

/* ---------- 上传 ---------- */

const dialog = $("[data-upload]");
const queue = $("[data-queue]");
const submit = $("[data-upload-submit]");
const progress = $("[data-upload-progress]");
let chosen = [];

$$("[data-upload-open]").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (!dialog) return;
    dialog.showModal();
  }),
);
$("[data-upload-cancel]")?.addEventListener("click", () => dialog?.close());

const drop = $("[data-drop]");
if (drop) {
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    chosen = [...event.dataTransfer.files];
    renderQueue();
  });
}
$("[data-file]")?.addEventListener("change", (event) => {
  chosen = [...event.target.files];
  renderQueue();
});

function renderQueue() {
  if (!queue) return;
  queue.innerHTML = chosen
    .map(
      (file) =>
        `<li><span>${file.name}</span><small>${(file.size / 1024 / 1024).toFixed(1)} MB</small></li>`,
    )
    .join("");
  if (submit) submit.disabled = chosen.length === 0;
}

$("[data-upload-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!chosen.length) return;
  const form = new FormData();
  for (const file of chosen) form.append("files", file);
  const drive = $("[data-folder-drive]")?.value;
  if (drive) form.append("drive", drive);

  const upBox = $("[data-upload-progress]");
  const upBar = $("[data-upload-bar]");
  const upPct = $("[data-upload-pct]");
  const upNote = $("[data-upload-note]");
  const total = chosen.reduce((sum, file) => sum + file.size, 0);
  const started = performance.now();

  const setProgress = (loaded, done) => {
    if (!upBox) return;
    upBox.hidden = false;
    const pct = done ? 100 : Math.min(99, Math.round((loaded / Math.max(1, total)) * 100));
    if (upBar) upBar.style.width = `${pct}%`;
    if (upPct) upPct.textContent = done ? "完成" : `${pct}%`;
    if (upNote) {
      const seconds = (performance.now() - started) / 1000;
      const speed = seconds > 0.6 ? loaded / seconds : 0;
      upNote.textContent = done
        ? `${fmt(total)} · ${chosen.length} 个文件`
        : speed
          ? `${fmt(loaded)} / ${fmt(total)} · ${fmt(speed)}/s`
          : `${fmt(total)} 待上传`;
    }
  };

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/memories/api/upload");
  xhr.upload.addEventListener("progress", (progressEvent) => {
    if (!progressEvent.lengthComputable) return;
    setProgress(progressEvent.loaded, false);
  });
  xhr.addEventListener("load", () => {
    setProgress(total, true);
    let data = {};
    try {
      data = JSON.parse(xhr.responseText);
    } catch {}
    if (xhr.status >= 400 || data.ok === false) {
      alert(data.error || `上传失败（${xhr.status}）`);
      return;
    }
    const rejected = data.rejected?.length ? `\n跳过：${data.rejected.map((r) => `${r.name}（${r.reason}）`).join("，")}` : "";
    alert(`上传完成：${data.saved.length} 个${rejected}`);
    location.reload();
  });
  xhr.addEventListener("error", () => {
    if (upPct) upPct.textContent = "中断";
    if (upNote) upNote.textContent = "网络断了，再试一次";
    if (upBar) upBar.classList.add("is-error");
    alert("上传中断了，再试一次");
  });
  xhr.addEventListener("loadstart", () => {
    if (upBar) {
      upBar.classList.remove("is-error");
      upBar.style.width = "0%";
    }
    setProgress(0, false);
  });
  xhr.send(form);
});

/* ---------- 详情 ---------- */

$("[data-meta-form]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api(`/memories/api/media/${form.dataset.id}/meta`, {
      note: form.note.value.trim(),
      tags: form.tags.value.trim(),
    });
    form.querySelector("button").textContent = "已保存";
    setTimeout(() => (form.querySelector("button").textContent = "保存"), 1600);
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const del = event.target.closest("[data-delete]");
  if (del) {
    if (!confirm("删除之后不能恢复，确定吗？")) return;
    try {
      await api(`/memories/api/media/${del.dataset.delete}/delete`, {});
      location.assign("/memories");
    } catch (error) {
      alert(error.message);
    }
  }
  const copy = event.target.closest("[data-copy-link]");
  if (copy) {
    const url = `${location.origin}/memories/a/${copy.dataset.copyLink}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    copy.textContent = "已复制";
    setTimeout(() => (copy.textContent = "复制链接"), 1600);
  }
});

/* ---------- 后台 ---------- */

$$("[data-tab]").forEach((tab) =>
  tab.addEventListener("click", () => {
    $$("[data-tab]").forEach((item) => item.classList.toggle("is-on", item === tab));
    $$("[data-panel]").forEach((panel) => panel.classList.toggle("is-on", panel.dataset.panel === tab.dataset.tab));
  }),
);

const fieldsHost = $("[data-drive-fields]");
let fieldSpecs = {};
const driveForm = $("[data-add-drive]");
let drivesIndex = {};
try {
  const raw = document.getElementById("drives-data");
  if (raw) for (const drive of JSON.parse(raw.textContent || "[]")) drivesIndex[String(drive.id)] = drive;
} catch (error) {
  drivesIndex = {};
}

const setFieldValues = (config = {}) => {
  for (const input of $$('[data-drive-fields] input, [data-drive-fields] textarea')) {
    const key = input.name.replace("cfg.", "");
    input.value = config[key] == null ? "" : String(config[key]);
  }
};

const renderDriveFields = (driverKey, values = {}) => {
  if (!fieldsHost) return;
  const spec = fieldSpecs[driverKey];
  if (!spec) {
    fieldsHost.innerHTML = "";
    return;
  }
  fieldsHost.innerHTML = `<fieldset class="m-fieldset"><legend>${spec.label} 连接参数</legend>
    <p class="m-hint">${spec.hint || ""}</p>
    <div class="m-form m-form--grid">
      ${spec.fields
        .map((field) => {
          if (field.type === "textarea") {
            return `<label class="m-form__wide"><span>${field.label}</span><textarea name="cfg.${field.key}" rows="4" placeholder="${
              field.placeholder || ""
            }" spellcheck="false"></textarea></label>`;
          }
          return `<label><span>${field.label}</span><input name="cfg.${field.key}" type="${
            field.type === "password" ? "password" : "text"
          }" placeholder="${field.placeholder || ""}" autocomplete="off" /></label>`;
        })
        .join("")}
    </div></fieldset>`;
  setFieldValues(values);
};

const setEditing = (drive) => {
  if (!driveForm) return;
  const field = (name) => driveForm.querySelector(`[name="${name}"]`);
  const submit = $("[data-drive-submit]", driveForm);
  const cancel = $("[data-drive-cancel]", driveForm);
  if (!drive) {
    driveForm.dataset.driveId = "";
    driveForm.classList.remove("is-editing");
    driveForm.reset();
    if (field("root")) field("root").value = "/";
    if (field("visibility")) field("visibility").value = "members";
    if (field("enabled")) field("enabled").checked = true;
    if (submit) submit.textContent = "添加存储";
    if (cancel) cancel.hidden = true;
    renderDriveFields(field("driver")?.value || "local");
    syncHiddenInput();
    return;
  }
  driveForm.dataset.driveId = String(drive.id);
  driveForm.classList.add("is-editing");
  if (field("name")) field("name").value = drive.name || "";
  if (field("driver")) field("driver").value = drive.driver;
  if (field("root")) field("root").value = drive.root || "/";
  if (field("visibility")) field("visibility").value = drive.visibility === "public" ? "public" : "members";
  if (field("hidden")) field("hidden").value = (drive.hidden || []).join("\n");
  if (field("enabled")) field("enabled").checked = Boolean(drive.enabled);
  if (submit) submit.textContent = "保存修改";
  if (cancel) cancel.hidden = false;
  renderDriveFields(drive.driver, drive.config || {});
  syncHiddenInput();
  driveForm.scrollIntoView({ behavior: "smooth", block: "center" });
};

/* ---------- 存储：目录选择（隐藏目录 / 浏览） ---------- */

const esc = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const driveDialog = $("[data-drive-dialog]");
const pickList = $("[data-pick-list]");
const pickPathEl = $("[data-pick-path]");
const pickNote = $("[data-pick-note]");
const hideHereBtn = $("[data-pick-hide-here]");
const hiddenInput = $("[data-hidden-input]");
const hiddenChips = $("[data-hidden-chips]");
const hiddenEmpty = $("[data-hidden-empty]");
const pickState = { mode: "hide", driveId: "", path: "/", hidden: new Set() };

const renderHiddenChips = () => {
  const paths = [...pickState.hidden];
  if (hiddenInput) hiddenInput.value = paths.join("\n");
  if (hiddenEmpty) hiddenEmpty.hidden = paths.length > 0;
  if (hiddenChips) {
    hiddenChips.innerHTML = paths
      .map(
        (path) =>
          `<li><code>${esc(path)}</code><button class="m-pick__x" type="button" data-hidden-remove="${esc(
            path,
          )}" aria-label="移除 ${esc(path)}">×</button></li>`,
      )
      .join("");
  }
};

function syncHiddenInput() {
  pickState.hidden = new Set(
    (hiddenInput?.value || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  renderHiddenChips();
}

const toggleHidden = (path) => {
  if (pickState.hidden.has(path)) pickState.hidden.delete(path);
  else pickState.hidden.add(path);
  renderHiddenChips();
};

const loadDir = async (path) => {
  if (!pickState.driveId) return;
  if (pickNote) pickNote.textContent = "读取中…";
  try {
    const data = await api(
      `/memories/api/drives/${pickState.driveId}/browse?path=${encodeURIComponent(path)}`,
      null,
      "GET",
    );
    pickState.path = data.path || "/";
    if (pickPathEl) pickPathEl.textContent = pickState.path;
    const entries = data.entries || [];
    if (pickList) {
      pickList.innerHTML = entries.length
        ? entries
            .map((entry) => {
              const path = entry.path;
              const mark =
                pickState.mode === "hide"
                  ? `<button class="m-pick__toggle${entry.hidden ? " is-on" : ""}" type="button" data-pick-toggle="${esc(
                      path,
                    )}">${entry.hidden ? "已隐藏" : "隐藏"}</button>`
                  : entry.hidden
                    ? `<span class="m-pick__tag">已隐藏</span>`
                    : "";
              const main = entry.isDir
                ? `<button class="m-pick__go" type="button" data-pick-enter="${esc(path)}"><span class="m-pick__name">${esc(
                    entry.name,
                  )}</span><span class="m-pick__kind">目录</span></button>`
                : `<div class="m-pick__go"><span class="m-pick__name">${esc(entry.name)}</span><span class="m-pick__kind">${fmt(
                    entry.size,
                  )}</span></div>`;
              return `<div class="m-pick__item">${main}${mark}</div>`;
            })
            .join("")
        : `<p class="m-empty">这个目录里没有东西。</p>`;
    }
    if (pickNote) pickNote.textContent = `${entries.length} 项 · ${data.ms ?? 0}ms`;
  } catch (error) {
    if (pickNote) pickNote.textContent = error.message;
    if (pickList) pickList.innerHTML = "";
  }
};

const openDriveDialog = (mode, driveId, path = "/") => {
  if (!driveId) {
    alert("先保存这份存储，再选择目录。");
    return;
  }
  pickState.mode = mode;
  pickState.driveId = driveId;
  const title = $("[data-dialog-title]");
  if (title) title.textContent = mode === "browse" ? "浏览存储内容" : "选择要隐藏的目录";
  if (hideHereBtn) hideHereBtn.hidden = mode !== "hide";
  syncHiddenInput();
  if (driveDialog?.showModal) driveDialog.showModal();
  else driveDialog?.setAttribute("open", "");
  loadDir(path);
};

document.addEventListener("click", (event) => {
  const open = event.target.closest("[data-hidden-open]");
  if (open) {
    openDriveDialog("hide", driveForm?.dataset.driveId || "");
    return;
  }
  const browse = event.target.closest("[data-drive-browse]");
  if (browse) {
    openDriveDialog("browse", browse.dataset.driveBrowse);
    return;
  }
  const remove = event.target.closest("[data-hidden-remove]");
  if (remove) {
    toggleHidden(remove.dataset.hiddenRemove);
    return;
  }
  const enter = event.target.closest("[data-pick-enter]");
  if (enter) {
    loadDir(enter.dataset.pickEnter);
    return;
  }
  const toggle = event.target.closest("[data-pick-toggle]");
  if (toggle) {
    toggleHidden(toggle.dataset.pickToggle);
    loadDir(pickState.path);
    return;
  }
  if (event.target.closest("[data-pick-hide-here]")) {
    toggleHidden(pickState.path);
    loadDir(pickState.path);
    return;
  }
  if (event.target.closest("[data-pick-up]")) {
    const parts = pickState.path.split("/").filter(Boolean);
    parts.pop();
    loadDir(`/${parts.join("/")}`);
    return;
  }
  if (event.target.closest("[data-dialog-close]")) {
    driveDialog?.close?.();
  }
});

if (fieldsHost) {
  fetch("/memories/api/state")
    .then((res) => res.json())
    .then((data) => {
      fieldSpecs = data.fields || {};
      const select = $('[data-add-drive] [name="driver"]');
      renderDriveFields(select?.value || "local");
      select?.addEventListener("change", () => renderDriveFields(select.value));
    })
    .catch(() => {});
}

$("[data-drive-cancel]")?.addEventListener("click", () => setEditing(null));

driveForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const field = (name) => form.querySelector(`[name="${name}"]`);
  const config = {};
  for (const input of $$('[data-drive-fields] input, [data-drive-fields] textarea')) {
    const key = input.name.replace("cfg.", "");
    if (input.value.trim()) config[key] = input.value.trim();
  }
  const hidden = (field("hidden")?.value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const body = {
    name: field("name")?.value.trim() || "",
    driver: field("driver")?.value || "local",
    root: field("root")?.value.trim() || "/",
    visibility: field("visibility")?.value || "members",
    enabled: Boolean(field("enabled")?.checked),
    hidden,
  };
  if (Object.keys(config).length) body.config = config;
  const id = form.dataset.driveId;
  try {
    await api(id ? `/memories/api/drives/${id}` : "/memories/api/drives", body);
    location.reload();
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-drive-edit]");
  if (edit) {
    const drive = drivesIndex[edit.dataset.driveEdit];
    if (drive) setEditing(drive);
    return;
  }
  const test = event.target.closest("[data-drive-test]");
  if (test) {
    test.textContent = "测试中…";
    try {
      const data = await api(`/memories/api/drives/${test.dataset.driveTest}/test`, {});
      test.textContent = `通 ${data.ms}ms`;
      setTimeout(() => (test.textContent = "测试"), 2400);
    } catch (error) {
      test.textContent = "失败";
      alert(error.message);
      setTimeout(() => (test.textContent = "测试"), 2400);
    }
    return;
  }
  const del = event.target.closest("[data-drive-del]");
  if (del) {
    if (!confirm("删除这个存储？里面的记录也会一起消失。")) return;
    try {
      await api(`/memories/api/drives/${del.dataset.driveDel}`, {}, "DELETE");
      location.reload();
    } catch (error) {
      alert(error.message);
    }
    return;
  }
  const toggle = event.target.closest("[data-toggle-user]");
  if (toggle) {
    try {
      await api(`/memories/api/users/${toggle.dataset.toggleUser}/status`, {});
      location.reload();
    } catch (error) {
      alert(error.message);
    }
  }
});

$("[data-add-user]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api("/memories/api/users", { qq: form.qq.value.trim(), note: form.note ? form.note.value.trim() : "" });
    location.reload();
  } catch (error) {
    alert(error.message);
  }
});

$$("[data-role]").forEach((select) =>
  select.addEventListener("change", async () => {
    try {
      await api(`/memories/api/users/${select.dataset.role}/role`, { role: select.value });
    } catch (error) {
      alert(error.message);
      location.reload();
    }
  }),
);

$("[data-settings]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {};
  for (const input of $$("input", form)) body[input.name] = input.value.trim();
  try {
    await api("/memories/api/settings", body);
    form.querySelector("button").textContent = "已保存";
    setTimeout(() => (form.querySelector("button").textContent = "保存设置"), 1600);
  } catch (error) {
    alert(error.message);
  }
});
