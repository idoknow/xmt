// 在线工具：全部在浏览器本地处理，不上传任何文件。
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const fmtSize = (bytes) => {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const baseName = (name) => String(name || "image").replace(/\.[^.]+$/, "") || "image";
const extOf = (mime) => ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[mime] || "png");

/* ---------- 解码 / 编码 ---------- */

const isVector = (file) => /svg/i.test(file.type) || /\.svg$/i.test(file.name);

async function decode(file) {
  if (isVector(file)) {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("这个 SVG 读不出来（可能缺少尺寸或含脚本）"));
        img.src = url;
      });
      const width = image.naturalWidth || image.width || 1024;
      const height = image.naturalHeight || image.height || 1024;
      return { source: image, width, height, vector: true };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, vector: false };
  }
  const url = URL.createObjectURL(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("这张图读不出来"));
    img.src = url;
  });
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, vector: false };
}

function paint(decoded, width, height, background = null) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encode(canvas, mime, quality) {
  const q = Math.min(1, Math.max(0.05, quality));
  if (mime === "image/png") {
    return await new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("编码失败"))), mime),
    );
  }
  return await new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("编码失败"))), mime, q),
  );
}

const results = { convert: [], compress: [], resize: [] };
const urls = [];

// 把主线程让出去一帧，批量处理时进度和按钮状态才来得及刷新
const tick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function resultsBar(container) {
  const list = $(`[data-out="${container}"]`);
  if (!list) return null;
  let bar = list.previousElementSibling;
  if (!bar || !bar.classList.contains("results__bar")) {
    bar = document.createElement("div");
    bar.className = "results__bar";
    bar.hidden = true;
    list.before(bar);
  }
  return bar;
}

function downloadAll(container) {
  const links = $$(`[data-out="${container}"] .results__save`);
  links.forEach((link, index) => setTimeout(() => link.click(), index * 220));
}

function show(container, items) {
  const list = $(`[data-out="${container}"]`);
  if (!list) return;
  for (const url of results[container]) URL.revokeObjectURL(url);
  results[container] = [];
  list.innerHTML = "";

  const bar = resultsBar(container);
  if (!items.length) {
    list.innerHTML = '<li class="results__empty">还没有结果。</li>';
    if (bar) {
      bar.hidden = true;
      bar.innerHTML = "";
    }
    return;
  }

  const ok = items.filter((item) => item.blob);
  const beforeSum = ok.reduce((sum, item) => sum + (Number(item.before) || 0), 0);
  const afterSum = ok.reduce((sum, item) => sum + item.blob.size, 0);
  if (bar) {
    const parts = [`共 ${ok.length} 个`];
    if (beforeSum > 0) {
      parts.push(`${fmtSize(beforeSum)} → ${fmtSize(afterSum)}`);
      const ratio = Math.abs(1 - afterSum / beforeSum);
      if (ratio >= 0.01) parts.push(`${afterSum <= beforeSum ? "省" : "多"} ${(ratio * 100).toFixed(0)}%`);
    }
    bar.hidden = false;
    bar.innerHTML = `<span class="results__sum">${parts.join(" · ")}</span><button type="button" class="results__all">全部下载</button>`;
    bar.querySelector(".results__all").addEventListener("click", () => downloadAll(container));
  }

  for (const item of items) {
    const li = document.createElement("li");
    if (!item.blob) {
      li.className = "results__item is-error";
      li.innerHTML = `
        <span class="results__text">
          <span class="results__name">${escapeHtml(item.name)}</span>
          <span class="results__meta">${escapeHtml(item.detail || "处理失败")}</span>
        </span>`;
      list.append(li);
      continue;
    }
    const url = URL.createObjectURL(item.blob);
    results[container].push(url);
    const ratio = item.before ? Math.abs(1 - item.blob.size / item.before) : 0;
    const change = item.before && ratio >= 0.01 ? `${item.blob.size <= item.before ? "省" : "多"} ${(ratio * 100).toFixed(0)}%` : "";
    const meta = [item.detail, fmtSize(item.blob.size), change].filter(Boolean).join(" · ");
    li.className = "results__item";
    li.innerHTML = `
      <img class="results__thumb" src="${url}" alt="" loading="lazy" decoding="async" />
      <span class="results__text">
        <span class="results__name">${escapeHtml(item.name)}</span>
        <span class="results__meta">${escapeHtml(meta)}</span>
      </span>
      <a class="results__save" href="${url}" download="${escapeHtml(item.name)}">下载</a>`;
    list.append(li);
  }
}

