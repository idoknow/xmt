// 管理台「文件」页的交互：上传、新建目录、改名、批量移动/复制/删除。
const params = new URLSearchParams(location.search);
const DRIVE = params.get("drive") || "";
const PATH = params.get("path") || "/";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
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

const picked = () => $$("[data-pick]").filter((box) => box.checked).map((box) => box.value);
const join = (dir, name) => (dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`);

/* ---------- 全选 ---------- */

const pickAll = $("[data-pick-all]");
pickAll?.addEventListener("change", () => {
  $$("[data-pick]").forEach((box) => {
    box.checked = pickAll.checked;
  });
  syncCount();
});

document.addEventListener("change", (event) => {
  if (event.target.closest("[data-pick]")) syncCount();
});

function syncCount() {
  const boxes = $$("[data-pick]");
  if (pickAll) {
    pickAll.checked = boxes.length > 0 && boxes.every((box) => box.checked);
    pickAll.indeterminate = !pickAll.checked && boxes.some((box) => box.checked);
  }
  const note = $("[data-count]");
  if (note) note.dataset.picked = String(picked().length);
}

/* ---------- 上传 ---------- */

const uploadInput = $("[data-upload]");
const uploadBox = $("[data-upload-progress]");
const uploadBar = $("[data-upload-bar]");
const uploadNote = $("[data-upload-note]");

uploadInput?.addEventListener("change", () => {
  const files = Array.from(uploadInput.files || []);
  if (!files.length || !DRIVE) return;
  const form = new FormData();
  form.append("drive", DRIVE);
  form.append("path", PATH);
  for (const file of files) form.append("files", file);

  uploadBox.hidden = false;
  uploadBar.style.width = "0%";
  uploadNote.textContent = `上传 ${files.length} 个文件…`;

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/memories/admin/files/upload");
  xhr.upload.addEventListener("progress", (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    uploadBar.style.width = `${percent}%`;
    uploadNote.textContent = `${percent}% · ${fmt(event.loaded)} / ${fmt(event.total)}`;
  });
  xhr.addEventListener("load", () => {
    let data = {};
    try {
      data = JSON.parse(xhr.responseText);
    } catch {
      data = {};
    }
    if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
      uploadNote.textContent = `已上传 ${data.files?.length ?? files.length} 个`;
      location.reload();
    } else {
      uploadNote.textContent = data.error || `上传失败（${xhr.status}）`;
      uploadBar.classList.add("is-error");
    }
  });
  xhr.addEventListener("error", () => {
    uploadNote.textContent = "上传中断，检查一下网络再试";
    uploadBar.classList.add("is-error");
  });
  xhr.send(form);
});

/* ---------- 单个操作 ---------- */

async function act(body) {
  if (!DRIVE) throw new Error("先选一个存储");
  return api("/memories/admin/files/action", { drive: DRIVE, ...body });
}

$("[data-mkdir]")?.addEventListener("click", async () => {
  const name = prompt("新文件夹的名字", "新建文件夹");
  if (!name) return;
  try {
    await act({ action: "mkdir", path: PATH, name: name.trim() });
    location.reload();
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const rename = event.target.closest("[data-rename]");
  if (rename) {
    const name = prompt("新的名字", rename.dataset.name || "");
    if (!name || name === rename.dataset.name) return;
    try {
      await act({ action: "rename", target: rename.dataset.rename, name: name.trim() });
      location.reload();
    } catch (error) {
      alert(error.message);
    }
    return;
  }

  const remove = event.target.closest("[data-remove]");
  if (remove) {
    if (!confirm("删除这一项？删了就找不回来了。")) return;
    try {
      await act({ action: "remove", targets: [remove.dataset.remove] });
      location.reload();
    } catch (error) {
      alert(error.message);
    }
  }
});

/* ---------- 批量 ---------- */

$$("[data-batch]").forEach((button) =>
  button.addEventListener("click", async () => {
    const paths = picked();
    if (!paths.length) {
      alert("先勾选几项。");
      return;
    }
    const mode = button.dataset.batch;
    if (mode === "remove") {
      if (!confirm(`删除选中的 ${paths.length} 项？`)) return;
      try {
        await act({ action: "remove", paths });
        location.reload();
      } catch (error) {
        alert(error.message);
      }
      return;
    }
    const target = prompt(`要把这 ${paths.length} 项${mode === "move" ? "移动" : "复制"}到哪个目录？`, PATH);
    if (!target) return;
    try {
      await act({ action: mode, targets: paths, dest: target.trim() });
      location.reload();
    } catch (error) {
      alert(error.message);
    }
  }),
);

syncCount();
