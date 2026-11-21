// 管理台「文件」页：选中、自定义弹窗（新建/改名/移动/复制/删除/预览）、上传。
const params = new URLSearchParams(location.search);
const DRIVE = params.get("drive") || "";
const PATH = params.get("path") || "/";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const esc = (value) =>
  String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const fmt = (bytes) => {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

async function api(path, body = null, method = "POST") {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

const rawUrl = (path, download = false) =>
  `/memories/admin/files/raw?drive=${encodeURIComponent(DRIVE)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

const join = (dir, name) => (dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`);
const parentOf = (target) => {
  const index = String(target).replace(/\/+$/, "").lastIndexOf("/");
  return index <= 0 ? "/" : String(target).slice(0, index);
};

/* ---------- 弹窗 ---------- */

const dialog = $("[data-dialog]");
const dialogTitle = $("[data-dialog-title]", dialog || document);
const dialogBody = $("[data-dialog-body]", dialog || document);
const dialogForm = $("[data-dialog-form]", dialog || document);
const dialogOk = $("[data-dialog-ok]", dialog || document);

let onSubmit = null;

function openDialog({ title, body, ok = "确定", danger = false, submit = null }) {
  if (!dialog) return;
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialogOk.textContent = ok;
  dialogOk.hidden = !submit;
  dialogOk.classList.toggle("a-btn--danger", Boolean(danger));
  dialogOk.classList.toggle("a-btn--primary", !danger);
  onSubmit = submit;
  if (!dialog.open) dialog.showModal();
  const focus = dialogBody.querySelector("input, textarea, select, button");
  if (focus) focus.focus();
  if (focus && focus.select) focus.select();
}

function closeDialog() {
  onSubmit = null;
  if (dialog?.open) dialog.close();
}

$$("[data-dialog-close]", dialog || document).forEach((button) => button.addEventListener("click", closeDialog));
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});
dialog?.addEventListener("close", () => {
  onSubmit = null;
});

// 存储页的「确定」是普通按钮（弹窗里没有提交按钮的默认行为），手动触发表单提交
if (dialogOk && dialogOk.type === "button") {
  dialogOk.addEventListener("click", () => dialogForm?.requestSubmit());
}
$$("[data-dialog-cancel]", dialog || document).forEach((button) => button.addEventListener("click", closeDialog));

dialogForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!onSubmit) return closeDialog();
  const submitButton = dialogOk;
  const before = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "处理中…";
  try {
    await onSubmit();
    closeDialog();
  } catch (error) {
    const note = $("[data-dialog-error]", dialogBody);
    if (note) {
      note.textContent = error.message;
      note.hidden = false;
    } else {
      alert(error.message);
    }
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = before;
  }
});

/* ---------- 选中 ---------- */

const pickAll = $("[data-pick-all]");
const selbar = $("[data-selbar]");
const selCount = $("[data-sel-count]");
let lastIndex = -1;

const boxes = () => $$("[data-pick]");
const picked = () => boxes().filter((box) => box.checked).map((box) => box.value);

function syncSelection() {
  const all = boxes();
  const chosen = all.filter((box) => box.checked);
  if (pickAll) {
    pickAll.checked = all.length > 0 && chosen.length === all.length;
    pickAll.indeterminate = chosen.length > 0 && chosen.length < all.length;
  }
  all.forEach((box) => {
    const row = box.closest("tr");
    if (row) row.classList.toggle("is-picked", box.checked);
  });
  if (selbar) selbar.hidden = chosen.length === 0;
  if (selCount) selCount.textContent = `已选 ${chosen.length} 项`;
}

pickAll?.addEventListener("change", () => {
  boxes().forEach((box) => {
    box.checked = pickAll.checked;
  });
  lastIndex = -1;
  syncSelection();
});

boxes().forEach((box, index) =>
  box.addEventListener("click", (event) => {
    if (event.shiftKey && lastIndex >= 0) {
      const all = boxes();
      const [from, to] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
      const value = all[index].checked;
      for (let i = from; i <= to; i += 1) all[i].checked = value;
    }
    lastIndex = index;
    syncSelection();
  }),
);