const status = (tool, text) => {
  const node = $(`[data-status="${tool}"]`);
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("is-busy", /正在|处理中|读取|压缩/.test(text || ""));
  node.classList.toggle("is-done", /完成|已生成|已下载|已导出|共 \d+/.test(text || ""));
  node.classList.toggle("is-error", /失败|错误|不支持|超出/.test(text || ""));
};

const markPicked = (tool, files) => {
  const node = $(`[data-picked="${tool}"]`);
  if (node) node.classList.toggle("is-ready", Boolean(files?.length));
};

const picked = (tool, files) => {
  const node = $(`[data-picked="${tool}"]`);
  if (!node) return;
  markPicked(tool, files);
  if (!files?.length) node.textContent = "还没有选择文件";
  else if (files.length === 1) node.textContent = `${files[0].name} · ${fmtSize(files[0].size)}`;
  else node.textContent = `已选 ${files.length} 个文件`;
};

/* ---------- 滑块旁的数值标签 ---------- */

$$('input[type="range"]').forEach((input) => {
  const label = input.dataset.opt ? $(`[data-out-label="${input.dataset.opt}"]`) : null;
  if (!label) return;
  const sync = () => {
    label.textContent = input.value;
  };
  input.addEventListener("input", sync);
  sync();
});

/* ---------- 自绘下拉：原生 select 只留值，界面自己画 ---------- */

function enhanceSelect(select) {
  if (!select || select.dataset.enhanced === "1" || select.classList.contains("sel__native")) return;
  select.dataset.enhanced = "1";
  select.classList.add("sel__native");
  select.setAttribute("aria-hidden", "true");

  const wrap = document.createElement("div");
  wrap.className = "sel";
  wrap.innerHTML = `
    <button type="button" class="sel__btn" aria-haspopup="listbox" aria-expanded="false">
      <span class="sel__text"></span>
      <svg class="sel__arrow" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 4.6 6 8l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <ul class="sel__menu" role="listbox" hidden></ul>`;
  select.after(wrap);

  const btn = wrap.querySelector(".sel__btn");
  const text = wrap.querySelector(".sel__text");
  const menu = wrap.querySelector(".sel__menu");

  const render = () => {
    const options = Array.from(select.options);
    menu.innerHTML = options
      .map(
        (option) =>
          `<li role="option" data-value="${option.value}"${option.value === select.value ? ' aria-selected="true"' : ""}>${option.textContent}</li>`,
      )
      .join("");
    const current = select.selectedOptions[0];
    text.textContent = current ? current.textContent : "";
  };
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  const open = () => {
    render();
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    (menu.querySelector('[aria-selected="true"]') || menu.firstElementChild)?.focus();
  };

  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  btn.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
    }
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("li[data-value]");
    if (!item) return;
    select.value = item.dataset.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    render();
    close();
    btn.focus();
  });
  menu.addEventListener("keydown", (event) => {
    const items = Array.from(menu.children);
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      close();
      btn.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      (items[index + 1] || items[0]).focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      (items[index - 1] || items[items.length - 1]).focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      document.activeElement.click();
    }
  });
  document.addEventListener("click", (event) => {
    if (!wrap.contains(event.target)) close();
  });
  select.addEventListener("change", render);
  select.renderOptions = render;
  render();
}

