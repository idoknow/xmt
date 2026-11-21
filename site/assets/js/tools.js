// 在线工具：全部在浏览器本地处理，不上传任何文件。
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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

function show(container, items) {
  const list = $(`[data-out="${container}"]`);
  if (!list) return;
  for (const url of results[container]) URL.revokeObjectURL(url);
  results[container] = [];
  list.innerHTML = items.length ? "" : '<li class="results__empty">还没有结果。</li>';
  for (const item of items) {
    const url = URL.createObjectURL(item.blob);
    results[container].push(url);
    const li = document.createElement("li");
    li.className = "results__item";
    li.innerHTML = `
      <span class="results__name">${item.name}</span>
      <span class="results__meta">${item.detail || ""} · ${fmtSize(item.blob.size)}</span>
      <a class="results__save" href="${url}" download="${item.name}">下载</a>`;
    list.append(li);
  }
}

const status = (tool, text) => {
  const node = $(`[data-status="${tool}"]`);
  if (node) node.textContent = text || "";
};

const picked = (tool, files) => {
  const node = $(`[data-picked="${tool}"]`);
  if (!node) return;
  if (!files?.length) node.textContent = "还没有选择文件";
  else if (files.length === 1) node.textContent = `${files[0].name} · ${fmtSize(files[0].size)}`;
  else node.textContent = `已选 ${files.length} 个文件`;
};

/* ---------- 文件选择 ---------- */

const inputs = {};
$$("[data-file]").forEach((input) => {
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
  status("convert", "转换中…");
  const items = [];
  for (const file of files) {
    try {
      const decoded = await decode(file);
      const canvas = paint(decoded, decoded.width, decoded.height, mime === "image/jpeg" ? "#ffffff" : null);
      const blob = await encode(canvas, mime, quality);
      items.push({
        blob,
        name: `${baseName(file.name)}.${extOf(mime)}`,
        detail: `${decoded.width}×${decoded.height}`,
      });
    } catch (error) {
      items.push({ blob: new Blob([String(error.message)]), name: `${baseName(file.name)}.txt`, detail: "失败" });
    }
  }
  show("convert", items);
  status("convert", `完成 ${items.length} 个。`);
});

/* ---------- 02 压缩 ---------- */

const compressLabels = {
  size: { label: "目标大小", unit: "KB" },
  edge: { label: "最长边", unit: "px" },
  percent: { label: "保留比例", unit: "%" },
};

$('[data-opt="compress.mode"]')?.addEventListener("change", (event) => {
  const spec = compressLabels[event.target.value] || compressLabels.size;
  const label = $('[data-label-for="compress"]');
  const unit = $('[data-unit="compress"]');
  const value = $('[data-opt="compress.value"]');
  if (label) label.textContent = spec.label;
  if (unit) unit.textContent = spec.unit;
  if (value) {
    value.value = event.target.value === "size" ? "300" : event.target.value === "edge" ? "1920" : "60";
  }
});

$('[data-run="compress"]')?.addEventListener("click", async () => {
  const file = inputs.compress?.files?.[0];
  if (!file) return status("compress", "先选一张图。");
  const mode = $('[data-opt="compress.mode"]').value;
  const value = Number($('[data-opt="compress.value"]').value) || 0;
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
      const target = value * 1024;
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

    const saved = Math.max(0, 1 - blob.size / file.size);
    show("compress", [
      {
        blob,
        name: `${baseName(file.name)}-compressed.${extOf(mime)}`,
        detail: `${width}×${height} · 减少 ${(saved * 100).toFixed(0)}%`,
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
      { blob, name: `${baseName(file.name)}-${width}x${height}.${extOf(mime)}`, detail: `${decoded.width}×${decoded.height} → ${width}×${height}` },
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

function syncCropBox() {
  const img = $('[data-preview="crop"]');
  const box = $("[data-cropbox]");
  if (!img || !box || !img.src) return;
  const naturalW = Number(img.dataset.w) || img.naturalWidth;
  const naturalH = Number(img.dataset.h) || img.naturalHeight;
  const rect = img.getBoundingClientRect();
  if (!naturalW || !rect.width) return;
  const k = rect.width / naturalW;
  const { x, y, w, h } = cropValues();
  box.style.left = `${x * k}px`;
  box.style.top = `${y * k}px`;
  box.style.width = `${w * k}px`;
  box.style.height = `${h * k}px`;
  box.hidden = false;
}

$$('[data-opt^="crop."]').forEach((input) => input.addEventListener("input", syncCropBox));
window.addEventListener("resize", syncCropBox);

$("[data-cropbox]")?.addEventListener("pointerdown", (event) => {
  const img = $('[data-preview="crop"]');
  if (!img?.src) return;
  const rect = img.getBoundingClientRect();
  const k = rect.width / (Number(img.dataset.w) || img.naturalWidth || 1);
  cropDrag = { startX: event.clientX, startY: event.clientY, x: cropValues().x, y: cropValues().y, k };
  event.currentTarget.setPointerCapture(event.pointerId);
});
$("[data-cropbox]")?.addEventListener("pointermove", (event) => {
  if (!cropDrag) return;
  const img = $('[data-preview="crop"]');
  const maxW = Number(img.dataset.w) || 0;
  const maxH = Number(img.dataset.h) || 0;
  const { w, h } = cropValues();
  const dx = (event.clientX - cropDrag.startX) / cropDrag.k;
  const dy = (event.clientY - cropDrag.startY) / cropDrag.k;
  const x = Math.max(0, Math.min(maxW - w, cropDrag.x + dx));
  const y = Math.max(0, Math.min(maxH - h, cropDrag.y + dy));
  $('[data-opt="crop.x"]').value = String(Math.round(x));
  $('[data-opt="crop.y"]').value = String(Math.round(y));
  syncCropBox();
});
$("[data-cropbox]")?.addEventListener("pointerup", () => {
  cropDrag = null;
});

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

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
      const links = (item.links || [])
        .map(
          (link) =>
            `<a class="soft__link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || "下载")}</a>`,
        )
        .join("");
      return `<article class="soft">
        <header class="soft__head">
          <h3 class="soft__name">${escapeHtml(item.name)}</h3>
          ${item.category ? `<span class="soft__tag">${escapeHtml(item.category)}</span>` : ""}
        </header>
        <dl class="soft__meta">
          ${item.devices ? `<div><dt>适配</dt><dd>${escapeHtml(item.devices)}</dd></div>` : ""}
          ${item.size ? `<div><dt>大小</dt><dd>${escapeHtml(item.size)}</dd></div>` : ""}
        </dl>
        ${item.note ? `<p class="soft__note">${escapeHtml(item.note)}</p>` : ""}
        <div class="soft__links">${links || '<span class="soft__empty">暂无下载线路</span>'}</div>
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
