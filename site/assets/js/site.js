// 桂林中学新媒体 —— 交互脚本（无依赖）
// 滚动进入、复制提取码、年份、配色、多语言。

(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsViewTimeline = CSS.supports("animation-timeline: view()");
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---------- 0) 图标 ---------- */

  const SVG = (body) =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

  const ICONS = {
    system: SVG(
      '<circle cx="8" cy="8" r="6.1" /><path d="M8 1.9a6.1 6.1 0 0 1 0 12.2Z" fill="currentColor" stroke="none" />',
    ),
    light: SVG(
      '<circle cx="8" cy="8" r="3.05" /><path d="M8 1.3v1.8M8 12.9v1.8M1.3 8h1.8M12.9 8h1.8M3.4 3.4l1.25 1.25M11.35 11.35l1.25 1.25M12.6 3.4l-1.25 1.25M4.65 11.35 3.4 12.6" />',
    ),
    dark: SVG(
      '<path d="M9.85 1.75a6.2 6.2 0 1 0 4.4 9.9A5.15 5.15 0 0 1 9.85 1.75Z" fill="currentColor" stroke="none" />',
    ),
    lang: SVG(
      '<circle cx="8" cy="8" r="6.1" /><path d="M1.9 8h12.2" /><path d="M8 1.9c1.85 1.95 2.85 3.9 2.85 6.1S9.85 12.05 8 14.1C6.15 12.05 5.15 10.1 5.15 8S6.15 3.85 8 1.9Z" />',
    ),
  };

  /* ---------- 1) 滚动进入 ---------- */
  // 章节、列表行、时间线条目也参与进入动画；没有脚本时它们照常显示。

  for (const [selector, step] of [
    [".section", 0],
    [".link-row", 55],
    [".timeline__item", 65],
    [".entry", 70],
  ]) {
    document.querySelectorAll(selector).forEach((el, index) => {
      if (el.classList.contains("reveal")) return;
      el.classList.add("reveal");
      if (step) el.style.setProperty("--d", `${index * step}ms`);
    });
  }

  const items = document.querySelectorAll(".reveal");
  if (items.length && !reduce && !supportsViewTimeline) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- 2) 语言 ---------- */

  const LOCALES = [
    { code: "zh-Hans", name: "简体中文", dir: "ltr" },
    { code: "zh-Hant", name: "繁體中文", dir: "ltr" },
    { code: "en", name: "English", dir: "ltr" },
    { code: "ja", name: "日本語", dir: "ltr" },
    { code: "ko", name: "한국어", dir: "ltr" },
    { code: "ru", name: "Русский", dir: "ltr" },
    { code: "fr", name: "Français", dir: "ltr" },
    { code: "de", name: "Deutsch", dir: "ltr" },
    { code: "es", name: "Español", dir: "ltr" },
    { code: "ar", name: "العربية", dir: "rtl" },
    { code: "hi", name: "हिन्दी", dir: "ltr" },
    { code: "bo", name: "བོད་ཡིག", dir: "ltr" },
    { code: "mn", name: "Монгол", dir: "ltr" },
    { code: "ug", name: "ئۇيغۇرچە", dir: "rtl" },
    { code: "za", name: "Vahcuengh", dir: "ltr" },
  ];

  const cache = new Map();
  let dict = null; // 当前语言映射
  let base = null; // 英文兜底映射
  const touched = []; // 被替换过的文本节点，切回中文时还原

  const params = new URLSearchParams(location.search);
  let current = "zh-Hans";

  const detect = () => {
    const fromUrl = params.get("lang");
    if (fromUrl && LOCALES.some((item) => item.code === fromUrl)) return fromUrl;
    const stored = localStorage.getItem("xmt-lang");
    if (stored && LOCALES.some((item) => item.code === stored)) return stored;
    const nav = (navigator.language || "zh-CN").toLowerCase();
    if (nav.startsWith("zh")) return nav.includes("hant") || /-(tw|hk|mo)$/.test(nav) ? "zh-Hant" : "zh-Hans";
    if (nav.startsWith("ja")) return "ja";
    if (nav.startsWith("ko")) return "ko";
    if (nav.startsWith("ru")) return "ru";
    if (nav.startsWith("fr")) return "fr";
    if (nav.startsWith("de")) return "de";
    if (nav.startsWith("es")) return "es";
    if (nav.startsWith("ar")) return "ar";
    if (nav.startsWith("hi")) return "hi";
    if (nav.startsWith("bo")) return "bo";
    if (nav.startsWith("mn")) return "mn";
    if (nav.startsWith("ug")) return "ug";
    if (nav.startsWith("za")) return "za";
    return "en";
  };
  current = detect();

  const t = (text) => (dict && dict[text]) || (base && base[text]) || text;

  const load = async (code) => {
    if (cache.has(code)) return cache.get(code);
    try {
      const response = await fetch(`/assets/i18n/${code}.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(String(response.status));
      const json = await response.json();
      cache.set(code, json);
      return json;
    } catch {
      cache.set(code, null);
      return null;
    }
  };

  const restore = () => {
    for (const item of touched) item.node.nodeValue = item.original;
    touched.length = 0;
  };

  const translateNode = (node, map) => {
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) return;
    const key = raw.replace(/\s+/g, " ").trim();
    const value = map[key];
    if (!value || value === key) return;
    const lead = /^\s*/.exec(raw)[0];
    touched.push({ node, original: raw });
    node.nodeValue = lead + value;
  };

  const ATTRS = ["aria-label", "alt", "title", "placeholder", "data-label"];

  const apply = (map) => {
    if (!map) return;
    restore();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/.test(node.parentNode.nodeName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const batch = [];
    let node;
    while ((node = walker.nextNode())) batch.push(node);
    for (const item of batch) translateNode(item, map);

    for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder],[data-label]")) {
      for (const attr of ATTRS) {
        const raw = el.getAttribute(attr);
        if (!raw) continue;
        const value = map[raw.trim()];
        if (!value) continue;
        el.setAttribute(attr, value);
      }
    }
  };

  const notice = (text) => {
    const host = document.querySelector(".page-head .wrap") || document.querySelector(".hero .wrap");
    if (!host) return;
    let box = host.querySelector(".notice");
    if (!text) {
      if (box) box.hidden = true;
      return;
    }
    if (!box) {
      box = document.createElement("p");
      box.className = "notice";
      host.append(box);
    }
    box.hidden = false;
    box.textContent = text;
  };

  const setLanguage = async (code, silent) => {
    const locale = LOCALES.find((item) => item.code === code) || LOCALES[0];
    current = locale.code;
    localStorage.setItem("xmt-lang", locale.code);
    document.documentElement.lang = locale.code === "zh-Hans" ? "zh-CN" : locale.code;
    document.documentElement.dir = locale.dir;

    if (locale.code === "zh-Hans") {
      dict = null;
      restore();
      notice("");
    } else {
      const [own, fallback] = await Promise.all([
        load(locale.code),
        locale.code === "en" ? Promise.resolve(null) : load("en"),
      ]);
      dict = own ? own.map : null;
      base = fallback ? fallback.map : null;
      apply(dict || base);
      notice(own && own.notice ? own.notice : "");
    }

    updateLangLabel(locale);
    updateThemeLabel();
    if (!silent) document.dispatchEvent(new CustomEvent("xmt:lang", { detail: locale.code }));
  };

  const updateLangLabel = (locale) => {
    const label = document.querySelector("[data-lang-label]");
    if (label) label.textContent = locale.name;
    for (const item of document.querySelectorAll("[data-lang-menu] [data-code]")) {
      item.setAttribute("aria-checked", String(item.dataset.code === locale.code));
    }
  };

  /* ---------- 2b) 下拉菜单定位 ---------- */
  // 菜单默认贴着按钮右侧展开；靠边时夹进视口，避免在窄屏或 RTL 下被切掉。

  const placeMenu = (details) => {
    const menu = details?.querySelector(".tools__menu");
    if (!details || !menu || !details.open) return;
    menu.style.left = "";
    menu.style.right = "";
    const edge = 10;
    const box = menu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let shift = 0;
    if (box.left < edge) shift = edge - box.left;
    else if (box.right > vw - edge) shift = vw - edge - box.right;
    if (shift) {
      const current = parseFloat(getComputedStyle(menu).left) || 0;
      menu.style.left = `${current + shift}px`;
      menu.style.right = "auto";
    }
  };

  const closeMenus = (keep) => {
    for (const details of document.querySelectorAll("details.tools__drop[open]")) {
      if (details !== keep) details.open = false;
    }
  };

  document.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    closeMenus(details);
    placeMenu(details);
  }, true);

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".tools__drop")) closeMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });

  window.addEventListener("resize", () => {
    for (const details of document.querySelectorAll("details.tools__drop[open]")) placeMenu(details);
  });

  /* ---------- 3) 配色 ---------- */

  const THEMES = ["system", "light", "dark"];
  const THEME_LABEL = { system: "跟随系统", light: "浅色", dark: "深色" };
  let theme = (params.get("theme") && THEMES.includes(params.get("theme"))) ? params.get("theme") : localStorage.getItem("xmt-theme") || "system";

  const applyTheme = () => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);

    const meta = document.querySelector('meta[name="theme-color"]');
    const dark =
      theme === "dark" ||
      (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (meta) meta.setAttribute("content", dark ? "#14131b" : "#f6f3ec");
    updateThemeLabel();
  };

  function updateThemeLabel() {
    const label = document.querySelector("[data-theme-label]");
    const swatch = document.querySelector("[data-theme-swatch]");
    if (label) label.textContent = t(THEME_LABEL[theme]);
    if (swatch) swatch.dataset.swatch = theme;
    for (const item of document.querySelectorAll("[data-theme-menu] [data-value]")) {
      item.setAttribute("aria-checked", String(item.dataset.value === theme));
      const text = item.querySelector("[data-item-text]");
      if (text) text.textContent = t(THEME_LABEL[item.dataset.value]);
    }
  }

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (theme === "system") applyTheme();
  });

  /* ---------- 4) 工具条（配色 + 语言） ---------- */

  const mountTools = () => {
    const inner = document.querySelector(".masthead__inner");
    if (!inner) return;
    let tools = inner.querySelector(".tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "tools";
      inner.append(tools);
    }

    if (!tools.querySelector("[data-theme-menu]")) {
      const themeBox = document.createElement("details");
      themeBox.className = "tools__drop";
      themeBox.setAttribute("data-theme-box", "");
      themeBox.innerHTML =
        '<summary class="tools__btn" aria-label="切换配色">' +
        `<span class="tools__icon" aria-hidden="true"><i class="tools__swatch" data-theme-swatch data-swatch="${theme}"></i></span>` +
        '<span class="tools__label" data-theme-label>跟随系统</span>' +
        "</summary>" +
        '<div class="tools__menu" role="menu" data-theme-menu></div>';
      tools.prepend(themeBox);

      const themeMenu = themeBox.querySelector("[data-theme-menu]");
      for (const value of THEMES) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "tools__item";
        item.dataset.value = value;
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", "false");
        item.innerHTML =
          `<span class="tools__item-main"><i class="tools__ic tools__swatch" data-swatch="${value}" aria-hidden="true"></i>` +
          `<span data-item-text>${THEME_LABEL[value]}</span></span>`;
        item.addEventListener("click", () => {
          theme = value;
          localStorage.setItem("xmt-theme", value);
          applyTheme();
          themeBox.open = false;
        });
        themeMenu.append(item);
      }
    }

    if (!tools.querySelector("[data-lang-menu]")) {
      const lang = document.createElement("details");
      lang.className = "tools__drop";
      lang.setAttribute("data-lang", "");
      lang.innerHTML =
        '<summary class="tools__btn" aria-label="切换语言">' +
        `<span class="tools__icon" aria-hidden="true">${ICONS.lang}</span>` +
        '<span class="tools__label" data-lang-label>简体中文</span>' +
        "</summary>" +
        '<div class="tools__menu tools__menu--wide" role="menu" data-lang-menu></div>';
      tools.append(lang);
    }

    const menu = tools.querySelector("[data-lang-menu]");
    if (menu && !menu.childElementCount) {
      for (const locale of LOCALES) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "tools__item";
        item.dataset.code = locale.code;
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", "false");
        item.innerHTML = `<span class="tools__name">${locale.name}</span><small>${locale.code}</small>`;
        item.addEventListener("click", () => {
          setLanguage(locale.code);
          item.closest("details").open = false;
        });
        menu.append(item);
      }
    }
  };

  /* ---------- 5) 提取码 / 分享链接：点击复制 ---------- */

  document.addEventListener("click", async (event) => {
    const chip = event.target.closest("[data-copy]");
    if (!chip) return;
    const value = chip.getAttribute("data-copy");
    if (!value) return;
    const label = chip.textContent;

    try {
      await navigator.clipboard.writeText(value);
      chip.dataset.copied = "1";
      chip.textContent = t("已复制");
      setTimeout(() => {
        chip.dataset.copied = "0";
        chip.textContent = label;
      }, 1600);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(chip);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  /* ---------- 6) 页脚年份 ---------- */

  for (const el of document.querySelectorAll("[data-year]")) {
    el.textContent = String(new Date().getFullYear());
  }

  /* ---------- 7) 阅读进度 / 首屏视差 / 卡片倾斜 ---------- */

  const progress = document.createElement("div");
  progress.className = "progress";
  progress.setAttribute("aria-hidden", "true");
  progress.innerHTML = '<div class="progress__bar"></div>';
  document.body.prepend(progress);

  const bar = progress.firstElementChild;
  let queued = false;
  const drawProgress = () => {
    queued = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const value = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
    bar.style.setProperty("--read", value.toFixed(4));
  };
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(drawProgress);
    },
    { passive: true },
  );
  window.addEventListener("resize", drawProgress, { passive: true });
  drawProgress();

  if (fine && !reduce) {
    const hero = document.querySelector(".hero");
    const title = document.querySelector(".hero__title");
    const emblem = document.querySelector(".hero__aside .emblem");

    if (hero && (title || emblem)) {
      const rest = () => {
        for (const el of [title, emblem]) {
          if (!el) continue;
          el.style.setProperty("--sx", "0px");
          el.style.setProperty("--sy", "0px");
        }
      };
      hero.addEventListener("pointermove", (event) => {
        const box = hero.getBoundingClientRect();
        const nx = (event.clientX - box.left) / box.width - 0.5;
        const ny = (event.clientY - box.top) / box.height - 0.5;
        if (title) {
          title.style.setProperty("--sx", `${(nx * 7).toFixed(2)}px`);
          title.style.setProperty("--sy", `${(ny * 5).toFixed(2)}px`);
        }
        if (emblem) {
          emblem.style.setProperty("--sx", `${(nx * -5).toFixed(2)}px`);
          emblem.style.setProperty("--sy", `${(ny * -4).toFixed(2)}px`);
        }
      });
      hero.addEventListener("pointerleave", rest);
    }

    for (const card of document.querySelectorAll(".org")) {
      card.addEventListener("pointermove", (event) => {
        const box = card.getBoundingClientRect();
        const nx = (event.clientX - box.left) / box.width - 0.5;
        const ny = (event.clientY - box.top) / box.height - 0.5;
        card.style.setProperty("--ty", `${(nx * 3.2).toFixed(2)}deg`);
        card.style.setProperty("--tx", `${(ny * -2.4).toFixed(2)}deg`);
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--tx", "0deg");
        card.style.setProperty("--ty", "0deg");
      });
    }
  }

  /* ---------- 启动 ---------- */

  mountTools();
  applyTheme();
  setLanguage(current, true);
})();
