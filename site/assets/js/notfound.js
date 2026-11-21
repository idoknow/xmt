/* 404 亮色页：几块可以拖、可以甩的纸片（无依赖，按需 rAF） */

(() => {
  const stage = document.querySelector("[data-shapes]");
  if (!stage) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const items = Array.from(stage.querySelectorAll("[data-shape]")).map((el) => {
    const rect = el.getBoundingClientRect();
    return { el, x: 0, y: 0, vx: 0, vy: 0, w: rect.width, h: rect.height, drag: false };
  });
  if (!items.length) return;

  let bounds = { w: 0, h: 0 };
  let frame = 0;

  function place(item) {
    const startX = parseFloat(item.el.style.getPropertyValue("--x")) || 0;
    const startY = parseFloat(item.el.style.getPropertyValue("--y")) || 0;
    item.x = (startX / 100) * Math.max(0, bounds.w - item.w);
    item.y = (startY / 100) * Math.max(0, bounds.h - item.h);
  }

  function measure() {
    const rect = stage.getBoundingClientRect();
    bounds = { w: rect.width, h: rect.height };
    for (const item of items) item.w = item.el.getBoundingClientRect().width;
    if (!frame) items.forEach(place);
  }

  function draw() {
    for (const item of items) {
      item.el.style.transform = `translate3d(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px, 0)`;
    }
  }

  function tick() {
    frame = 0;
    let moving = false;
    for (const item of items) {
      if (item.drag) {
        moving = true;
        continue;
      }
      if (Math.abs(item.vx) < 0.05 && Math.abs(item.vy) < 0.05) {
        item.vx = 0;
        item.vy = 0;
        continue;
      }
      item.x += item.vx;
      item.y += item.vy;
      item.vx *= 0.986;
      item.vy *= 0.986;

      const maxX = bounds.w - item.w;
      const maxY = bounds.h - item.h;
      if (item.x <= 0) {
        item.x = 0;
        item.vx = Math.abs(item.vx) * 0.72;
      } else if (item.x >= maxX) {
        item.x = maxX;
        item.vx = -Math.abs(item.vx) * 0.72;
      }
      if (item.y <= 0) {
        item.y = 0;
        item.vy = Math.abs(item.vy) * 0.72;
      } else if (item.y >= maxY) {
        item.y = maxY;
        item.vy = -Math.abs(item.vy) * 0.72;
      }
      moving = true;
    }
    draw();
    if (moving) frame = requestAnimationFrame(tick);
  }

  const kick = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  measure();
  items.forEach(place);
  draw();
  window.addEventListener("resize", () => {
    measure();
    items.forEach(place);
    draw();
  });

  if (reduce.matches) return;

  for (const item of items) {
    let start = null;
    let last = null;
    let moved = 0;

    item.el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      item.drag = true;
      item.vx = 0;
      item.vy = 0;
      start = { x: event.clientX, y: event.clientY, ox: item.x, oy: item.y };
      last = { x: event.clientX, y: event.clientY, t: performance.now() };
      moved = 0;
      item.el.setPointerCapture?.(event.pointerId);
      kick();
    });

    item.el.addEventListener("pointermove", (event) => {
      if (!item.drag || !start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
      item.x = Math.min(Math.max(0, start.ox + dx), bounds.w - item.w);
      item.y = Math.min(Math.max(0, start.oy + dy), bounds.h - item.h);
      const now = performance.now();
      const dt = Math.max(16, now - last.t);
      item.vx = ((event.clientX - last.x) / dt) * 16;
      item.vy = ((event.clientY - last.y) / dt) * 16;
      last = { x: event.clientX, y: event.clientY, t: now };
      draw();
      kick();
    });

    const release = () => {
      if (!item.drag) return;
      item.drag = false;
      start = null;
      item.vx = Math.max(-26, Math.min(26, item.vx));
      item.vy = Math.max(-26, Math.min(26, item.vy));
      kick();
    };

    item.el.addEventListener("pointerup", release);
    item.el.addEventListener("pointercancel", release);
    item.el.addEventListener("lostpointercapture", release);
    item.el.addEventListener("click", (event) => {
      if (moved > 6) event.preventDefault();
    });
  }
})();