$$("select.field__input").forEach(enhanceSelect);

/* ---------- 文件选择 ---------- */

const inputs = {};$$("[data-file]").forEach((input) => {
  const tool = input.dataset.file;
  inputs[tool] = input;
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    picked(tool, files);
    if (tool === "crop" || tool === "watermark") preview(tool, files[0]);
    if (tool === "compress" || tool === "resize") preview(tool, files[0], tool);
  });
});

function preview(tool, file, toolKey) {
  const img = $(`[data-preview="${tool}"]`);
  if (!img) return;
  if (!file) {
    img.removeAttribute("src");
    return;
  }
  const url = URL.createObjectURL(file);
  urls.push(url);
  img.onload = () => {
    img.dataset.w = String(img.naturalWidth);
    img.dataset.h = String(img.naturalHeight);
    if (tool === "crop") {
      const x = $('[data-opt="crop.x"]');
      const y = $('[data-opt="crop.y"]');
      const w = $('[data-opt="crop.w"]');
      const h = $('[data-opt="crop.h"]');
      if (x) x.max = String(img.naturalWidth - 1);
      if (y) y.max = String(img.naturalHeight - 1);
      if (w) w.max = String(img.naturalWidth);
      if (h) h.max = String(img.naturalHeight);
      const boxW = Number(w?.value) || 0;
      const boxH = Number(h?.value) || 0;
      const inside = boxW > 0 && boxH > 0 && boxW <= img.naturalWidth && boxH <= img.naturalHeight;
      if (!inside) {
        // 换了张图、原来的框超出去了：给一个居中的六成框
        const boxSizeW = Math.round(img.naturalWidth * 0.6);
        const boxSizeH = Math.round(img.naturalHeight * 0.6);
        if (w) w.value = String(boxSizeW);
        if (h) h.value = String(boxSizeH);
        if (x) x.value = String(Math.round((img.naturalWidth - boxSizeW) / 2));
        if (y) y.value = String(Math.round((img.naturalHeight - boxSizeH) / 2));
      }
      syncCropBox();
    }
    if (tool === "watermark") drawWatermarkPreview();
    if (toolKey === "resize") {
      const width = $('[data-opt="resize.width"]');
      const height = $('[data-opt="resize.height"]');
      if (width) width.value = String(img.naturalWidth);
      if (height) height.value = String(img.naturalHeight);
    }
  };
  img.src = url;
}

/* ---------- 01 格式转换 ---------- */

$('[data-run="convert"]')?.addEventListener("click", async () => {
  const files = Array.from(inputs.convert?.files || []);
  if (!files.length) return status("convert", "先选图片。");
  const mime = $('[data-opt="convert.format"]').value;
  const quality = Number($('[data-opt="convert.quality"]').value) / 100;
  const items = [];
  for (const [index, file] of files.entries()) {
    status("convert", `正在转换 ${index + 1}/${files.length}…`);
    await tick();
    try {
      const decoded = await decode(file);
      const canvas = paint(decoded, decoded.width, decoded.height, mime === "image/jpeg" ? "#ffffff" : null);
      const blob = await encode(canvas, mime, quality);
      items.push({
        blob,
        before: file.size,
        name: `${baseName(file.name)}.${extOf(mime)}`,
        detail: `${decoded.width}×${decoded.height}`,
      });
    } catch (error) {
      items.push({ name: file.name, detail: `失败：${error.message}` });
    }
  }
  show("convert", items);
  const failed = items.filter((item) => !item.blob).length;
  status("convert", failed ? `完成 ${items.length - failed} 个，${failed} 个失败。` : `完成 ${items.length} 个。`);
});

/* ---------- 02 压缩 ---------- */

const compressLabels = {
  size: { label: "目标大小", units: ["KB", "MB"], value: "300" },
  edge: { label: "最长边", units: ["px"], value: "1920" },
  percent: { label: "保留比例", units: ["%"], value: "60" },
};

