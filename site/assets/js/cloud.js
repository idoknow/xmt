/* 云上桂中 · 3D 云游
 * 不引入 three.js：用 CSS 3D 把八个建筑块拼成一个轴测校园。
 * 数据都是示意，等测量队给了实测再换坐标。
 */

(() => {
  const campus = document.querySelector("[data-campus]");
  if (!campus) return;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = campus.querySelector("[data-frame]");
  const stage = campus.querySelector("[data-stage]");
  const plot = campus.querySelector("[data-plot]");
  const spec = campus.querySelector("[data-spec]");

  const GROUND = { w: 880, d: 660 };
  const state = {
    rx: 56,
    rz: -34,
    zoom: 1,
    spin: !reduce,
    drag: null,
    active: null,
  };

  /* ---------- 建筑数据（x/y 为地面坐标，原点在平面中心；z 向上） ---------- */

  const BUILDINGS = [
    {
      id: "gate",
      name: "校门与围墙",
      tag: "入口",
      kind: "构筑物",
      floor: "1 层 · 含门房",
      status: "已建模",
      progress: 92,
      note: "门楼、值班室和一段旧围墙，是新生第一次进校的取景位。",
      x: -250, y: 236, w: 260, d: 26, h: 54,
    },
    {
      id: "track",
      name: "操场与跑道",
      tag: "运动",
      kind: "场地",
      floor: "400 米环道",
      status: "已建模",
      progress: 22,
      note: "标准跑道加中间的足球场，跑道面层还在做贴图。",
      x: 178, y: 150, w: 460, d: 250, h: 8,
    },
    {
      id: "main",
      name: "主教学楼",
      tag: "教学",
      kind: "教学楼",
      floor: "5 层 · 40 间",
      status: "建模中",
      progress: 78,
      note: "走廊朝南，五个年级的日常都在这栋楼里。",
      x: -258, y: -18, w: 200, d: 84, h: 128,
    },
    {
      id: "lab",
      name: "实验楼",
      tag: "教学",
      kind: "实验楼",
      floor: "4 层",
      status: "测绘中",
      progress: 65,
      note: "物理、化学、生物各两层，顶层是天象观测的小平台。",
      x: -40, y: -156, w: 168, d: 72, h: 104,
    },
    {
      id: "library",
      name: "图书馆",
      tag: "公共",
      kind: "图书馆",
      floor: "3 层 · 阅览室",
      status: "建模中",
      progress: 54,
      note: "自习的人最多，靠窗那排光最好，模型里也留了窗。",
      x: 178, y: -150, w: 150, d: 70, h: 92,
    },
    {
      id: "canteen",
      name: "食堂",
      tag: "生活",
      kind: "食堂",
      floor: "2 层",
      status: "排队中",
      progress: 48,
      note: "中午十二点最挤，屋顶的排风是最难做细节的部分。",
      x: 348, y: -18, w: 130, d: 74, h: 76,
    },
    {
      id: "dorm",
      name: "宿舍楼",
      tag: "生活",
      kind: "宿舍",
      floor: "6 层 · 两单元",
      status: "测绘中",
      progress: 30,
      note: "南向阳台，模型里按间数留出了可点开的窗。",
      x: 350, y: 128, w: 118, d: 96, h: 150,
    },
    {
      id: "hall",
      name: "礼堂",
      tag: "公共",
      kind: "礼堂",
      floor: "1 层 · 挑高",
      status: "未开始",
      progress: 18,
      note: "开学典礼和文艺汇演在这里，有大台阶和门廊。",
      x: -70, y: 40, w: 150, d: 110, h: 66,
    },
  ];

  /* ---------- 基础块 ---------- */

  const div = (className) => {
    const node = document.createElement("div");
    node.className = className;
    return node;
  };

  const face = (w, h, transform, variant) => {
    const node = div(`face face--${variant}`);
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    node.style.marginLeft = `${-w / 2}px`;
    node.style.marginTop = `${-h / 2}px`;
    node.style.transform = transform;
    return node;
  };

  /* 地面 */
  const ground = div("campus__ground");
  Object.assign(ground.style, {
    width: `${GROUND.w}px`,
    height: `${GROUND.d}px`,
    marginLeft: `${-GROUND.w / 2}px`,
    marginTop: `${-GROUND.d / 2}px`,
  });

  /* 两条主路：校门 → 主楼，校门 → 操场 */
  const pathStyle = (x, y, w, d, rotate) => {
    const path = div("campus__path");
    Object.assign(path.style, {
      width: `${w}px`,
      height: `${d}px`,
      marginLeft: `${-w / 2}px`,
      marginTop: `${-d / 2}px`,
      transform: `translate3d(${x}px, ${y}px, 2px) rotateZ(${rotate}deg)`,
    });
    return path;
  };
  ground.append(pathStyle(0, 150, 26, 300, 0), pathStyle(-120, 60, 26, 380, 18));

  /* 树：沿路边撒几棵，别太整齐 */
  const TREES = [
    [-330, 190], [-300, 210], [-208, 120], [-150, 60], [-96, 118],
    [40, 118], [96, 92], [150, 108], [250, 96], [300, 60],
    [-320, -60], [-300, -110], [70, -40], [110, 20], [250, 40],
    [-190, 250], [-140, 262], [210, 268], [266, 258], [-12, 250],
  ];
  for (const [x, y] of TREES) {
    const tree = div("campus__tree");
    Object.assign(tree.style, {
      transform: `translate3d(${x}px, ${y}px, 14px) rotateX(90deg)`,
    });
    ground.append(tree);
  }

  plot.append(ground);

  /* ---------- 建筑 ---------- */

  const nodes = new Map();

  for (const b of BUILDINGS) {
    const house = div("bld");
    house.style.setProperty("--bx", `${b.x}px`);
    house.style.setProperty("--by", `${b.y}px`);
    house.dataset.id = b.id;
    house.tabIndex = 0;
    house.setAttribute("role", "button");
    house.setAttribute("aria-label", `${b.name}，${b.status}`);

    house.append(
      face(b.w, b.d, `translate3d(0, 0, ${b.h}px)`, "roof"),
      face(b.w, b.h, `translate3d(0, ${b.d / 2}px, ${b.h / 2}px) rotateX(-90deg)`, "s"),
      face(b.w, b.h, `translate3d(0, ${-b.d / 2}px, ${b.h / 2}px) rotateX(90deg)`, "n"),
      face(b.d, b.h, `translate3d(${b.w / 2}px, 0, ${b.h / 2}px) rotateY(90deg)`, "e"),
      face(b.d, b.h, `translate3d(${-b.w / 2}px, 0, ${b.h / 2}px) rotateY(-90deg)`, "w"),
    );

    const label = div("bld__label");
    label.textContent = b.name;
    house.append(label);

    plot.append(house);
    nodes.set(b.id, { house, label, data: b });
  }

  /* ---------- 视角 ---------- */

  const render = () => {
    const { rx, rz } = state;
    const rad = Math.PI / 180;

    /* 按当前角度算投影尺寸，把整个平面塞进画框 */
    const cz = Math.abs(Math.cos(rz * rad));
    const sz = Math.abs(Math.sin(rz * rad));
    const projW = GROUND.w * cz + GROUND.d * sz;
    const flatH = GROUND.w * sz + GROUND.d * cz;
    const projH = flatH * Math.cos(rx * rad) + 150 * Math.sin(rx * rad);

    const w = frame.clientWidth || 640;
    const h = frame.clientHeight || 480;
    const fit = Math.min((w * 0.94) / projW, (h * 0.92) / projH);
    const zoom = state.zoom * fit;

    stage.style.setProperty("--rx", `${rx}`);
    stage.style.setProperty("--rz", `${rz}`);
    stage.style.setProperty("--zoom", zoom.toFixed(4));

    for (const { label } of nodes.values()) {
      label.style.transform =
        `translate3d(0, 0, ${label.dataset.z}px) rotateZ(${-rz}deg) rotateX(${-rx}deg) scale(${(1 / zoom).toFixed(3)}) translate(-50%, -50%)`;
    }
  };

  /* 标签挂在楼顶，位置由 render 统一摆正 */
  for (const { label, data } of nodes.values()) {
    label.dataset.z = `${data.h + 12}`;
  }

  let raf = 0;
  let last = 0;
  const spin = (time) => {
    if (!state.spin || state.drag) {
      raf = 0;
      return;
    }
    if (last) state.rz += (time - last) * 0.004;
    last = time;
    render();
    raf = requestAnimationFrame(spin);
  };

  const startSpin = () => {
    if (raf || !state.spin || reduce) return;
    last = 0;
    raf = requestAnimationFrame(spin);
  };
  const stopSpin = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };

  /* ---------- 选中与说明卡 ---------- */

  const select = (id) => {
    const entry = nodes.get(id);
    if (!entry) return;
    state.active = id;

    for (const [key, node] of nodes) {
      const on = key === id;
      node.house.classList.toggle("is-active", on);
      node.house.setAttribute("aria-pressed", String(on));
    }

    const b = entry.data;
    const set = (key, value) => {
      const node = spec.querySelector(`[data-spec-${key}]`);
      if (node) node.textContent = value;
    };
    set("name", b.name);
    set("tag", b.tag);
    set("kind", b.kind);
    set("floor", b.floor);
    set("status", b.status);
    set("note", b.note);

    const bar = spec.querySelector("[data-spec-bar]");
    if (bar) bar.style.setProperty("--p", `${b.progress}%`);
    set("progress", `${b.progress}%`);

    for (const button of document.querySelectorAll("[data-goto]")) {
      button.classList.toggle("is-active", button.dataset.goto === id);
    }
  };

  for (const { house, data } of nodes.values()) {
    house.addEventListener("click", () => select(data.id));
    house.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(data.id);
      }
    });
  }

  for (const button of document.querySelectorAll("[data-goto]")) {
    button.addEventListener("click", () => {
      select(button.dataset.goto);
      frame.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
  }

  /* ---------- 拖动旋转 ---------- */

  frame.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    state.drag = { x: event.clientX, y: event.clientY, rz: state.rz, rx: state.rx };
    frame.setPointerCapture(event.pointerId);
    frame.classList.add("is-dragging");
    stopSpin();
  });

  frame.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    const dx = event.clientX - state.drag.x;
    const dy = event.clientY - state.drag.y;
    state.rz = state.drag.rz + dx * 0.32;
    state.rx = Math.min(82, Math.max(24, state.drag.rx + dy * 0.18));
    render();
  });

  const endDrag = (event) => {
    if (!state.drag) return;
    state.drag = null;
    frame.classList.remove("is-dragging");
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
    if (state.spin) startSpin();
  };
  frame.addEventListener("pointerup", endDrag);
  frame.addEventListener("pointercancel", endDrag);

  frame.addEventListener("pointerenter", () => {
    if (!state.drag) stopSpin();
  });
  frame.addEventListener("pointerleave", () => {
    if (!state.drag && state.spin) startSpin();
  });

  /* ---------- 控件 ---------- */

  const zoomTo = (value) => {
    state.zoom = Math.min(1.9, Math.max(0.72, value));
    render();
  };

  campus.querySelector("[data-zoom='in']")?.addEventListener("click", () => zoomTo(state.zoom + 0.12));
  campus.querySelector("[data-zoom='out']")?.addEventListener("click", () => zoomTo(state.zoom - 0.12));

  campus.querySelector("[data-view]")?.addEventListener("click", (event) => {
    const top = state.rx > 70;
    state.rx = top ? 56 : 82;
    state.rz = top ? -34 : 0;
    render();
    event.currentTarget.setAttribute("aria-pressed", String(!top));
  });

  campus.querySelector("[data-spin]")?.addEventListener("click", (event) => {
    state.spin = !state.spin;
    event.currentTarget.setAttribute("aria-pressed", String(state.spin));
    if (state.spin) startSpin();
    else stopSpin();
  });

  campus.querySelector("[data-reset]")?.addEventListener("click", () => {
    state.rx = 56;
    state.rz = -34;
    state.zoom = 1;
    render();
  });

  /* ---------- 启动 ---------- */

  addEventListener("resize", render);
  render();
  select("main");
  if (state.spin) startSpin();
})();
