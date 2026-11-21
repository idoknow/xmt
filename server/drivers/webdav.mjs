// WebDAV 驱动（AList 的 WebDav 同款能力：列目录、下载、上传、改名、移动、删除）
const trimSlash = (value) => String(value || "").replace(/\/+$/, "");

const joinUrl = (base, relPath) => {
  const raw = String(relPath || "/");
  const segments = raw
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg));
  const tail = segments.length && raw.endsWith("/") ? "/" : "";
  return `${trimSlash(base)}/${segments.join("/")}${tail}`;
};

const authHeader = (username, password) =>
  "Basic " + Buffer.from(`${username}:${password}`, "utf8").toString("base64");

const decodeHref = (href) => {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
};

/** XML 实体解码：PROPFIND 里的 displayname/href 会把 & < > ' " 写成实体 */
const decodeXml = (value) =>
  String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function parseProps(xml) {
  const items = [];
  const blocks = String(xml).split(/<[^>]*:?response[\s>]/i).slice(1);
  for (const block of blocks) {
    const rawHref = /<(?:[\w-]+:)?href[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i.exec(block)?.[1]?.trim();
    if (!rawHref) continue;
    const href = decodeXml(rawHref);
    // 目录判定：resourcetype 里有 collection，或 href 以 / 结尾，或 getcontenttype 是目录类型
    const contentType = decodeXml(/<(?:[\w-]+:)?getcontenttype[^>]*>([^<]*)</i.exec(block)?.[1]?.trim() || "");
    const isDir =
      /<(?:[\w-]+:)?collection\b/i.test(block) ||
      /\/$/.test(href) ||
      /directory|collection|inode\/directory/i.test(contentType);
    const size = Number(/<(?:[\w-]+:)?getcontentlength[^>]*>(\d+)</i.exec(block)?.[1] || 0);
    const modified = /<(?:[\w-]+:)?getlastmodified[^>]*>([^<]+)</i.exec(block)?.[1]?.trim() || null;
    const display = decodeXml(
      /<(?:[\w-]+:)?displayname[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?displayname>/i.exec(block)?.[1]?.trim(),
    ).trim();
    items.push({ href: decodeHref(href), isDir, size: isDir ? 0 : size, modified, display });
  }
  return items;
}

/** 把 PROPFIND 返回的 href（可能是绝对 URL、带编码、大小写不同）换成相对根路径 */
function relativePath(href, basePath) {
  let path = String(href || "");
  const absolute = /^[a-z]+:\/\//i.test(path);
  if (absolute) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = path.replace(/^[a-z]+:\/\/[^/]+/i, "");
    }
  }
  path = decodeHref(path);
  if (!path.startsWith("/")) path = `/${path}`;
  const root = basePath.replace(/\/+$/, "");
  if (!root) return path;
  if (path.toLowerCase().startsWith(root.toLowerCase())) {
    const rest = path.slice(root.length) || "/";
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  // 服务器回的是别的挂载前缀：退化成末尾一段
  return path;
}

export function webdavDriver({ address, username = "", password = "", root = "" }) {
  const base = trimSlash(address) + trimSlash(root);
  const headers = () => {
    const out = { accept: "application/xml, text/xml", "accept-encoding": "identity" };
    if (username || password) out.authorization = authHeader(username, password);
    return out;
  };

  const request = async (method, relPath, { body, extra = {}, raw = false, rawJoin = false } = {}) => {
    const url = rawJoin
      ? `${trimSlash(base)}/${String(relPath).replace(/^\/+/, "")}`
      : joinUrl(base, relPath);
    const res = await fetch(url, { method, headers: { ...headers(), ...extra }, body });
    if (!raw && !res.ok && res.status !== 207) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`WebDAV ${method} ${relPath} → ${res.status} ${text.slice(0, 200)}`), {
        status: res.status === 401 || res.status === 403 ? 502 : res.status,
      });
    }
    return res;
  };

  /**
   * 直接按绝对 URL 发 PROPFIND。
   * 只在「服务端返回的 href 与我们拼出来的路径对不上」时用：有时目录名里的 & 只有原样发才认。
   */
  const propfindAbsolute = async (absoluteUrl, depth = "1") => {
    const res = await fetch(absoluteUrl, {
      method: "PROPFIND",
      headers: { ...headers(), depth, "content-type": "application/xml; charset=UTF-8" },
    });
    if (!res.ok && res.status !== 207) {
      await res.text().catch(() => "");
      return { status: res.status, items: [], url: absoluteUrl };
    }
    return { status: res.status, items: parseProps(await res.text()), url: absoluteUrl };
  };

  const PROP_BODY =
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:displayname/></d:prop></d:propfind>';

  /** 列一个目录，返回原始项（含 href），失败返回 status */
  const propfindDir = async (dir, depth = "1") => {
    const cleanDir = String(dir || "/").trim() || "/";
    const plain = cleanDir.replace(/\/+$/, "");
    const forms = cleanDir === "/" ? ["/"] : [`${plain}/`, plain];
    const tried = [];
    let lastStatus = 0;
    for (const form of forms) {
      for (const rawJoin of [false, true]) {
        const url = rawJoin ? `${trimSlash(base)}/${form.replace(/^\/+/, "")}` : joinUrl(base, form);
        const res = await fetch(url, {
          method: "PROPFIND",
          headers: { ...headers(), depth, "content-type": "application/xml; charset=UTF-8" },
          body: PROP_BODY,
        });
        lastStatus = res.status;
        if (res.ok || res.status === 207) {
          return { ok: true, status: res.status, items: parseProps(await res.text()), url };
        }
        await res.text().catch(() => "");
        tried.push(`${res.status} ${decodeHref(url)}`);
      }
    }
    return { status: lastStatus, items: [], url: decodeHref(joinUrl(base, forms[0])), tried };
  };

  /** 把一次 PROPFIND 的结果转成相对「存储根」的路径条目（跳过被请求目录自身） */
  const toEntries = (items, dirPath = "/") => {
    // 服务器回的 href 基本都带着自己的挂载前缀（例如 /dav/...），
    // 记录必须是相对存储根的路径，否则再进子目录时会把前缀丢掉。
    const rootPath = decodeHref(new URL(`${trimSlash(base)}/`).pathname).replace(/\/+$/, "");
    const self = String(dirPath || "/").replace(/\/+$/, "");
    const out = [];
    for (const item of items) {
      const itemPath = item.href.replace(/\/+$/, "");
      if (!itemPath) continue;
      const rel = relativePath(item.href, rootPath);
      const normalized = rel.replace(/\/+$/, "") || "/";
      if (normalized === "/" || normalized === self) continue; // 目录自身
      const name = item.display || normalized.split("/").filter(Boolean).pop() || normalized;
      out.push({ name, path: normalized, isDir: item.isDir, size: item.size, modified: item.modified });
    }
    return out;
  };

  /**
   * 按名字回上一层找出这条的真实 href，返回可直接请求的绝对地址。
   * 用于服务端只认自己给的 href（名字里带 & 时 %26 不被识别）的情况。
   */
  const resolveAbsolute = async (target) => {
    const plain = String(target || "/").replace(/\/+$/, "");
    const name = plain.split("/").filter(Boolean).pop() || "";
    if (!name) return null;
    const parentPath = plain.split("/").slice(0, -1).join("/") || "/";
    const parent = await propfindDir(parentPath, "1");
    if (!parent.ok) return null;
    const match = parent.items.find((item) => {
      const tail = decodeHref(item.href).replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
      return decodeHref(tail) === name || decodeXml(item.display || "") === name;
    });
    if (!match) return null;
    const href = decodeXml(match.href);
    const absolute = /^https?:\/\//i.test(href) ? href : new URL(href, base).toString();
    for (const candidate of [encodeURI(absolute), absolute]) {
      try {
        const res = await fetch(candidate, {
          method: "PROPFIND",
          headers: { ...headers(), depth: "0", "content-type": "application/xml; charset=UTF-8" },
          body: PROP_BODY,
        });
        await res.text().catch(() => "");
        if (res.ok || res.status === 207) return candidate;
      } catch {}
    }
    return null;
  };

  const statOf = async (target) => {
    const propBody =
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/></d:prop></d:propfind>';
    const plain = String(target).replace(/\/+$/, "");
    const forms = [plain, `${plain}/`];
    const wantName = plain.split("/").filter(Boolean).pop() || "";
    try {
      for (const form of forms) {
        const res = await request("PROPFIND", form, {
          body: propBody,
          extra: { depth: "0", "content-type": "application/xml; charset=UTF-8" },
          raw: true,
        });
        if (!res.ok && res.status !== 207) {
          await res.text().catch(() => "");
          continue;
        }
        const [item] = parseProps(await res.text());
        if (!item) continue;
        // 服务器可能把 /file/ 当成所在目录返回，名称对不上就跳过
        const gotName = item.href.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
        if (wantName && decodeHref(gotName) !== wantName) continue;
        return { path: target, isDir: item.isDir, size: item.size, modified: item.modified };
      }
      // 兜底：走上一层找真实 href
      const absolute = await resolveAbsolute(target);
      if (absolute) {
        const deep = await propfindAbsolute(absolute, "0");
        const [item] = deep.items || [];
        if (item) return { path: target, isDir: item.isDir, size: item.size, modified: item.modified };
      }
      return null;
    } catch {
      return null;
    }
  };

  return {
    name: "webdav",
    base,

    async list(dir = "/") {
      const clean = String(dir || "/").trim() || "/";
      const sortEntries = (items) => items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh"));

      const hit = await propfindDir(clean, "1");
      if (hit.ok) return sortEntries(toEntries(hit.items, clean));

      // 404/405 之类：有的服务端只认它自己返回的 href（目录名里有 & 时尤其常见，
      // 编码过的 %26 反而不匹配），于是回到上一层按名字找回这条，再用它的 href 直接请求。
      const plain = clean.replace(/\/+$/, "");
      const wantName = plain.split("/").filter(Boolean).pop() || "";
      if (wantName) {
        const parentPath = plain.split("/").slice(0, -1).join("/") || "/";
        const parent = await propfindDir(parentPath, "1");
        if (parent.ok) {
          const match = parent.items.find((item) => {
            const tail = decodeHref(item.href).replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
            return decodeHref(tail) === wantName || decodeXml(item.display || "") === wantName;
          });
          if (match) {
            const href = decodeXml(match.href);
            const absolute = /^https?:\/\//i.test(href) ? href : new URL(href, base).toString();
            for (const candidate of [encodeURI(absolute), absolute]) {
              const deep = await propfindAbsolute(candidate, "1");
              if (deep.status === 207) return sortEntries(toEntries(deep.items, clean));
            }
          }
        }
      }

      const tried = hit.tried?.length ? `；试过 ${hit.tried.join(" / ")}` : "";
      throw Object.assign(new Error(`WebDAV 列目录失败 ${hit.status}（${hit.url}）${tried}`), { status: 502 });
    },

    stat: statOf,

    async ensureDir(dir) {
      const res = await request("MKCOL", dir, { raw: true });
      if (!res.ok && res.status !== 405 && res.status !== 301) {
        throw Object.assign(new Error(`WebDAV 建目录失败 ${res.status}`), { status: 502 });
      }
      return dir;
    },

    async read() {
      throw Object.assign(new Error("WebDAV 文件请走直链下载"), { status: 501 });
    },

    async write(target, { filePath }) {
      const { createReadStream } = await import("node:fs");
      const { stat } = await import("node:fs/promises");
      const info = await stat(filePath);
      const res = await fetch(joinUrl(base, target), {
        method: "PUT",
        headers: { ...headers(), "content-length": String(info.size) },
        body: createReadStream(filePath),
        duplex: "half",
      });
      if (!res.ok) throw Object.assign(new Error(`WebDAV 上传失败 ${res.status}`), { status: 502 });
      return { path: target, size: info.size };
    },

    async rename(target, newName) {
      const dir = target.replace(/\/[^/]+$/, "");
      const to = `${dir}/${newName}`;
      const res = await request("MOVE", target, {
        extra: { destination: joinUrl(base, to), overwrite: "F" },
        raw: true,
      });
      if (!res.ok) throw Object.assign(new Error(`WebDAV 改名失败 ${res.status}`), { status: 502 });
      return to;
    },

    async move(target, destinationDir) {
      const name = target.split("/").filter(Boolean).pop();
      const to = `${destinationDir.replace(/\/+$/, "")}/${name}`;
      const res = await request("MOVE", target, {
        extra: { destination: joinUrl(base, to), overwrite: "F" },
        raw: true,
      });
      if (!res.ok) throw Object.assign(new Error(`WebDAV 移动失败 ${res.status}`), { status: 502 });
      return to;
    },

    async copy(target, destinationDir) {
      const name = target.split("/").filter(Boolean).pop();
      const to = `${destinationDir.replace(/\/+$/, "")}/${name}`;
      const res = await request("COPY", target, {
        extra: { destination: joinUrl(base, to), overwrite: "F" },
        raw: true,
      });
      if (!res.ok) throw Object.assign(new Error(`WebDAV 复制失败 ${res.status}`), { status: 502 });
      return to;
    },

    async remove(target) {
      const res = await request("DELETE", target, { raw: true });
      if (!res.ok && res.status !== 404) throw Object.assign(new Error(`WebDAV 删除失败 ${res.status}`), { status: 502 });
      return true;
    },

    /** 交给浏览器直连的地址（含认证头交给服务端代理时使用） */
    async download(target) {
      const info = await statOf(target);
      if (info?.isDir) throw Object.assign(new Error("这是一个目录，不能直接下载"), { status: 400 });
      const urls = [joinUrl(base, target)];
      const resolved = await resolveAbsolute(target).catch(() => null);
      if (resolved && !urls.includes(resolved)) urls.push(resolved);
      let res = null;
      let last = 0;
      for (const url of urls) {
        res = await fetch(url, { headers: headers() });
        last = res.status;
        if (res.ok) break;
        await res.text().catch(() => "");
      }
      if (!res || !res.ok) {
        throw Object.assign(new Error(`WebDAV 下载失败 ${last}（${decodeHref(urls[0])}）`), { status: 502 });
      }
      return {
        stream: res.body,
        size: Number(res.headers.get("content-length") || 0),
        mime: res.headers.get("content-type"),
        encoding: res.headers.get("content-encoding") || "",
      };
    },

    /**
     * 容量：RFC 4331 的 quota-used-bytes / quota-available-bytes。
     * 服务器不支持就返回 null（上层让管理员手填）。
     */
    async capacity() {
      const propBody =
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>';
      for (const form of ["/", ""]) {
        try {
          const res = await request("PROPFIND", form, {
            body: propBody,
            extra: { depth: "0", "content-type": "application/xml; charset=UTF-8" },
            raw: true,
          });
          if (!res.ok && res.status !== 207) {
            await res.text().catch(() => "");
            continue;
          }
          const xml = await res.text();
          const used = Number(/<(?:[\w-]+:)?quota-used-bytes[^>]*>(\d+)</i.exec(xml)?.[1] || 0);
          const avail = Number(/<(?:[\w-]+:)?quota-available-bytes[^>]*>(\d+)</i.exec(xml)?.[1] || 0);
          // np=0 常见于「无限」；available 常见 -1 / 一个很大的数
          if (!used && !avail) continue;
          if (avail > 0 && Number.isSafeInteger(used + avail) && used + avail < Number.MAX_SAFE_INTEGER) {
            return { total: used + avail, free: avail };
          }
          return { total: 0, free: Math.max(avail, 0) };
        } catch {
          continue;
        }
      }
      return null;
    },
  };
}