$('[data-opt="compress.mode"]')?.addEventListener("change", (event) => {
  const spec = compressLabels[event.target.value] || compressLabels.size;
  const label = $('[data-label-for="compress"]');
  const value = $('[data-opt="compress.value"]');
  if (label) label.textContent = spec.label;
  if (value) value.value = spec.value;
  const unit = $('[data-opt="compress.unit"]');
  if (unit) {
    unit.innerHTML = spec.units.map((name) => `<option value="${name}">${name}</option>`).join("");
    unit.renderOptions?.();
  }
});

$('[data-run="compress"]')?.addEventListener("click", async () => {
  const file = inputs.compress?.files?.[0];
  if (!file) return status("compress", "先选一张图。");
  const mode = $('[data-opt="compress.mode"]').value;
  const value = Number($('[data-opt="compress.value"]').value) || 0;
  const unit = ($('[data-opt="compress.unit"]')?.value || "KB").toUpperCase();
  const bytesPerUnit = unit === "MB" ? 1024 * 1024 : 1024;
  // 压缩统一输出 WebP：PNG 是无损格式，改质量没有意义，体积还会变大。
  const mime = "image/webp";
  status("compress", "压缩中…");
  try {
    const decoded = await decode(file);
    let width = decoded.width;
    let height = decoded.height;
    let quality = 0.9;
    if (mode === "edge" && value > 0) {
      const scale = Math.min(1, value / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    } else if (mode === "percent") {
      const scale = Math.min(1, Math.max(0.05, value / 100));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    let blob;
    if (mode === "size" && value > 0) {
      const target = value * bytesPerUnit;
      let low = 0.2;
      let high = 0.96;
      let best = null;
      for (let i = 0; i < 7; i += 1) {
        const mid = (low + high) / 2;
        const canvas = paint(decoded, width, height);
        const candidate = await encode(canvas, mime, mid);
        if (!best || candidate.size < best.size) best = candidate;
        if (candidate.size > target) high = mid;
        else low = mid;
      }
      blob = best;
      let scale = 0.9;
      while (blob.size > target && scale > 0.25) {
        width = Math.round(decoded.width * scale);
        height = Math.round(decoded.height * scale);
        blob = await encode(paint(decoded, width, height), mime, 0.8);
        scale -= 0.1;
      }
      quality = low;
    } else {
      blob = await encode(paint(decoded, width, height), mime, quality);
    }

    show("compress", [
      {
        blob,
        before: file.size,
        name: `${baseName(file.name)}-compressed.${extOf(mime)}`,
        detail: `${width}×${height}`,
      },
    ]);
    status("compress", `原来 ${fmtSize(file.size)}，现在 ${fmtSize(blob.size)}。`);
  } catch (error) {
    status("compress", error.message);
  }
});

/* ---------- 03 尺寸调整 ---------- */

$('[data-opt="resize.mode"]')?.addEventListener("change", (event) => {
  const pixel = event.target.value === "pixel";
  $$('[data-show="pixel"]').forEach((node) => {
    node.hidden = !pixel;
  });
  $$('[data-show="percent"]').forEach((node) => {
    node.hidden = pixel;
  });
});

$('[data-run="resize"]')?.addEventListener("click", async () => {
  const file = inputs.resize?.files?.[0];
  if (!file) return status("resize", "先选一张图。");
  const mode = $('[data-opt="resize.mode"]').value;
  status("resize", "处理中…");
  try {
    const decoded = await decode(file);
    let width = decoded.width;
    let height = decoded.height;
    if (mode === "percent") {
      const scale = Math.max(0.05, (Number($('[data-opt="resize.percent"]').value) || 100) / 100);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    } else {
      const targetW = Number($('[data-opt="resize.width"]').value) || decoded.width;
      const targetH = Number($('[data-opt="resize.height"]').value) || decoded.height;
      if ($('[data-opt="resize.lock"]').checked) {
        const scale = Math.min(targetW / decoded.width, targetH / decoded.height);
        width = Math.round(decoded.width * scale);
        height = Math.round(decoded.height * scale);
      } else {
        width = targetW;
        height = targetH;
      }
    }
    const mime = decoded.vector || /png$/i.test(file.type) ? "image/png" : "image/webp";
    const blob = await encode(paint(decoded, width, height), mime, 0.92);
    show("resize", [
      {
        blob,
        before: file.size,
        name: `${baseName(file.name)}-${width}x${height}.${extOf(mime)}`,
        detail: `${decoded.width}×${decoded.height} → ${width}×${height}`,
      },
    ]);
    status("resize", "完成。");
  } catch (error) {
    status("resize", error.message);
  }
});

/* ---------- 04 裁剪 ---------- */

let cropDrag = null;

function cropValues() {
  const get = (key) => Number($(`[data-opt="crop.${key}"]`)?.value) || 0;
  const img = $('[data-preview="crop"]');
  const maxW = Number(img?.dataset.w) || 0;
  const maxH = Number(img?.dataset.h) || 0;
  let x = Math.max(0, get("x"));
  let y = Math.max(0, get("y"));
  let w = Math.max(1, get("w"));
  let h = Math.max(1, get("h"));
  if ($('[data-opt="crop.square"]').checked) {
    const side = Math.min(w, h);
    w = side;
    h = side;
  }
  if (maxW && maxH) {
    w = Math.min(w, maxW - x);
    h = Math.min(h, maxH - y);
  }
  return { x, y, w, h };
}

function cropGeometry() {
  const img = $('[data-preview="crop"]');
  const stage = $('[data-stage="crop"]');
  if (!img || !stage || !img.src) return null;
  const naturalW = Number(img.dataset.w) || img.naturalWidth || 0;
  const naturalH = Number(img.dataset.h) || img.naturalHeight || 0;
  const rect = img.getBoundingClientRect();
  const frame = stage.getBoundingClientRect();
  if (!naturalW || !naturalH || !rect.width) return null;
  return {
    naturalW,
    naturalH,
    k: rect.width / naturalW,
    ox: rect.left - frame.left,
    oy: rect.top - frame.top,
  };
}

function syncCropBox() {
  const box = $("[data-cropbox]");
  const geom = cropGeometry();
  if (!box) return;
  if (!geom) {
    box.hidden = true;
    return;
  }
  const { x, y, w, h } = cropValues();
  box.style.left = `${geom.ox + x * geom.k}px`;
  box.style.top = `${geom.oy + y * geom.k}px`;
  box.style.width = `${Math.max(12, w * geom.k)}px`;
  box.style.height = `${Math.max(12, h * geom.k)}px`;
  box.hidden = false;
}

function writeCrop({ x, y, w, h }) {
  const set = (key, value) => {
    const input = $(`[data-opt="crop.${key}"]`);
    if (input) input.value = String(Math.round(value));
  };
  set("x", x);
  set("y", y);
  set("w", w);
  set("h", h);
  syncCropBox();
}

$$('[data-opt^="crop."]').forEach((input) => input.addEventListener("input", syncCropBox));
window.addEventListener("resize", syncCropBox);

const stageCrop = $('[data-stage="crop"]');

stageCrop?.addEventListener("pointerdown", (event) => {
  const geom = cropGeometry();
  if (!geom) return;
  const handle = event.target.closest("[data-handle]")?.dataset.handle;
  const inBox = Boolean(event.target.closest("[data-cropbox]"));
  if (!handle && !inBox) return;
  event.preventDefault();
  const start = cropValues();
  cropDrag = {
    handle: handle || "move",
    startX: event.clientX,
    startY: event.clientY,
    k: geom.k,
    ...start,
  };
  stageCrop.setPointerCapture(event.pointerId);
  stageCrop.classList.add("is-dragging");
});

stageCrop?.addEventListener("pointermove", (event) => {
  if (!cropDrag) return;
  const geom = cropGeometry();
  if (!geom) return;
  const dx = (event.clientX - cropDrag.startX) / cropDrag.k;
  const dy = (event.clientY - cropDrag.startY) / cropDrag.k;
  const { handle, x: x0, y: y0, w: w0, h: h0 } = cropDrag;
  const min = 16;
  const square = Boolean($('[data-opt="crop.square"]')?.checked);
  let x = x0;
  let y = y0;
  let w = w0;
  let h = h0;

  if (handle === "move") {
    x = clamp(x0 + dx, 0, geom.naturalW - w0);
    y = clamp(y0 + dy, 0, geom.naturalH - h0);
  } else {
    if (handle.includes("e")) w = clamp(w0 + dx, min, geom.naturalW - x0);
    if (handle.includes("s")) h = clamp(h0 + dy, min, geom.naturalH - y0);
    if (handle.includes("w")) {
      x = clamp(x0 + dx, 0, x0 + w0 - min);
      w = w0 + (x0 - x);
    }
    if (handle.includes("n")) {
      y = clamp(y0 + dy, 0, y0 + h0 - min);
      h = h0 + (y0 - y);
    }
    if (square) {
      const side = Math.min(w, h);
      if (handle.includes("w")) x = x0 + w0 - side;
      if (handle.includes("n")) y = y0 + h0 - side;
      w = side;
      h = side;
    }
    w = Math.min(w, geom.naturalW - x);
    h = Math.min(h, geom.naturalH - y);
  }

  writeCrop({ x, y, w, h });
});

const endCropDrag = () => {
  cropDrag = null;
  stageCrop?.classList.remove("is-dragging");
};
stageCrop?.addEventListener("pointerup", endCropDrag);
stageCrop?.addEventListener("pointercancel", endCropDrag);

$('[data-run="crop"]')?.addEventListener("click", async () => {
  const file = inputs.crop?.files?.[0];
  if (!file) return status("crop", "先选一张图。");
  status("crop", "裁剪中…");
  try {
    const decoded = await decode(file);
    const { x, y, w, h } = cropValues();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    if (/jpe?g/i.test(file.type)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(decoded.source, x, y, w, h, 0, 0, w, h);
    const mime = /png$/i.test(file.type) || decoded.vector ? "image/png" : "image/webp";
    const blob = await encode(canvas, mime, 0.94);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName(file.name)}-crop-${x},${y}-${w}x${h}.${extOf(mime)}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    status("crop", `已裁剪 ${w}×${h}，文件已开始下载。`);
  } catch (error) {
    status("crop", error.message);
  }
});

/* ---------- 05 加水印 ---------- */

function watermarkOn(canvas, imageCanvas) {
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageCanvas, 0, 0);
  const text = $('[data-opt="watermark.text"]').value || "桂林中学新媒体";
  const sizePct = Number($('[data-opt="watermark.size"]').value) || 4;
  const alpha = (Number($('[data-opt="watermark.opacity"]').value) || 55) / 100;
  const angle = ((Number($('[data-opt="watermark.angle"]').value) || 0) * Math.PI) / 180;
  const color = $('[data-opt="watermark.color"]').value || "#ffffff";
  const position = $('[data-opt="watermark.position"]').value;
  const fontSize = Math.max(10, Math.round((canvas.width * sizePct) / 100));
  ctx.font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.textBaseline = "middle";
  const pad = Math.round(fontSize * 0.9);
  const metrics = ctx.measureText(text);

  if (position === "tile") {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle);
    const stepX = metrics.width + fontSize * 3;
    const stepY = fontSize * 4;
    const diag = Math.ceil(Math.hypot(canvas.width, canvas.height) / 2);
    for (let y = -diag; y < diag; y += stepY) {
      for (let x = -diag; x < diag; x += stepX) ctx.fillText(text, x, y);
    }
    ctx.restore();
    return;
  }

  const spots = {
    "bottom-right": [canvas.width - metrics.width - pad, canvas.height - pad],
    "bottom-left": [pad, canvas.height - pad],
    "top-right": [canvas.width - metrics.width - pad, pad],
    "top-left": [pad, pad],
    center: [(canvas.width - metrics.width) / 2, canvas.height / 2],
  };
  const [x, y] = spots[position] || spots["bottom-right"];
  ctx.save();
  ctx.translate(x + metrics.width / 2, y);
  ctx.rotate(angle);
  ctx.fillText(text, -metrics.width / 2, 0);
  ctx.restore();
}

