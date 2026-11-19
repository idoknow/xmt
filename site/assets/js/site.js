// 桂林中学新媒体 —— 交互脚本（无依赖）
// 滚动进入、复制提取码、年份、配色、多语言。

(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsViewTimeline = CSS.supports("animation-timeline: view()");

  /* ---------- 1) 滚动进入 ---------- */

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

  /* ---------- 3) 配色 ---------- */

  const THEMES = ["system", "light", "dark"];
  const THEME_ICON = { system: "◐", light: "☀", dark: "☾" };
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
    const icon = document.querySelector("[data-theme-icon]");
    if (label) label.textContent = t(THEME_LABEL[theme]);
    if (icon) icon.textContent = THEME_ICON[theme];
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

      const themeBtn = document.createElement("button");
      themeBtn.type = "button";
      themeBtn.className = "tools__btn";
      themeBtn.setAttribute("data-theme-toggle", "");
      themeBtn.setAttribute("aria-label", "切换配色");
      themeBtn.innerHTML =
        '<span class="tools__icon" data-theme-icon aria-hidden="true">◐</span>' +
        '<span class="tools__label" data-theme-label>跟随系统</span>';
      tools.append(themeBtn);

      const lang = document.createElement("details");
      lang.className = "lang";
      lang.setAttribute("data-lang", "");
      lang.innerHTML =
        '<summary class="tools__btn" aria-label="切换语言">' +
        '<span class="tools__icon" aria-hidden="true">文</span>' +
        '<span class="tools__label" data-lang-label>简体中文</span>' +
        "</summary>" +
        '<div class="lang__menu" role="menu" data-lang-menu></div>';
      tools.append(lang);

      inner.append(tools);
    }

    const menu = tools.querySelector("[data-lang-menu]");
    if (menu && !menu.childElementCount) {
      for (const locale of LOCALES) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "lang__item";
        item.dataset.code = locale.code;
        item.setAttribute("role", "menuitemradio");
        item.setAttribute("aria-checked", "false");
        item.innerHTML = `<span>${locale.name}</span><small>${locale.code}</small>`;
        item.addEventListener("click", () => {
          setLanguage(locale.code);
          tools.querySelector("details")?.removeAttribute("open");
        });
        menu.append(item);
      }
    }

    tools.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
      const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      theme = next;
      localStorage.setItem("xmt-theme", next);
      applyTheme();
    });
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

  /* ---------- 启动 ---------- */

  mountTools();
  applyTheme();
  setLanguage(current, true);
})();