$("[data-clear]")?.addEventListener("click", () => {
  boxes().forEach((box) => {
    box.checked = false;
  });
  lastIndex = -1;
  syncSelection();
});

// 点行选中（不抢链接、按钮、输入框的点击）
document.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-path]");
  if (!row || event.target.closest("a, button, input, label")) return;
  const box = $("[data-pick]", row);
  if (!box) return;
  box.checked = !box.checked;
  box.dispatchEvent(new MouseEvent("click", { bubbles: false }));
});

/* ---------- 上传 ---------- */

const uploadInput = $("[data-upload]");
const uploadBox = $("[data-upload-progress]");
const uploadBar = $("[data-upload-bar]");
const uploadNote = $("[data-upload-note]");

const SMALL = 4 * 1024 * 1024;
const PARALLEL = 4;

function setProgress(percent, note) {
  uploadBox.hidden = false;
  uploadBar.classList.remove("is-error");
  uploadBar.style.width = `${Math.min(100, Math.max(0, percent)).toFixed(1)}%`;
  uploadNote.textContent = note;
}

async function simpleUpload(file) {
  const form = new FormData();
  form.append("drive", DRIVE);
  form.append("path", PATH);
  form.append("files", file);
  const data = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/memories/admin/files/upload");
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = (event.loaded / event.total) * 100;
      setProgress(percent, `${file.name} · ${percent.toFixed(0)}% · ${fmt(event.loaded)} / ${fmt(event.total)}`);
    });
    xhr.addEventListener("load", () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.ok !== false) resolve(body);
      else reject(new Error(body.error || `上传失败（${xhr.status}）`));
    });
    xhr.addEventListener("error", () => reject(new Error("上传中断，检查网络后重试")));
    xhr.send(form);
  });
  return data.saved?.length || 1;
}