async function drawWatermarkPreview() {
  const img = $('[data-preview="watermark"]');
  if (!img?.src) return;
  const file = inputs.watermark?.files?.[0];
  if (!file) return;
  const decoded = await decode(file);
  const maxW = 900;
  const scale = Math.min(1, maxW / decoded.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(decoded.width * scale);
  canvas.height = Math.round(decoded.height * scale);
  // 预览也按真实比例画，只是整体缩小
  const full = document.createElement("canvas");
  full.width = decoded.width;
  full.height = decoded.height;
  watermarkOn(full, paint(decoded, decoded.width, decoded.height));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
  img.src = canvas.toDataURL("image/webp", 0.9);
}

$$('[data-opt^="watermark."]').forEach((input) => {
  input.addEventListener("input", () => {
    const label = $(`[data-out-label="${input.dataset.opt}"]`);
    if (label) label.textContent = input.value;
    drawWatermarkPreview();
  });
  input.addEventListener("change", drawWatermarkPreview);
});

$('[data-run="watermark"]')?.addEventListener("click", async () => {
  const file = inputs.watermark?.files?.[0];
  if (!file) return status("watermark", "先选一张图。");
  status("watermark", "生成中…");
  try {
    const decoded = await decode(file);
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    watermarkOn(canvas, paint(decoded, decoded.width, decoded.height));
    const mime = /png$/i.test(file.type) || decoded.vector ? "image/png" : "image/webp";
    const blob = await encode(canvas, mime, 0.92);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName(file.name)}-watermark.${extOf(mime)}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    status("watermark", `已生成，${fmtSize(blob.size)}。`);
  } catch (error) {
    status("watermark", error.message);
  }
});

