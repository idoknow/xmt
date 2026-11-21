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

// 表单里的 name/id/size 与 HTMLFormElement 自身属性同名，直接 form.name 拿到的是字符串，
// 这里统一走 elements，避免「点编辑没反应」。
const field = (form, name) => form.elements.namedItem(name) || $(`[name="${name}"]`, form);
const read = (form, name) => String(field(form, name)?.value ?? "").trim();
const setValue = (form, name, value) => {
  const node = field(form, name);
  if (node) node.value = value ?? "";
};

/* ---------- 链接 ---------- */

const linkForm = $("[data-link-form]");
if (linkForm) {
  const submit = $("[data-link-submit]", linkForm);
  const cancel = $("[data-link-cancel]", linkForm);

  const fill = (link) => {
    setValue(linkForm, "id", link?.id || "");
    setValue(linkForm, "name", link?.name || "");
    setValue(linkForm, "url", link?.url || "");
    setValue(linkForm, "note", link?.note || "");
    setValue(linkForm, "sort_order", String(link?.sort_order ?? 0));
    submit.textContent = link?.id ? "保存修改" : "添加链接";
    cancel.hidden = !link?.id;
    if (link?.id) {
      linkForm.hidden = false;
      linkForm.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const openForm = () => {
    linkForm.hidden = false;
    linkForm.scrollIntoView({ behavior: "smooth", block: "center" });
    field(linkForm, "name")?.focus();
  };

  $("[data-link-open]")?.addEventListener("click", () => {
    fill(null);
    openForm();
  });

  cancel?.addEventListener("click", () => {
    fill(null);
    linkForm.hidden = true;
  });

  linkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const body = {
        name: read(linkForm, "name"),
        url: read(linkForm, "url"),
        note: read(linkForm, "note"),
        sort_order: Number(read(linkForm, "sort_order")) || 0,
      };
      const id = read(linkForm, "id");
      if (id) body.id = Number(id);
      await post("/memories/api/tools/links", body);
      linkForm.reset();
      fill(null);
      linkForm.hidden = true;
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

  const addRow = (link = { platform: "", label: "", url: "" }) => {
    const row = document.createElement("div");
    row.className = "a-link-row a-link-row--soft";
    row.innerHTML = `
      <input class="field__input" data-link-platform placeholder="平台，如 Windows / Android" value="${String(link.platform || "").replace(/"/g, "&quot;")}" list="soft-platforms" />
      <input class="field__input" data-link-label placeholder="线路名，如「网盘」「直链」" value="${String(link.label || "").replace(/"/g, "&quot;")}" />
      <input class="field__input" data-link-url placeholder="https://…" value="${String(link.url || "").replace(/"/g, "&quot;")}" />
      <button class="a-btn a-btn--tiny" type="button" data-link-remove>删除</button>`;
    row.querySelector("[data-link-remove]").addEventListener("click", () => row.remove());
    list.append(row);
  };

  $("[data-soft-add]", softForm)?.addEventListener("click", () => addRow());

  const fill = (item) => {
    setValue(softForm, "id", item?.id || "");
    setValue(softForm, "name", item?.name || "");
    setValue(softForm, "icon", item?.icon || "");
    setValue(softForm, "category", item?.category || "");
    setValue(softForm, "devices", item?.devices || "");
    setValue(softForm, "size", item?.size || "");
    setValue(softForm, "note", item?.note || "");
    setValue(softForm, "sort_order", String(item?.sort_order ?? 0));
    list.innerHTML = "";
    const links = item?.links?.length ? item.links : [{ platform: "", label: "", url: "" }];
    links.forEach((link) => addRow(link));
    submit.textContent = item?.id ? "保存修改" : "添加软件";
    cancel.hidden = !item?.id;
    if (item?.id) {
      softForm.hidden = false;
      softForm.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const openForm = () => {
    softForm.hidden = false;
    softForm.scrollIntoView({ behavior: "smooth", block: "start" });
    field(softForm, "name")?.focus();
  };

  $("[data-soft-open]")?.addEventListener("click", () => {
    fill(null);
    openForm();
  });

  cancel?.addEventListener("click", () => {
    fill(null);
    softForm.hidden = true;
  });
  fill(null);

  softForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const links = $$(".a-link-row", list)
        .map((row) => ({
          platform: $("[data-link-platform]", row).value.trim(),
          label: $("[data-link-label]", row).value.trim(),
          url: $("[data-link-url]", row).value.trim(),
        }))
        .filter((link) => link.url);
      const body = {
        name: read(softForm, "name"),
        icon: read(softForm, "icon"),
        category: read(softForm, "category"),
        devices: read(softForm, "devices"),
        size: read(softForm, "size"),
        note: read(softForm, "note"),
        sort_order: Number(read(softForm, "sort_order")) || 0,
        links,
      };
      const id = read(softForm, "id");
      if (id) body.id = Number(id);
      await post("/memories/api/tools/software", body);
      softForm.reset();
      fill(null);
      softForm.hidden = true;
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

/* ---------- 适配设备：回车加标签 ---------- */

const devicesInput = $('[data-devices-input]');
const devicesBox = $("[data-devices-tags]");
const devicesHidden = $('[data-soft-form] [name="devices"]');

if (devicesInput && devicesBox && devicesHidden) {
  const readTags = () =>
    String(devicesHidden.value || "")
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean);
  const writeTags = (tags) => {
    devicesHidden.value = Array.from(new Set(tags)).join(" · ");
  };
  const render = () => {
    devicesBox.innerHTML = "";
    readTags().forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "a-tag";
      chip.innerHTML = `<span>${tag.replace(/[<>&]/g, "")}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `移除 ${tag}`);
      remove.addEventListener("click", () => {
        writeTags(readTags().filter((item) => item !== tag));
        render();
      });
      chip.append(remove);
      devicesBox.append(chip);
    });
  };
  const add = (value) => {
    const tag = String(value || "").trim();
    if (!tag) return;
    writeTags([...readTags(), tag]);
    devicesInput.value = "";
    render();
  };
  devicesInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add(devicesInput.value);
  });
  devicesInput.addEventListener("blur", () => add(devicesInput.value));
  render();
}
