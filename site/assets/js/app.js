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

/* ---------- 视图切换 ---------- */

const setView = (view) => {
  document.documentElement.dataset.view = view;
  localStorage.setItem("mem-view", view);
  $$("[data-view]").forEach((btn) => btn.classList.toggle("is-on", btn.dataset.view === view));
};

setView(localStorage.getItem("mem-view") || "grid");
$$("[data-view]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));

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
  const fmt = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };
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

const renderDriveFields = (driverKey) => {
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
        .map(
          (field) => `<label><span>${field.label}</span><input name="cfg.${field.key}" type="${
            field.type === "password" ? "password" : "text"
          }" placeholder="${field.placeholder || ""}" autocomplete="off" /></label>`,
        )
        .join("")}
    </div></fieldset>`;
};

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

$("[data-add-drive]")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const config = {};
  for (const input of $$('[data-drive-fields] input')) {
    const key = input.name.replace("cfg.", "");
    if (input.value.trim()) config[key] = input.value.trim();
  }
  try {
    await api("/memories/api/drives", { name: form.name.value.trim(), driver: form.driver.value, config, root: "/" });
    location.reload();
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener("click", async (event) => {
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