/* ---------- 后台维护的清单 ---------- */

async function loadCatalog() {
  try {
    const res = await fetch("/tools/data", { headers: { accept: "application/json" } });
    if (!res.ok) return;
    const data = await res.json();
    renderLinks(data.links || []);
    renderSoftware(data.software || []);
  } catch {
    /* 离线时保持占位 */
  }
}

function renderLinks(links) {
  const list = $("[data-links]");
  if (!list) return;
  if (!links.length) return;
  list.innerHTML = links
    .map(
      (link) => `<li class="link-row">
        <a class="link-row__name" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.name)}</a>
        <span class="link-row__meta">${escapeHtml(link.note || link.category || "")}</span>
        <span class="link-row__go" aria-hidden="true">↗</span>
      </li>`,
    )
    .join("");
}

function renderSoftware(items) {
  const grid = $("[data-software]");
  if (!grid) return;
  if (!items.length) return;
  grid.innerHTML = items
    .map((item) => {
      const groups = new Map();
      (item.links || []).forEach((link) => {
        const key = link.platform || "其他";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(link);
      });
      const links = groups.size
        ? Array.from(groups.entries())
            .map(
              ([platform, list]) => `<div class="soft__platform">
            <span class="soft__platform-name">${escapeHtml(platform)}</span>
            <span class="soft__platform-links">${list
              .map(
                (link) =>
                  `<a class="soft__link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                    link.label || "下载",
                  )}</a>`,
              )
              .join("")}</span>
          </div>`,
            )
            .join("")
        : '<span class="soft__empty">暂无下载线路</span>';
      const devices = String(item.devices || "")
        .split(/[,，、·]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      return `<article class="soft">
        <header class="soft__head">
          ${item.icon ? `<img class="soft__icon" src="${escapeHtml(item.icon)}" alt="" loading="lazy" />` : ""}
          <h3 class="soft__name">${escapeHtml(item.name)}</h3>
          ${item.category ? `<span class="soft__tag">${escapeHtml(item.category)}</span>` : ""}
        </header>
        <dl class="soft__meta">
          ${
            devices.length
              ? `<div><dt>适配</dt><dd class="soft__devices">${devices
                  .map((entry) => `<span>${escapeHtml(entry)}</span>`)
                  .join("")}</dd></div>`
              : ""
          }
          ${item.size ? `<div><dt>大小</dt><dd>${escapeHtml(item.size)}</dd></div>` : ""}
        </dl>
        ${item.note ? `<p class="soft__note">${escapeHtml(item.note)}</p>` : ""}
        <div class="soft__links">${links}</div>
      </article>`;
    })
    .join("");
}