// 大文件：分块 + 并发 + 断点续传（localStorage 记住 uploadId 与已完成块）
async function chunkedUpload(file) {
  const key = `mul:${DRIVE}:${PATH}:${file.name}:${file.size}:${file.lastModified}`;
  const init = await api("/memories/api/uploads", {
    drive: Number(DRIVE),
    folder: PATH,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream",
  });
  const { id, chunkSize, chunks } = init;
  const done = new Set(init.uploaded || []);
  const bytesDone = () => {
    let total = 0;
    for (const index of done) total += Math.min(chunkSize, file.size - index * chunkSize);
    return total;
  };
  const save = () => localStorage.setItem(key, JSON.stringify({ id, at: Date.now(), uploaded: [...done] }));
  save();

  const queue = [];
  for (let index = 0; index < chunks; index += 1) if (!done.has(index)) queue.push(index);
  let active = 0;
  let failed = null;

  const paint = () => {
    const sent = bytesDone();
    const percent = (sent / file.size) * 100;
    setProgress(
      percent,
      `${file.name} · ${percent.toFixed(1)}% · ${fmt(sent)} / ${fmt(file.size)} · ${done.size}/${chunks} 块 · 并行 ${active}`,
    );
  };
  paint();

  const worker = async () => {
    while (queue.length && !failed) {
      const index = queue.shift();
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      active += 1;
      paint();
      try {
        const res = await fetch(`/memories/api/uploads/${id}/chunks/${index}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: file.slice(start, end),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) throw new Error(body.error || `第 ${index + 1} 块失败（${res.status}）`);
        done.add(index);
        save();
        paint();
      } catch (error) {
        failed = error;
      } finally {
        active -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks) }, worker));
  if (failed) {
    setProgress((bytesDone() / file.size) * 100, `${file.name} · 传了 ${fmt(bytesDone())}，再点一次上传就能接着传`);
    uploadBar.classList.add("is-error");
    throw failed;
  }

  const result = await api(`/memories/api/uploads/${id}/complete`, {});
  localStorage.removeItem(key);
  return result.media?.length || 1;
}

async function uploadFiles(files) {
  if (!files.length || !DRIVE) return;
  let saved = 0;
  try {
    for (const [index, file] of files.entries()) {
      const label = `（${index + 1}/${files.length}）`;
      if (files.length > 1) setProgress(0, `${label} 准备 ${file.name}`);
      saved += file.size > SMALL ? await chunkedUpload(file) : await simpleUpload(file);
    }
    setProgress(100, `已上传 ${saved} 个文件`);
    location.reload();
  } catch (error) {
    if (!uploadNote.textContent.includes("接着传")) setProgress(0, error.message);
    uploadBar.classList.add("is-error");
    throw error;
  }
}

uploadInput?.addEventListener("change", () => {
  const files = Array.from(uploadInput.files || []);
  uploadInput.value = "";
  uploadFiles(files).catch(() => {});
});

/* ---------- 目录选择（移动 / 复制） ---------- */

async function pickFolder(startPath, initial = "/") {
  let current = initial || "/";
  let chosen = initial || "/";
  const body = `
    <div class="a-pick__bar">
      <button class="a-btn a-btn--tiny" type="button" data-up>← 上一级</button>
      <code data-cur>${esc(current)}</code>
    </div>
    <div class="a-pick__list" data-list><p class="a-hint">读取中…</p></div>
    <p class="a-hint">选好目录后点「确定」；也可以直接在里面新建文件夹。</p>
    <p class="a-note a-note--bad" data-dialog-error hidden></p>`;

  const promise = new Promise((resolve) => {
    const render = async (dir) => {
      const list = $("[data-list]", dialogBody);
      const cur = $("[data-cur]", dialogBody);
      if (cur) cur.textContent = dir;
      current = dir;
      chosen = dir;
      try {
        const data = await api(`/memories/api/drives/${encodeURIComponent(DRIVE)}/browse?path=${encodeURIComponent(dir)}`, null, "GET");
        const dirs = (data.entries || []).filter((entry) => entry.isDir);
        list.innerHTML = dirs.length
          ? dirs
              .map(
                (entry) =>
                  `<button class="a-pick__item" type="button" data-enter="${esc(entry.path)}"><span class="a-ico a-ico--dir"></span>${esc(
                    entry.name,
                  )}</button>`,
              )
              .join("")
          : `<p class="a-hint">这一层没有子目录。</p>`;
      } catch (error) {
        list.innerHTML = `<p class="a-note a-note--bad">${esc(error.message)}</p>`;
      }
      const up = $("[data-up]", dialogBody);
      if (up) up.disabled = current === "/";
    };

    const off = () => {
      dialogBody.removeEventListener("click", onClick);
      window.__pickResolve = null;
    };

    const onClick = async (event) => {
      if (event.target.closest("[data-dialog-close]")) {
        off();
        resolve(null);
        return;
      }
      const enter = event.target.closest("[data-enter]");
      if (enter) {
        await render(enter.dataset.enter);
        return;
      }
      const up = event.target.closest("[data-up]");
      if (up) {
        if (current === "/") return;
        await render(parentOf(current) || "/");
      }
    };

    dialogBody.addEventListener("click", onClick);
    window.__pickResolve = () => {
      off();
      resolve(chosen);
    };
    render(startPath || "/");
  });

  openDialog({
    title: "选择目录",
    body,
    ok: "选好了",
    submit: async () => {
      const value = window.__pickResolve ? window.__pickResolve() : chosen;
      return value;
    },
  });

  const result = await promise;
  return result;
}

/* ---------- 操作 ---------- */

async function act(body) {
  return api("/memories/admin/files/action", { drive: DRIVE, ...body });
}

function askName({ title, label, value = "", ok = "确定" }) {
  return new Promise((resolve) => {
    let settled = false;
    openDialog({
      title,
      body: `<label class="a-field"><span>${esc(label)}</span><input name="name" value="${esc(value)}" required autocomplete="off" /></label>
        <p class="a-note a-note--bad" data-dialog-error hidden></p>`,
      ok,
      submit: async () => {
        const input = $("[name='name']", dialogBody);
        const name = (input?.value || "").trim();
        if (!name) throw new Error("名字不能为空");
        settled = true;
        resolve(name);
      },
    });
    dialog.addEventListener(
      "close",
      () => {
        if (!settled) resolve(null);
      },
      { once: true },
    );
  });
}

async function doMkdir() {
  const name = await askName({ title: "新建文件夹", label: "文件夹名字", value: "新建文件夹", ok: "创建" });
  if (!name) return;
  await act({ action: "mkdir", path: PATH, name });
  location.reload();
}

async function doRename(path, currentName) {
  const name = await askName({ title: "改名", label: "新的名字", value: currentName, ok: "保存" });
  if (!name || name === currentName) return;
  await act({ action: "rename", target: path, name });
  location.reload();
}

async function doBatch(mode) {
  const paths = picked();
  if (!paths.length) return;

  if (mode === "remove") {
    const dirsOnly = paths.every((path) => $(`[data-pick][value="${CSS.escape(path)}"]`)?.dataset.isDir === "1");
    const ok = await new Promise((resolve) => {
      openDialog({
        title: "删除",
        body: `<p>确定删除选中的 <strong>${paths.length}</strong> 项${dirsOnly ? "目录" : "内容"}？</p>
          <p class="a-hint">删了就找不回来；移动云盘上的会进回收站。</p>
          <p class="a-note a-note--bad" data-dialog-error hidden></p>`,
        ok: "删除",
        danger: true,
        submit: async () => resolve(true),
      });
      dialog.addEventListener("close", () => resolve(false), { once: true });
    });
    if (!ok) return;
    await act({ action: "remove", targets: paths });
    location.reload();
    return;
  }

  if (mode === "download") {
    const files = paths.filter((path) => !$(`[data-pick][value="${CSS.escape(path)}"]`)?.dataset.isDir);
    files.forEach((path, index) => {
      setTimeout(() => {
        const link = document.createElement("a");
        link.href = rawUrl(path, true);
        link.download = path.split("/").pop() || "download";
        document.body.append(link);
        link.click();
        link.remove();
      }, index * 500);
    });
    if (!files.length) alert("选中的都是目录，没有可下载的文件。");
    return;
  }

  const dest = await pickFolder(PATH, PATH);
  if (!dest) return;
  await act({ action: mode, targets: paths, dest });
  location.reload();
}

/* 预览 */

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "svg", "bmp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);

function openPreview(path, name, size) {
  const ext = String(name).split(".").pop()?.toLowerCase() || "";
  const url = rawUrl(path);
  let media = "";
  if (IMAGE_EXT.has(ext)) media = `<img class="a-preview__img" src="${url}" alt="${esc(name)}" />`;
  else if (VIDEO_EXT.has(ext)) media = `<video class="a-preview__img" src="${url}" controls preload="metadata"></video>`;
  else if (AUDIO_EXT.has(ext)) media = `<audio src="${url}" controls preload="metadata"></audio>`;
  else if (ext === "pdf") media = `<iframe class="a-preview__frame" src="${url}" title="${esc(name)}"></iframe>`;
  else media = `<pre class="a-preview__text" data-text>读取中…</pre>`;

  openDialog({
    title: name,
    body: `${media}
      <p class="a-hint">${esc(path)} · ${fmt(size)}</p>
      <p class="a-note a-note--bad" data-dialog-error hidden></p>`,
    ok: "下载",
    submit: async () => {
      const link = document.createElement("a");
      link.href = rawUrl(path, true);
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
    },
  });

  if (!media.includes("data-text")) return;
  fetch(url, { headers: { range: "bytes=0-20479" } })
    .then((res) => res.text())
    .then((text) => {
      const box = $("[data-text]", dialogBody);
      if (box) box.textContent = text.length ? text : "（空文件）";
    })
    .catch((error) => {
      const box = $("[data-text]", dialogBody);
      if (box) box.textContent = `读取失败：${error.message}`;
    });
}

/* ---------- 事件绑定 ---------- */

$("[data-mkdir]")?.addEventListener("click", () => doMkdir().catch((error) => alert(error.message)));

$$("[data-batch]").forEach((button) =>
  button.addEventListener("click", () => {
    doBatch(button.dataset.batch).catch((error) => alert(error.message));
  }),
);

document.addEventListener("click", (event) => {
  const rename = event.target.closest("[data-rename]");
  if (rename) {
    doRename(rename.dataset.rename, rename.dataset.name || "").catch((error) => alert(error.message));
    return;
  }

  const remove = event.target.closest("[data-remove]");
  if (remove) {
    const path = remove.dataset.remove;
    openDialog({
      title: "删除",
      body: `<p>确定删除 <strong>${esc(remove.dataset.name || path)}</strong>？</p>
        <p class="a-hint">${esc(path)}</p>
        <p class="a-note a-note--bad" data-dialog-error hidden></p>`,
      ok: "删除",
      danger: true,
      submit: async () => {
        await act({ action: "remove", targets: [path] });
        location.reload();
      },
    });
    return;
  }

  const preview = event.target.closest("[data-preview]");
  if (preview) {
    openPreview(preview.dataset.preview, preview.dataset.name || "", preview.dataset.size || 0);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialog?.open) closeDialog();
  if (event.key === "Delete" && !dialog?.open && picked().length) doBatch("remove");
});

syncSelection();

/* ---------- 存储 ---------- */

const driveForm = $("[data-add-drive]");

if (driveForm) {
  const GB = 1024 ** 3;
  const specs = JSON.parse($("#drive-specs")?.textContent || "{}");
  const drivesData = JSON.parse($("#drives-data")?.textContent || "[]");
  const index = new Map(drivesData.map((item) => [String(item.id), item]));
  const fieldsBox = $("[data-drive-fields]");
  const submitBtn = $("[data-drive-submit]", driveForm);
  const cancelBtn = $("[data-drive-cancel]", driveForm);
  const chips = $("[data-hidden-chips]");
  const hiddenEmpty = $("[data-hidden-empty]");
  const hiddenInput = $("[data-hidden-input]");
  const picker = $("[data-drive-dialog]");
  const pickList = $("[data-pick-list]", picker || document);
  const pickPath = $("[data-pick-path]", picker || document);
  const pickNote = $("[data-pick-note]", picker || document);
  const pickUp = $("[data-pick-up]", picker || document);
  const pickHide = $("[data-pick-hide-here]", picker || document);
  const pick = { driveId: null, path: "/" };

  const fieldOf = (name) => driveForm.querySelector(`[name="${name}"]`);
  const cfgField = (key) => fieldsBox?.querySelector(`[name="cfg_${key}"]`);
  /** 老数据里可能存成 cfg_cookie 这种带前缀的键，回填时统一剥掉 */
  const tidyKeys = (value) => {
    const out = {};
    for (const [key, raw] of Object.entries(value || {})) out[String(key).replace(/^cfg_/, "")] = raw;
    return out;
  };
  const hiddenList = () => (hiddenInput?.value || "").split("\n").map((item) => item.trim()).filter(Boolean);

  function renderHidden() {
    const list = hiddenList();
    if (chips) {
      chips.innerHTML = list
        .map((path) => `<li class="a-chip">${esc(path)}<button type="button" class="a-chip__x" data-hidden-remove="${esc(path)}" aria-label="取消隐藏">×</button></li>`)
        .join("");
    }
    if (hiddenEmpty) hiddenEmpty.hidden = list.length > 0;
  }

  const setHiddenList = (list) => {
    if (hiddenInput) hiddenInput.value = list.join("\n");
    renderHidden();
  };

  function renderConfig(driverKey, values = {}) {
    const spec = specs[driverKey];
    if (!fieldsBox) return;
    if (!spec?.fields?.length) {
      fieldsBox.innerHTML = "";
      return;
    }
    fieldsBox.innerHTML = `<div class="a-form__grid">
      ${spec.fields
        .map((field) => {
          const value = values[field.key] ?? "";
          if (field.type === "textarea") {
            return `<label class="a-form__wide"><span>${esc(field.label)}</span><textarea name="cfg_${field.key}" rows="3" placeholder="${esc(field.placeholder || "")}">${esc(value)}</textarea>${
              field.hint ? `<span class="a-hint">${esc(field.hint)}</span>` : ""
            }</label>`;
          }
          const type = field.type === "password" ? "password" : "text";
          return `<label><span>${esc(field.label)}</span><input name="cfg_${field.key}" type="${type}" value="${esc(value)}" placeholder="${esc(
            field.placeholder || "",
          )}" ${field.required ? "required" : ""} /></label>`;
        })
        .join("")}
    </div>`;
  }

  function fillForm(drive) {
    driveForm.dataset.driveId = drive ? String(drive.id) : "";
    fieldOf("name").value = drive?.name || "";
    fieldOf("driver").value = drive?.driver || "local";
    fieldOf("mount_path").value = drive?.mount_path || "";
    fieldOf("root").value = drive?.root || "/";
    fieldOf("visibility").value = drive?.visibility === "public" ? "public" : "members";
    fieldOf("enabled").checked = drive ? Boolean(drive.enabled) : true;
    fieldOf("quota_gb").value = drive?.quota_bytes ? (drive.quota_bytes / GB).toFixed(2) : "";
    fieldOf("max_file_gb").value = drive?.max_file_bytes ? (drive.max_file_bytes / GB).toFixed(2) : "";
    fieldOf("driver").disabled = Boolean(drive);
    renderConfig(drive?.driver || "local", tidyKeys(drive?.config || {}));
    setHiddenList(drive?.hidden || []);
    if (submitBtn) submitBtn.textContent = drive ? "保存修改" : "添加存储";
    if (cancelBtn) cancelBtn.hidden = !drive;
    driveForm.classList.toggle("is-editing", Boolean(drive));
  }

  fieldOf("driver").addEventListener("change", () => renderConfig(fieldOf("driver").value, {}));

  driveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = driveForm.dataset.driveId || "";
    const driverKey = fieldOf("driver").value;
    const config = {};
    for (const field of specs[driverKey]?.fields || []) {
      const value = cfgField(field.key)?.value?.trim();
      if (value) config[field.key] = value;
    }
    const gb = (name) => {
      const value = Number(fieldOf(name).value);
      return Number.isFinite(value) && value > 0 ? Math.trunc(value * GB) : 0;
    };
    const body = {
      name: fieldOf("name").value.trim() || specs[driverKey]?.label || "存储",
      root: fieldOf("root").value.trim() || "/",
      mount_path: fieldOf("mount_path").value.trim(),
      visibility: fieldOf("visibility").value,
      enabled: fieldOf("enabled").checked,
      quota_bytes: gb("quota_gb"),
      max_file_bytes: gb("max_file_gb"),
      hidden: hiddenList(),
      config,
    };
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (id) await api(`/memories/api/drives/${encodeURIComponent(id)}`, body);
      else await api("/memories/api/drives", { ...body, driver: driverKey });
      location.reload();
    } catch (error) {
      alert(error.message);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  cancelBtn?.addEventListener("click", () => fillForm(null));
  $("[data-hidden-open]")?.addEventListener("click", () => openPicker(pick.driveId));

  driveForm.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-hidden-remove]");
    if (!remove) return;
    setHiddenList(hiddenList().filter((path) => path !== remove.dataset.hiddenRemove));
  });

  /* 目录选择弹窗 */
  async function loadPick(path) {
    pick.path = path;
    if (pickPath) pickPath.textContent = path;
    if (!pickList) return;
    pickList.innerHTML = `<p class="a-hint">读取中…</p>`;
    try {
      const data = await api(`/memories/api/drives/${encodeURIComponent(pick.driveId)}/browse?path=${encodeURIComponent(path)}`, null, "GET");
      const entries = (data.entries || []).filter((item) => item.isDir);
      pickList.innerHTML =
        entries
          .map(
            (item) => `<div class="a-pick__item">
              <button class="a-pick__go" type="button" data-pick-enter="${esc(item.path)}">${esc(item.name)}</button>
              <button class="a-pick__toggle ${item.hidden ? "is-on" : ""}" type="button" data-pick-toggle="${esc(item.path)}">${
                item.hidden ? "已隐藏" : "隐藏"
              }</button>
            </div>`,
          )
          .join("") || `<p class="a-hint">这一层没有子目录。</p>`;
      if (pickNote) pickNote.textContent = `共 ${entries.length} 个子目录`;
      if (pickHide) pickHide.textContent = hiddenList().includes(path) ? "取消隐藏此目录" : "隐藏此目录";
    } catch (error) {
      pickList.innerHTML = `<p class="a-note a-note--bad">${esc(error.message)}</p>`;
    }
  }

  function openPicker(driveId) {
    const current = [...index.keys()][0];
    pick.driveId = String(driveId || current || "");
    if (!pick.driveId) return alert("先保存这份存储，再选择目录。");
    if (picker && !picker.open) picker.showModal();
    loadPick("/");
  }

  pickUp?.addEventListener("click", () => {
    const parent = pick.path.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
    loadPick(parent || "/");
  });

  pickHide?.addEventListener("click", () => {
    const path = pick.path;
    if (!path || path === "/") return;
    const list = hiddenList();
    setHiddenList(list.includes(path) ? list.filter((item) => item !== path) : [...list, path]);
    loadPick(path);
  });

  picker?.addEventListener("click", (event) => {
    const enter = event.target.closest("[data-pick-enter]");
    if (enter) return loadPick(enter.dataset.pickEnter);
    const toggle = event.target.closest("[data-pick-toggle]");
    if (toggle) {
      const path = toggle.dataset.pickToggle;
      const list = hiddenList();
      setHiddenList(list.includes(path) ? list.filter((item) => item !== path) : [...list, path]);
      loadPick(pick.path);
    }
  });

  $$("[data-dialog-close]", picker || document).forEach((button) => button.addEventListener("click", () => picker?.close()));

  /* 行内操作 */
  document.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-drive-edit]");
    if (edit) {
      const drive = index.get(String(edit.dataset.driveEdit));
      if (drive) {
        fillForm(drive);
        driveForm.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const del = event.target.closest("[data-drive-del]");
    if (del) {
      const drive = index.get(String(del.dataset.driveDel));
      openDialog({
        title: "删除存储",
        body: `<p>确定删除 <strong>${esc(drive?.name || "")}</strong>？</p>
          <p class="a-hint">只删掉这条挂载记录，云端的文件不会动。</p>
          <p class="a-note a-note--bad" data-dialog-error hidden></p>`,
        ok: "删除",
        danger: true,
        submit: async () => {
          await api(`/memories/api/drives/${encodeURIComponent(del.dataset.driveDel)}`, null, "DELETE");
          location.reload();
        },
      });
      return;
    }

    const test = event.target.closest("[data-drive-test]");
    if (test) {
      test.disabled = true;
      api(`/memories/api/drives/${encodeURIComponent(test.dataset.driveTest)}/test`)
        .then((data) => alert(`连接正常（${data.ms ?? 0}ms）\n列出 ${data.sample?.length ?? 0} 项`))
        .catch((error) => alert(error.message))
        .finally(() => {
          test.disabled = false;
        });
      return;
    }

    const cap = event.target.closest("[data-drive-cap]");
    if (cap) {
      cap.disabled = true;
      api(`/memories/api/drives/${encodeURIComponent(cap.dataset.driveCap)}/capacity`)
        .then((data) => {
          if (!data.supported) return alert("这个存储不提供容量信息，请在「总容量（GB）」里手动填写。");
          const total = data.total / GB;
          const free = data.free / GB;
          alert(`总容量 ${total.toFixed(2)} GB\n可用 ${free.toFixed(2)} GB`);
          location.reload();
        })
        .catch((error) => alert(error.message))
        .finally(() => {
          cap.disabled = false;
        });
    }
  });

  renderHidden();
}

