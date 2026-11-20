// 移动云盘（139）驱动：按 AList 的 139Yun(personal) 协议实现。
//
// 认证有两种给法，任选其一：
//   1) cookie：从 yun.139.com 复制的整段 Cookie（需要含 ORCHES-C-TOKEN 与 ORCHES-I-ACCOUNT-ENCRYPT）
//   2) authorization：请求头里那条 Basic 后面的 base64（形如 pc:<账号>:<令牌>）
//
// 协议要点（与 AList drivers/139 一致）：
//   * 先 POST https://user-njs.yun.139.com/user/route/qryRoutePolicy 拿到个人云的主机名
//     （routePolicyList 里 modName == "personal" 的 httpsUrl）
//   * 之后所有业务请求打在该主机上：POST /file/list、/file/getDownloadUrl、/file/create …
//   * 每个请求带 mcloud-sign: "<ts>,<rand>,<sign>"，sign = MD5(
//       MD5(base64(排序后的 encodeURIComponent(body))) + MD5(ts + ":" + rand) ) 转大写
import { createReadStream } from "node:fs";
import { stat as statFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";

const ROUTE_HOST = "https://user-njs.yun.139.com";
const ROUTE_PATH = "/user/route/qryRoutePolicy";

const md5 = (value) => createHash("md5").update(value).digest("hex");

// 允许出现在请求头里的字符：ASCII 可见字符 + 空格
const HEADER_SAFE = /^[\x20-\x7e]*$/;

const tsNow = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const randStr = () => randomBytes(8).toString("hex");

function calSign(body, ts, rand) {
  const encoded = encodeURIComponent(body);
  const sorted = [...encoded].sort().join("");
  const digest = md5(Buffer.from(sorted, "utf8").toString("base64"));
  return md5(digest + md5(`${ts}:${rand}`)).toUpperCase();
}

function parseCookies(raw) {
  const map = new Map();
  for (const part of String(raw).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    map.set(name, part.slice(index + 1).trim());
  }
  return map;
}

function decodeBase64Text(value) {
  try {
    return Buffer.from(String(value), "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

// 把用户给的东西拆成账号 + 令牌。cookie 里 ORCHES-C-TOKEN 是令牌，
// ORCHES-I-ACCOUNT-ENCRYPT 解出来就是完账号（手机号）。
function credentialsOf(cfg) {
  let authorization = String(cfg.authorization || "").trim();
  let account = String(cfg.username || cfg.account || "").trim();
  let token = String(cfg.token || "").trim();
  let source = authorization ? "authorization" : "";

  if (authorization.toLowerCase().startsWith("basic ")) {
    authorization = authorization.slice(6).trim();
  }

  if (!authorization && cfg.cookie) {
    const jar = parseCookies(cfg.cookie);
    token = token || jar.get("ORCHES-C-TOKEN") || "";
    account = account || decodeBase64Text(jar.get("ORCHES-I-ACCOUNT-ENCRYPT")) || "";
    source = token ? "cookie" : "";
  }

  if (authorization && (!account || !token)) {
    const decoded = decodeBase64Text(authorization);
    const parts = decoded.split(":");
    if (parts.length >= 3) {
      account = account || parts[1];
      token = token || parts.slice(2).join(":");
    }
  }

  if (account && token) authorization = Buffer.from(`pc:${account}:${token}`).toString("base64");

  return { authorization, account, token, source };
}

export function yun139Driver(cfg = {}) {
  const rawCookie = String(cfg.cookie || "");
  // 用户最常见的两种粘贴事故：整段被网页截断（中间出现 …），或粘进了中文。
  if (/[^\x00-\x7f]/.test(rawCookie)) {
    throw Object.assign(
      new Error("Cookie 里出现了省略号「…」或中文，说明复制时被截断了：请重新复制完整的 Cookie（可以长，别手动截）"),
      { status: 400 },
    );
  }
  if (rawCookie && !/ORCHES-C-TOKEN|ORCHES-I-ACCOUNT-ENCRYPT/i.test(rawCookie)) {
    throw Object.assign(
      new Error("Cookie 里没找到 ORCHES-C-TOKEN / ORCHES-I-ACCOUNT-ENCRYPT，请确认复制的是 yun.139.com 的整段 Cookie"),
      { status: 400 },
    );
  }

  const saved = credentialsOf(cfg);
  let authorization = saved.authorization;
  let account = saved.account;
  let token = saved.token;
  const rootFolderId = String(cfg.root_folder_id || "").trim();

  if (!authorization) {
    throw Object.assign(new Error("139 缺少凭据：请填 Cookie，或填请求头里的 authorization"), { status: 400 });
  }
  if (!HEADER_SAFE.test(authorization)) {
    throw Object.assign(
      new Error("139 凭据含有中文或省略号（…），说明复制时被截断了：请重新复制完整的 Cookie / authorization"),
      { status: 400 },
    );
  }

  let host = "";

  const headers = (body, sign) => ({
    accept: "application/json, text/plain, */*",
    authorization: `Basic ${authorization}`,
    caller: "web",
    "cms-device": "default",
    "mcloud-channel": "1000101",
    "mcloud-client": "10701",
    "mcloud-route": "001",
    "mcloud-sign": sign,
    "mcloud-version": "7.14.0",
    "x-deviceinfo": "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||",
    "x-huawei-channelsrc": "10000034",
    "x-inner-ntwk": "2",
    "x-m4c-caller": "PC",
    "x-m4c-src": "10002",
    "x-svctype": "1",
    "x-yun-api-version": "v1",
    "x-yun-app-channel": "10000034",
    "x-yun-channel-source": "10000034",
    "x-yun-client-info": "||13|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||dW5kZWZpbmVk||",
    "x-yun-module-type": "100",
    "x-yun-svc-type": "1",
    "content-type": "application/json",
    ...(body === null ? {} : { "content-length": String(Buffer.byteLength(body)) }),
  });

  const send = async (url, body) => {
    const ts = tsNow();
    const rand = randStr();
    const payload = body === null ? "" : JSON.stringify(body);
    const sign = `${ts},${rand},${calSign(payload, ts, rand)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: headers(body === null ? null : payload, sign),
      body: body === null ? undefined : payload,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok || (data && data.success === false)) {
      const message = data?.message || data?.error_msg || data?.msg || text.slice(0, 200);
      if (/权限|登录|鉴权|失效|过期|unauthorized|forbidden/i.test(String(message)) || res.status === 401 || res.status === 403) {
        throw Object.assign(
          new Error(`139 凭据无效或已过期（${message}）：请到 yun.139.com 重新登录后复制新的 Cookie / Authorization`),
          { status: 502 },
        );
      }
      throw Object.assign(new Error(`139 请求失败（${res.status}）：${message}`), { status: 502 });
    }
    return data;
  };

  const ensureHost = async () => {
    if (host) return host;
    const data = await send(`${ROUTE_HOST}${ROUTE_PATH}`, {
      userInfo: { userType: 1, accountType: 1, accountName: account },
      modAddrType: 1,
    });
    const list = data?.data?.routePolicyList || [];
    const personal = list.find((item) => item.modName === "personal" && item.httpsUrl);
    if (!personal) {
      throw Object.assign(new Error("139 没有返回个人云主机，凭据可能已失效"), { status: 502 });
    }
    host = String(personal.httpsUrl).replace(/\/+$/, "");
    return host;
  };

  const call = async (path, payload) => {
    const base = await ensureHost();
    const data = await send(`${base}${path}`, payload);
    return data?.data ?? data;
  };

  const idOf = (target) => String(target || "").replace(/^\//, "");

  return {
    name: "yun139",

    async list(dir = "/") {
      const parentFileId = dir === "/" ? rootFolderId : idOf(dir);
      const items = [];
      let cursor = "";
      for (let page = 0; page < 200; page += 1) {
        const data = await call("/file/list", {
          imageThumbnailStyleList: ["Small", "Large"],
          orderBy: "updated_at",
          orderDirection: "DESC",
          pageInfo: { pageCursor: cursor, pageSize: 100 },
          parentFileId,
        });
        for (const item of data?.items || []) {
          const isDir = item.type === "folder";
          items.push({
            name: item.name || item.fileName || "",
            path: `/${item.fileId}`,
            fileId: item.fileId,
            isDir,
            size: Number(item.size || 0),
            modified: item.updatedAt || item.createdAt || null,
            thumb: item.thumbnails?.[0]?.url || null,
          });
        }
        cursor = data?.nextPageCursor || "";
        if (!cursor) break;
      }
      return items;
    },

    async stat(target) {
      return { path: target, fileId: idOf(target), isDir: false, size: 0, modified: null };
    },

    async ensureDir() {
      throw Object.assign(new Error("139 暂不支持新建目录"), { status: 501 });
    },

    async download(target) {
      const data = await call("/file/getDownloadUrl", { fileId: idOf(target) });
      const url = data?.cdnUrl || data?.url;
      if (!url) throw Object.assign(new Error("139 没有返回下载地址"), { status: 502 });
      const res = await fetch(url);
      if (!res.ok) throw Object.assign(new Error(`139 下载失败（${res.status}）`), { status: 502 });
      return {
        stream: res.body,
        size: Number(res.headers.get("content-length") || 0),
        mime: res.headers.get("content-type") || "application/octet-stream",
      };
    },

    async write(target, { filePath }) {
      const info = await statFile(filePath);
      const name = String(target).split("/").filter(Boolean).pop();
      const parentFileId = String(target).replace(/\/[^/]+$/, "").replace(/^\//, "") || rootFolderId;

      const hash = createHash("sha256");
      await new Promise((resolve, reject) => {
        createReadStream(filePath)
          .on("data", (chunk) => hash.update(chunk))
          .on("end", resolve)
          .on("error", reject);
      });
      const contentHash = hash.digest("hex").toUpperCase();

      const partSize = info.size > 30 * 1024 ** 3 ? 512 * 1024 ** 2 : 100 * 1024 ** 2;
      const partInfos = [];
      for (let offset = 0, index = 0; offset < info.size; offset += partSize, index += 1) {
        partInfos.push({
          partNumber: index + 1,
          partSize: Math.min(partSize, info.size - offset),
          offset,
        });
      }

      const created = await call("/file/create", {
        parentFileId,
        name,
        type: "file",
        size: info.size,
        fileRenameMode: "auto_rename",
        contentHash,
        contentHashAlgorithm: "SHA256",
        partInfos,
      });
      const fileId = created?.fileId;
      const uploads = created?.partInfos || created?.uploadUrls || [];
      if (!fileId || !uploads.length) {
        throw Object.assign(new Error("139 创建上传任务失败"), { status: 502 });
      }

      for (const part of uploads) {
        const start = Number(part.offset ?? (Number(part.partNumber) - 1) * partSize);
        const length = Number(part.partSize || partSize);
        const res = await fetch(part.uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "content-length": String(length) },
          body: createReadStream(filePath, { start, end: start + length - 1 }),
          duplex: "half",
        });
        if (!res.ok) throw Object.assign(new Error(`139 分片上传失败（${res.status}）`), { status: 502 });
      }

      await call("/file/complete", { fileId, contentHash, contentHashAlgorithm: "SHA256" });
      return { path: `/${fileId}`, size: info.size };
    },

    async rename(target, newName) {
      await call("/file/update", { fileId: idOf(target), name: newName });
      const dir = String(target).replace(/\/[^/]+$/, "");
      return `${dir}/${newName}`;
    },

    async move(target, destinationDir) {
      await call("/file/batchMove", {
        fileIds: [idOf(target)],
        toParentFileId: idOf(destinationDir) || rootFolderId,
      });
      return `${destinationDir}/${String(target).split("/").pop()}`;
    },

    async remove(target) {
      await call("/recyclebin/batchTrash", { fileIds: [idOf(target)] });
      return true;
    },

    async probe() {
      const items = await this.list("/");
      return { host, account, items: items.length };
    },
  };
}