loadCatalog();

// 拖动文件到上传区
$$(".tool__drop").forEach((drop) => {
  const input = $("input[type=file]", drop);
  if (!input) return;
  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    }),
  );
  ["dragleave", "drop"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove("is-over");
    }),
  );
  drop.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
});

/* ---------- 视图切换：首页磁贴 / 单个工具 ---------- */

/* ---------- 常用尺寸 / 常用目标 ---------- */

$$("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const [width, height] = String(button.dataset.preset || "").split("x").map(Number);
    if (!width || !height) return;
    const mode = $('[data-opt="resize.mode"]');
    if (mode) {
      mode.value = "pixel";
      mode.dispatchEvent(new Event("change"));
    }
    const fieldW = $('[data-opt="resize.width"]');
    const fieldH = $('[data-opt="resize.height"]');
    if (fieldW) fieldW.value = String(width);
    if (fieldH) fieldH.value = String(height);
    $$("[data-preset]").forEach((node) => node.classList.toggle("is-on", node === button));
    status("resize", `已选 ${width}×${height}，选好图片后点「调整尺寸」。`);
  });
});

/* ---------- 整页拖放：拖到工具视图任意位置都能接收 ---------- */

const activeTool = () => {
  const view = $("[data-view]:not([hidden])");
  return view ? view.dataset.view : "";
};

