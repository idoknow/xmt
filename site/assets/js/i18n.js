// 多语言引擎（无依赖）：静态页与服务端渲染的页面共用。
// 词条以「页面上的中文原句」为键，存在 /assets/i18n/<code>.json 的 map 里。
// 带数字的句子（"共 12 个 · 1.2 GB"）会把数字归一成 {1}{2} 再查表，因此同一句模板只译一次。
window.XmtI18n = (() => {
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

  const ATTRS = ["aria-label", "alt", "title", "placeholder", "data-label"];
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|CODE|PRE)$/;
  const cache = new Map();
  // 每次检测都重新读一遍：客户端跳转（如 /memories → /memories/files）会改掉查询串
  const searchParams = () => new URLSearchParams(location.search);

  let dict = null;
  let base = null;
  let current = "zh-Hans";
  let observer = null;
  let titleOriginal = null;

  const touched = [];
  const done = new Set();

  // 数字连同紧跟的单位一起收进占位符（"1.2 MB" → {1}），
  // 这样同一句模板不会因为单位不同（B / KB / MB / GB）而各要一条译文。
  // 一次扫描完成：已经出现的 {n} 占位符原样跳过，新数字接着编号。
  // 只吞「数字与单位之间」的空格，不吞单位后面的空格，否则 "0 张" 会变成 "{1}张"。
  const normalize = (text) => {
    const nums = [];
    let next = Math.max(0, ...[...text.matchAll(/\{(\d+)\}/g)].map((item) => Number(item[1])));
    const key = text.replace(
      /\{\d+\}|\d+(?:[.,]\d+)?(?:[ \t\u00a0]?(?:[KMGT]?B|B\/s|%|px))?/gi,
      (match) => {
        if (match.startsWith("{")) return match;
        next += 1;
        nums.push(match.trim());
        return `{${next}}`;
      },
    );
    return { key, nums };
  };

  const pattern = (text) => {
    for (const map of [dict, base]) {
      if (!map) continue;
      const { key, nums } = normalize(text);
      const hit = map[key];
      if (hit) return hit.replace(/\{(\d+)\}/g, (whole, index) => nums[Number(index) - 1] ?? whole);
    }
    return null;
  };

  const lookup = (text) => (dict && dict[text]) || (base && base[text]) || pattern(text);

  const t = (text, vars) => {
    const hit = lookup(text) || text;
    if (!vars) return hit;
    return hit.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
  };

  const detect = () => {
    const fromUrl = searchParams().get("lang");
    if (fromUrl && LOCALES.some((item) => item.code === fromUrl)) return fromUrl;
    const stored = localStorage.getItem("xmt-lang");
    if (stored && LOCALES.some((item) => item.code === stored)) return stored;
    const nav = (navigator.language || "zh-CN").toLowerCase();
    if (nav.startsWith("zh")) return nav.includes("hant") || /-(tw|hk|mo)$/.test(nav) ? "zh-Hant" : "zh-Hans";
    for (const code of ["ja", "ko", "ru", "fr", "de", "es", "ar", "hi", "bo", "mn", "ug", "za"]) {
      if (nav.startsWith(code)) return code;
    }
    return "en";
  };

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
    done.clear();
    if (titleOriginal !== null) {
      document.title = titleOriginal;
      titleOriginal = null;
    }
  };

  const translateNode = (node) => {
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) return;
    if (done.has(node)) return;
    if (node.parentElement && node.parentElement.closest("[data-no-i18n]")) return;
    const key = raw.replace(/\s+/g, " ").trim();
    const value = lookup(key);
    if (!value || value === key) return;
    const lead = /^\s*/.exec(raw)[0];
    const trail = /\s*$/.exec(raw)[0];
    touched.push({ node, original: raw });
    done.add(node);
    node.nodeValue = lead + value + trail;
  };

  const translateTree = (root) => {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        SKIP.test(node.parentNode?.nodeName || "") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const batch = [];
    let node;
    while ((node = walker.nextNode())) batch.push(node);
    for (const item of batch) translateNode(item);
  };

  const translateAttrs = (root) => {
    if (!root?.querySelectorAll) return;
    for (const el of root.querySelectorAll("[aria-label],[alt],[title],[placeholder],[data-label]")) {
      for (const attr of ATTRS) {
        const raw = el.getAttribute(attr);
        if (!raw) continue;
        const key = raw.trim();
        const value = lookup(key);
        if (!value || value === key) continue;
        el.setAttribute(attr, value);
      }
    }
  };

  const translateHead = () => {
    if (document.documentElement.closest("[data-no-i18n]")) return;
    const title = document.title.trim();
    const titleText = title ? lookup(title) : null;
    if (titleText && titleText !== title) {
      titleOriginal = document.title;
      document.title = titleText;
    }
    const meta = document.querySelector('meta[name="description"]');
    const content = meta?.getAttribute("content");
    const contentText = content ? lookup(content.trim()) : null;
    if (contentText && contentText !== content.trim()) meta.setAttribute("content", contentText);
  };

  const apply = () => {
    if (!dict && !base) return;
    restore();
    translateTree(document.body);
    translateAttrs(document.body);
    translateHead();
  };

  const observe = () => {
    if (observer) return;
    observer = new MutationObserver((records) => {
      if (current === "zh-Hans" || (!dict && !base)) return;
      for (const record of records) {
        if (record.type === "characterData") {
          translateNode(record.target);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType === 3) translateNode(node);
          else if (node.nodeType === 1) {
            translateTree(node);
            translateAttrs(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  };

  const updateLabels = (locale) => {
    for (const label of document.querySelectorAll("[data-lang-label]")) label.textContent = locale.name;
    for (const item of document.querySelectorAll("[data-lang-menu] [data-code]")) {
      item.setAttribute("aria-checked", String(item.dataset.code === locale.code));
    }
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
    } else {
      const [own, fallback] = await Promise.all([
        load(locale.code),
        locale.code === "en" ? Promise.resolve(null) : load("en"),
      ]);
      dict = own?.map || null;
      base = fallback?.map || null;
      apply();
      observe();
    }

    updateLabels(locale);
    document.dispatchEvent(new CustomEvent("xmt:lang", { detail: locale.code }));
    if (!silent) window.scrollTo(window.scrollX, window.scrollY);
  };

  // 菜单标记：与静态页 .tools__drop 同一套样式，服务端页面可直接复用。
  const menuMarkup = () => {
    const items = LOCALES.map(
      (locale) =>
        `<button type="button" class="tools__item" data-code="${locale.code}" role="menuitemradio" aria-checked="false">` +
        `<span class="tools__name">${locale.name}</span><small>${locale.code}</small></button>`,
    ).join("");
    return (
      '<details class="tools__drop" data-lang>' +
      '<summary class="tools__btn"><span class="tools__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<circle cx="8" cy="8" r="6.1"/><path d="M1.9 8h12.2"/><path d="M8 1.9c1.85 1.95 2.85 3.9 2.85 6.1S9.85 12.05 8 14.1C6.15 12.05 5.15 10.1 5.15 8S6.15 3.85 8 1.9Z"/></svg>' +
      `</span><span class="tools__label" data-lang-label>${LOCALES[0].name}</span></summary>` +
      `<div class="tools__menu tools__menu--wide" role="menu" data-lang-menu>${items}</div>` +
      "</details>"
    );
  };

  const mount = (root = document) => {
    for (const slot of root.querySelectorAll("[data-lang-slot]")) {
      if (slot.querySelector("[data-lang-menu]")) continue;
      slot.insertAdjacentHTML("beforeend", menuMarkup());
    }
    for (const menu of root.querySelectorAll("[data-lang-menu]")) {
      if (menu.dataset.bound) continue;
      menu.dataset.bound = "1";
      for (const item of menu.querySelectorAll("[data-code]")) {
        item.addEventListener("click", () => {
          setLanguage(item.dataset.code);
          item.closest("details").open = false;
        });
      }
    }
    const locale = LOCALES.find((item) => item.code === current) || LOCALES[0];
    updateLabels(locale);
  };

  const onReady = () => {
    mount();
    setLanguage(detect(), true);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();

  return {
    locales: LOCALES,
    get current() {
      return current;
    },
    t,
    lookup,
    setLanguage,
    mount,
    markup: menuMarkup,
    normalize,
    get debug() {
      return { current, dictSize: dict ? Object.keys(dict).length : -1, baseSize: base ? Object.keys(base).length : -1 };
    },
  };
})();
