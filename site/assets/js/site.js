// 桂林中学新媒体 —— 交互脚本（无依赖）
// 只做三件事：滚动进入、复制提取码、年份填充。

(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const supportsViewTimeline = CSS.supports("animation-timeline: view()");

  // 1) 滚动进入：不支持 animation-timeline 的浏览器用 IntersectionObserver
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

  // 2) 提取码 / 分享链接：点击复制
  document.addEventListener("click", async (event) => {
    const chip = event.target.closest("[data-copy]");
    if (!chip) return;
    const value = chip.getAttribute("data-copy");
    if (!value) return;
    const label = chip.textContent;

    try {
      await navigator.clipboard.writeText(value);
      chip.dataset.copied = "1";
      chip.textContent = "已复制";
      setTimeout(() => {
        chip.dataset.copied = "0";
        chip.textContent = label;
      }, 1600);
    } catch {
      // 无剪贴板权限时退回选中文本
      const range = document.createRange();
      range.selectNodeContents(chip);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  // 3) 页脚年份
  for (const el of document.querySelectorAll("[data-year]")) {
    el.textContent = String(new Date().getFullYear());
  }
})();
