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
