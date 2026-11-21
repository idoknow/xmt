/* 前台媒体库：文件列表的选中、预览、信息、分享与批量操作 */

(() => {
  const table = document.querySelector("[data-fm-drive]");
  if (!table) return;

  const drive = table.dataset.fmDrive;
  const cwd = table.dataset.fmPath || "/";
  const dialog = document.querySelector("[data-fm-dialog]");
  const titleEl = dialog?.querySelector("[data-fm-title]");
  const bodyEl = dialog?.querySelector("[data-fm-body]");
  const footEl = dialog?.querySelector("[data-fm-foot]");
  const bar = document.querySelector("[data-fm-bar]");
  const countEl = document.querySelector("[data-fm-count]");
  const picks = new Set();
  let lastIndex = -1;

  const rows = () => Array.from(table.querySelectorAll("tbody tr[data-fm-path]"));
  const ticks = () => Array.from(table.querySelectorAll("[data-fm-pick]"));
  const nodeOf = (path) => ticks().find((item) => item.dataset.value === path);

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  const fmt = (bytes) => {
    const size = Number(bytes) || 0;
    if (size >= 1024 ** 3) return (size / 1024 ** 3).toFixed(2) + " GB";
    if (size >= 1024 ** 2) return (size / 1024 ** 2).toFixed(1) + " MB";
    if (size >= 1024) return Math.round(size / 1024) + " KB";
    return size + " B";
  };

  function sync() {
    for (const tick of ticks()) {
      const on = picks.has(tick.dataset.value);
      tick.classList.toggle("is-on", on);
      tick.setAttribute("aria-pressed", on ? "true" : "false");
      tick.closest("tr")?.classList.toggle("is-picked", on);
    }
    const all = document.querySelector("[data-fm-all]");
    if (all) {
      const total = ticks().length;
      all.classList.toggle("is-on", total > 0 && picks.size === total);
      all.classList.toggle("is-partial", picks.size > 0 && picks.size < total);
      all.setAttribute("aria-pressed", picks.size === total && total > 0 ? "true" : "false");
    }
    if (bar) {
      bar.hidden = picks.size === 0;
      if (countEl) countEl.textContent = `已选 ${picks.size} 项`;
    }
  }

  function toggle(path, index, shift) {
    if (shift && lastIndex >= 0) {
      const list = ticks();
      const [from, to] = [Math.min(lastIndex, index), Math.max(lastIndex, index)];
      for (let i = from; i <= to; i += 1) picks.add(list[i].dataset.value);
    } else if (picks.has(path)) {
      picks.delete(path);
    } else {
      picks.add(path);
    }
    lastIndex = index;
    sync();
  }

  ticks().forEach((tick, index) => {
    tick.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle(tick.dataset.value, index, event.shiftKey);
    });
  });

  document.querySelector("[data-fm-all]")?.addEventListener("click", () => {
    const all = ticks().map((item) => item.dataset.value);
    if (picks.size === all.length) picks.clear();
    else all.forEach((path) => picks.add(path));
    sync();
  });

  document.querySelector("[data-fm-clear]")?.addEventListener("click", () => {
    picks.clear();
    sync();
  });

  table.querySelector("tbody")?.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, label")) return;
    const row = event.target.closest("tr[data-fm-path]");
    if (!row) return;
    toggle(row.dataset.fmPath, rows().indexOf(row), event.shiftKey);
  });

  function openDialog(title, html, actions = "") {
    if (!dialog) return;
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.innerHTML = html;
    if (footEl) footEl.innerHTML = actions;
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog() {
    if (dialog?.open) dialog.close();
  }
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });

  async function act(payload) {
    const res = await fetch("/memories/files/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ drive, path: cwd, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `操作失败（${res.status}）`);
    return data;
  }

  const rawUrl = (path, download) =>
    `/memories/files/raw?drive=${encodeURIComponent(drive)}&path=${encodeURIComponent(path)}${
      download ? "&download=1" : ""
    }`;

  document.addEventListener("click", async (event) => {
    const preview = event.target.closest("[data-fm-preview]");
    if (preview) {
      event.preventDefault();
      const path = preview.dataset.fmPreview;
      const kind = preview.dataset.fmKind || "file";
      const url = rawUrl(path, false);
      const stage =
        kind === "image"
          ? `<img class="fm-preview__img" src="${esc(url)}" alt="" />`
          : kind === "video"
            ? `<video class="fm-preview__video" src="${esc(url)}" controls playsinline></video>`
            : kind === "audio"
              ? `<audio class="fm-preview__audio" src="${esc(url)}" controls></audio>`
              : kind === "pdf"
                ? `<iframe class="fm-preview__frame" src="${esc(url)}" title="PDF"></iframe>`
                : `<pre class="fm-preview__text" data-text-src="${esc(url)}">加载中…</pre>`;
      openDialog("预览", `<div class="fm-preview">${stage}</div>`, `<a class="a-btn a-btn--tiny" href="${esc(rawUrl(path, true))}">下载</a>`);
      const text = document.querySelector("[data-text-src]");
      if (text) {
        try {
          const res = await fetch(text.dataset.textSrc, { headers: { range: "bytes=0-20479" } });
          text.textContent = (await res.text()).slice(0, 20000) || "（空文件）";
        } catch {
          text.textContent = "这个文件没法在这里预览。";
        }
      }
      return;
    }

    const info = event.target.closest("[data-fm-info]");
    if (info) {
      event.preventDefault();
      try {
        const res = await fetch(`/memories/files/info?drive=${encodeURIComponent(drive)}&path=${encodeURIComponent(info.dataset.fmInfo)}`);
        const data = await res.json();
        if (data.ok === false) throw new Error(data.error);
        const file = data.file || {};
        const rowsHtml = [
          ["名称", file.name],
          ["位置", file.display],
          ["类型", file.isDir ? "文件夹" : file.mime || ""],
          ["大小", file.isDir ? "—" : fmt(file.size)],
          ["修改时间", file.modified ? String(file.modified).slice(0, 19).replace("T", " ") : "—"],
          file.width ? ["分辨率", `${file.width} × ${file.height}`] : null,
          file.duration ? ["时长", `${Math.round(file.duration)} 秒`] : null,
          file.fps ? ["帧率", `${Number(file.fps).toFixed(1)} fps`] : null,
        ].filter(Boolean);
        openDialog(
          "详细信息",
          `<dl class="fm-info">${rowsHtml.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value || "—")}</dd>`).join("")}</dl>`,
        );
      } catch (error) {
        openDialog("详细信息", `<p class="a-hint">${esc(error.message)}</p>`);
      }
      return;
    }

    const share = event.target.closest("[data-fm-share]");
    if (share) {
      event.preventDefault();
      try {
        const data = await act({ action: "share", targets: [share.dataset.fmShare] });
        const link = data.links?.[0];
        openDialog(
          "分享",
          link
            ? `<p class="a-hint">把这个链接发出去，对方打开就能看：</p><p class="fm-share"><input class="a-input" readonly value="${esc(new URL(link.url, location.origin).href)}" /></p>`
            : '<p class="a-hint">分享链接已生成，但没拿到地址。</p>',
          link ? '<button class="a-btn a-btn--tiny" type="button" data-fm-copy>复制链接</button>' : "",
        );
        if (link) setTimeout(() => document.querySelector("[data-fm-copy]")?.focus(), 30);
      } catch (error) {
        openDialog("分享失败", `<p class="a-hint">${esc(error.message)}</p>`);
      }
      return;
    }

    const copy = event.target.closest("[data-fm-copy]");
    if (copy) {
      const input = document.querySelector(".fm-share input");
      if (input) {
        input.select();
        try {
          await navigator.clipboard.writeText(input.value);
        } catch {
          document.execCommand("copy");
        }
        copy.textContent = "已复制";
      }
      return;
    }

    const rename = event.target.closest("[data-fm-rename]");
    if (rename) {
      event.preventDefault();
      const next = prompt("改成什么名字？", rename.dataset.fmName || "");
      if (!next || next === rename.dataset.fmName) return;
      try {
        await act({ action: "rename", target: rename.dataset.fmRename, name: next });
        location.reload();
      } catch (error) {
        openDialog("改名失败", `<p class="a-hint">${esc(error.message)}</p>`);
      }
      return;
    }

    const remove = event.target.closest("[data-fm-remove]");
    if (remove) {
      event.preventDefault();
      if (!confirm(`删除「${remove.dataset.fmRemove}」？删除后不能恢复。`)) return;
      try {
        await act({ action: "remove", targets: [remove.dataset.fmRemove] });
        location.reload();
      } catch (error) {
        openDialog("删除失败", `<p class="a-hint">${esc(error.message)}</p>`);
      }
      return;
    }

    const mkdir = event.target.closest("[data-fm-mkdir]");
    if (mkdir) {
      event.preventDefault();
      const name = prompt("新文件夹的名字？");
      if (!name) return;
      try {
        await act({ action: "mkdir", name, path: cwd });
        location.reload();
      } catch (error) {
        openDialog("新建失败", `<p class="a-hint">${esc(error.message)}</p>`);
      }
      return;
    }

    const batch = event.target.closest("[data-fm-batch]");
    if (batch) {
      event.preventDefault();
      const targets = Array.from(picks);
      if (!targets.length) return;
      const mode = batch.dataset.fmBatch;
      try {
        if (mode === "download") {
          targets.forEach((path, index) => {
            setTimeout(() => {
              const link = document.createElement("a");
              link.href = rawUrl(path, true);
              link.download = "";
              document.body.append(link);
              link.click();
              link.remove();
            }, index * 400);
          });
        } else if (mode === "share") {
          const data = await act({ action: "share", targets });
          openDialog(
            "分享链接",
            `<ul class="fm-links">${(data.links || [])
              .map((item) => `<li><span>${esc(item.name)}</span><input class="a-input" readonly value="${esc(new URL(item.url, location.origin).href)}" /></li>`)
              .join("")}</ul>`,
          );
        } else if (mode === "remove") {
          if (!confirm(`删除选中的 ${targets.length} 项？`)) return;
          await act({ action: "remove", targets });
          location.reload();
        } else if (mode === "move" || mode === "copy") {
          const dest = prompt(mode === "move" ? "移动到哪个目录？（如 /相册）" : "复制到哪个目录？（如 /相册）", cwd);
          if (!dest) return;
          await act({ action: mode, targets, dest });
          location.reload();
        }
      } catch (error) {
        openDialog("操作失败", `<p class="a-hint">${esc(error.message)}</p>`);
      }
    }
  });

  document.querySelector("[data-fm-upload]")?.addEventListener("change", async (event) => {
    const input = event.target;
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const form = new FormData();
    form.append("drive", drive);
    form.append("path", cwd);
    files.forEach((file) => form.append("files", file));
    openDialog("上传中", `<p class="a-hint">正在上传 ${files.length} 个文件…</p>`);
    try {
      const res = await fetch("/memories/files/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `上传失败（${res.status}）`);
      location.reload();
    } catch (error) {
      openDialog("上传失败", `<p class="a-hint">${esc(error.message)}</p>`);
    }
  });
})();
