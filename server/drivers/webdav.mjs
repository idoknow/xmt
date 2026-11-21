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

  const request = async (method, relPath, { body, extra = {}, raw = false } = {}) => {
    const res = await fetch(joinUrl(base, relPath), { method, headers: { ...headers(), ...extra }, body });
    if (!raw && !res.ok && res.status !== 207) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`WebDAV ${method} ${relPath} → ${res.status} ${text.slice(0, 200)}`), {
        status: res.status === 401 || res.status === 403 ? 502 : res.status,
      });
    }
    return res;
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
      return null;
    } catch {
      return null;
    }
  };

  return {
    name: "webdav",
    base,

    async list(dir = "/") {
      const propBody =
        '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:getlastmodified/><d:displayname/></d:prop></d:propfind>';
      const clean = String(dir || "/").trim() || "/";
      // 有的服务器对 /a/ 认、对 /a 不认，反过来也有；两个都试一次
      const candidates = clean === "/" ? ["/"] : [`${clean.replace(/\/+$/, "")}/`, clean.replace(/\/+$/, "")];
      const tried = [];
      let res = null;
      let lastStatus = 0;
      let usedUrl = "";
      for (const candidate of candidates) {
        usedUrl = joinUrl(base, candidate);
        res = await request("PROPFIND", candidate, {
          body: propBody,
          extra: { depth: "1", "content-type": "application/xml; charset=UTF-8" },
          raw: true,
        });
        lastStatus = res.status;
        if (res.ok || res.status === 207) break;
        tried.push(`${lastStatus} ${decodeURIComponent(usedUrl)}`);
        await res.text().catch(() => "");
      }
      if (!res || (!res.ok && res.status !== 207)) {
        throw Object.assign(new Error(`WebDAV 列目录失败 ${lastStatus}（${tried[0] || usedUrl}）`), { status: 502 });
      }
      const xml = await res.text();
      const basePath = decodeHref(new URL(usedUrl.endsWith("/") ? usedUrl : `${usedUrl}/`).pathname).replace(/\/+$/, "");
      const out = [];
      for (const item of parseProps(xml)) {
        const itemPath = item.href.replace(/\/+$/, "");
        if (!itemPath) continue;
        const rel = relativePath(item.href, basePath);
        const normalized = rel.replace(/\/+$/, "") || "/";
        if (normalized === "/" || normalized === "") continue; // 目录自身
        const name = item.display || normalized.split("/").filter(Boolean).pop() || normalized;
        out.push({
          name,
          path: normalized,
          isDir: item.isDir,
          size: item.size,
          modified: item.modified,
        });
      }
      return out.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, "zh"));
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
      const res = await fetch(joinUrl(base, target), { headers: headers() });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw Object.assign(new Error(`WebDAV 下载失败 ${res.status}${text ? ` ${text.slice(0, 120)}` : ""}`), { status: 502 });
      }
      return {
        stream: res.body,
        size: Number(res.headers.get("content-length") || 0),
        mime: res.headers.get("content-type"),
        encoding: res.headers.get("content-encoding") || "",
      };
    },
  };
}