["dragenter", "dragover"].forEach((type) =>
  document.addEventListener(type, (event) => {
    const tool = activeTool();
    if (!tool || !inputs[tool]) return;
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    inputs[tool].closest(".tool__drop")?.classList.add("is-over");
  }),
);

["dragleave", "drop"].forEach((type) =>
  document.addEventListener(type, (event) => {
    const tool = activeTool();
    if (!tool || !inputs[tool]) return;
    if (type === "dragleave" && event.relatedTarget) return;
    inputs[tool].closest(".tool__drop")?.classList.remove("is-over");
  }),
);

document.addEventListener("drop", (event) => {
  const tool = activeTool();
  const input = inputs[tool];
  if (!input) return;
  if (event.target.closest?.(".tool__drop")) return;
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  const transfer = new DataTransfer();
  (input.multiple ? files : files.slice(0, 1)).forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
  status(tool, `已接收 ${transfer.files.length} 个文件。`);
});

const views = $$("[data-view]");
const homeView = $("[data-tools-home]");

function route() {
  const id = (location.hash || "").replace(/^#\/?/, "").trim();
  const target = views.find((view) => view.dataset.view === id) || null;
  if (homeView) homeView.hidden = Boolean(target);
  views.forEach((view) => {
    view.hidden = view !== target;
  });
  document.body.classList.toggle("is-tool", Boolean(target));
  if (target) window.scrollTo({ top: 0 });
}

window.addEventListener("hashchange", route);
route();
