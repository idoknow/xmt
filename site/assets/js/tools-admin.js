// 后台：在线工具链接与软件清单的维护。
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const dataNode = $("#tools-data");
const store = dataNode ? JSON.parse(dataNode.textContent || "{}") : { links: [], software: [] };

const post = async (url, body, method = "POST") => {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "DELETE" ? undefined : JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
};

/* ---------- 链接 ---------- */

const linkForm = $("[data-link-form]");
if (linkForm) {
  const submit = $("[data-link-submit]", linkForm);
  const cancel = $("[data-link-cancel]", linkForm);

  const fill = (link) => {
    linkForm.id.value = link?.id || "";
    linkForm.name.value = link?.name || "";
    linkForm.url.value = link?.url || "";
    linkForm.note.value = link?.note || "";
    linkForm.category.value = link?.category || "";
    linkForm.sort_order.value = String(link?.sort_order ?? 0);
    submit.textContent = link?.id ? "保存修改" : "添加链接";
    cancel.hidden = !link?.id;
    if (link?.id) linkForm.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  cancel?.addEventListener("click", () => fill(null));

  linkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const body = {
        name: linkForm.name.value.trim(),
        url: linkForm.url.value.trim(),
        note: linkForm.note.value.trim(),
        category: linkForm.category.value.trim(),
        sort_order: Number(linkForm.sort_order.value) || 0,
      };
      if (linkForm.id.value) body.id = Number(linkForm.id.value);
      await post("/memories/api/tools/links", body);
      location.reload();
    } catch (error) {
      alert(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-link]");
    if (edit) {
      const link = (store.links || []).find((item) => String(item.id) === edit.dataset.editLink);
      if (link) fill(link);
      return;
    }
    const toggle = event.target.closest("[data-toggle-link]");
    if (toggle) {
      toggle.disabled = true;
      post(`/memories/api/tools/links/${toggle.dataset.toggleLink}/toggle`, {})
        .then(() => location.reload())
        .catch((error) => {
          alert(error.message);
          toggle.disabled = false;
        });
      return;
    }
    const remove = event.target.closest("[data-remove-link]");
    if (remove) {
      if (!confirm("删除这条链接？")) return;
      remove.disabled = true;
      post(`/memories/api/tools/links/${remove.dataset.removeLink}`, undefined, "DELETE")
        .then(() => location.reload())
        .catch((error) => {
          alert(error.message);
          remove.disabled = false;
        });
    }
  });
}

/* ---------- 软件 ---------- */

const softForm = $("[data-soft-form]");
if (softForm) {
  const submit = $("[data-soft-submit]", softForm);
  const cancel = $("[data-soft-cancel]", softForm);
  const list = $("[data-soft-links]", softForm);

  const addRow = (link = { label: "", url: "" }) => {
    const row = document.createElement("div");
    row.className = "a-link-row";
    row.innerHTML = `
      <input class="field__input" data-link-label placeholder="线路名，如「网盘」「直链」" value="${String(link.label || "").replace(/"/g, "&quot;")}" />
      <input class="field__input" data-link-url placeholder="https://…" value="${String(link.url || "").replace(/"/g, "&quot;")}" />
      <button class="a-btn a-btn--tiny" type="button" data-link-remove>删除</button>`;
    row.querySelector("[data-link-remove]").addEventListener("click", () => row.remove());
    list.append(row);
  };

  $("[data-soft-add]", softForm)?.addEventListener("click", () => addRow());

  const fill = (item) => {
    softForm.id.value = item?.id || "";
    softForm.name.value = item?.name || "";
    softForm.category.value = item?.category || "";
    softForm.devices.value = item?.devices || "";
    softForm.size.value = item?.size || "";
    softForm.note.value = item?.note || "";
    softForm.sort_order.value = String(item?.sort_order ?? 0);
    list.innerHTML = "";
    const links = item?.links?.length ? item.links : [{ label: "", url: "" }];
    links.forEach((link) => addRow(link));
    submit.textContent = item?.id ? "保存修改" : "添加软件";
    cancel.hidden = !item?.id;
    if (item?.id) softForm.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  cancel?.addEventListener("click", () => fill(null));
  fill(null);

  softForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const links = $$(".a-link-row", list)
        .map((row) => ({
          label: $("[data-link-label]", row).value.trim(),
          url: $("[data-link-url]", row).value.trim(),
        }))
        .filter((link) => link.url);
      const body = {
        name: softForm.name.value.trim(),
        category: softForm.category.value.trim(),
        devices: softForm.devices.value.trim(),
        size: softForm.size.value.trim(),
        note: softForm.note.value.trim(),
        sort_order: Number(softForm.sort_order.value) || 0,
        links,
      };
      if (softForm.id.value) body.id = Number(softForm.id.value);
      await post("/memories/api/tools/software", body);
      location.reload();
    } catch (error) {
      alert(error.message);
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-soft]");
    if (edit) {
      const item = (store.software || []).find((row) => String(row.id) === edit.dataset.editSoft);
      if (item) fill(item);
      return;
    }
    const toggle = event.target.closest("[data-toggle-soft]");
    if (toggle) {
      toggle.disabled = true;
      post(`/memories/api/tools/software/${toggle.dataset.toggleSoft}/toggle`, {})
        .then(() => location.reload())
        .catch((error) => {
          alert(error.message);
          toggle.disabled = false;
        });
      return;
    }
    const remove = event.target.closest("[data-remove-soft]");
    if (remove) {
      if (!confirm("删除这个软件条目？")) return;
      remove.disabled = true;
      post(`/memories/api/tools/software/${remove.dataset.removeSoft}`, undefined, "DELETE")
        .then(() => location.reload())
        .catch((error) => {
          alert(error.message);
          remove.disabled = false;
        });
    }
  });
}
