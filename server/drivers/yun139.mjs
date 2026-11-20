// 移动云盘（139）驱动：按 AList 的 139Yun(personal_new) 接口实现。
// 说明：签名头 mcloud-sign 的算法在不同客户端版本间有差异，这里沿用 AList 的
// ts,rand,md5(ts+rand+token) 形式；如果服务端返回签名错误，把 authorization 换成
// 网页端抓到的完整值即可（详见 README）。
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

const ROUTE_HOST = "https://user-njs.yun.139.com";
const AUTH_REFRESH = "https://aas.caiyun.feixin.10086.cn:443/tellin/authTokenRefresh.do";

const md5 = (value) => createHash("md5").update(value).digest("hex");

export function yun139Driver(cfg = {}) {
  let authorization = cfg.authorization || "";
  const account = cfg.username || "";
  let token = cfg.token || "";
  const rootFolderId = cfg.root_folder_id || "";
  const kind = cfg.type || "personal_new";
  let host = cfg.host || ROUTE_HOST;

  const parseAuth = () => {
    if (!authorization) return;
    // 形如 pc:<account>:<token> 的 base64
    try {
      const decoded = Buffer.from(authorization, "base64").toString("utf8");
      const parts = decoded.split(":");
      if (parts.length >= 3) {
        account = account || parts[1];
        token = token || parts.slice(2).join(":");
      }
    } catch {}
  };
  parseAuth();

  const sign = () => {
    const ts = String(Date.now());
    const rand = randomUUID().replace(/-/g, "").slice(0, 16);
    return `${ts},${rand},${md5(ts + rand + token)}`;
  };

  const refresh = async () => {
    if (!account || !token) return false;
    const body = `<root><token>${token}</token><account>${account}</account><clienttype>656</clienttype></root>`;
    const res = await fetch(AUTH_REFRESH, {
      method: "POST",
      headers: { "content-type": "application/xml", accept: "application/json" },
      body,
    });
    const text = await res.text();
    const newToken = /<token>([^<]+)<\/token>/.exec(text)?.[1];
    if (!newToken) throw Object.assign(new Error(`139 令牌刷新失败：${text.slice(0, 200)}`), { status: 502 });
    token = newToken;
    authorization = Buffer.from(`pc:${account}:${token}`).toString("base64");
    return true;
  };

  const call = async (name, payload, { retry = true } = {}) => {
    const res = await fetch(`${host}/file/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization,
        "mcloud-sign": sign(),
        "mcloud-channel": "1000101",
        "mcloud-client": "10701",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    if (retry && (res.status === 401 || /token/i.test(text) && /(invalid|expired|过期)/i.test(text))) {
      if (await refresh()) return call(name, payload, { retry: false });
    }
    if (!res.ok || (data && data.success === false)) {
      const message = data?.message || data?.msg || text.slice(0, 200);
      throw Object.assign(new Error(`139 ${name} 失败（${res.status}）：${message}`), { status: 502 });
    }
    return data?.data ?? data;
  };

  const fileIdOf = (relPath) => {
    // 逻辑路径 → 文件 ID 需要逐级查；这里一次性查父目录列表缓存
    return relPath;
  };

  return {
    name: "yun139",

    async list(dir = "/") {
      const parentFileId = dir === "/" ? rootFolderId : String(dir).replace(/^\//, "");
      const items = [];
      let cursor = "";
      for (let page = 0; page < 50; page += 1) {
        const data = await call("list", {
          parentFileId,
          pageInfo: { pageCursor: cursor, pageSize: 100 },
          orderBy: "updated_at",
          orderDirection: "DESC",
        });
        const list = data?.list || data?.items || [];
        for (const item of list) {
          items.push({
            name: item.name || item.fileName,
            path: `/${item.fileId}`,
            isDir: item.type === "folder" || item.isFolder,
            size: Number(item.size || 0),
            modified: item.updatedAt || item.updateTime || null,
          });
        }
        cursor = data?.nextPageCursor || data?.pageInfo?.nextPageCursor || "";
        if (!cursor) break;
      }
      return items;
    },

    async stat(target) {
      return { path: target, isDir: false, size: 0, modified: null };
    },

    async ensureDir() {
      throw Object.assign(new Error("139 暂不支持新建目录"), { status: 501 });
    },

    async download(target) {
      const data = await call("getDownloadUrl", { fileId: String(target).replace(/^\//, "") });
      const url = data?.cdnUrl || data?.url;
      if (!url) throw Object.assign(new Error("139 没有返回下载地址"), { status: 502 });
      const res = await fetch(url);
      if (!res.ok) throw Object.assign(new Error(`139 下载失败 ${res.status}`), { status: 502 });
      return { stream: res.body, size: Number(res.headers.get("content-length") || 0), mime: res.headers.get("content-type") };
    },

    async write(target, { filePath }) {
      const info = await stat(filePath);
      const sha256 = createHash("sha256");
      await new Promise((resolve, reject) => {
        createReadStream(filePath)
          .on("data", (chunk) => sha256.update(chunk))
          .on("end", resolve)
          .on("error", reject);
      });
      const parentFileId = String(target).replace(/\/[^/]+$/, "").replace(/^\//, "") || rootFolderId;
      const name = String(target).split("/").filter(Boolean).pop();
      const partSize = info.size > 30 * 1024 ** 3 ? 512 * 1024 ** 2 : 100 * 1024 ** 2;
      const partInfos = [];
      for (let offset = 0, index = 0; offset < info.size; offset += partSize, index += 1) {
        partInfos.push({ partNumber: index + 1, partSize: Math.min(partSize, info.size - offset), offset });
      }
      const created = await call("create", {
        parentFileId,
        name,
        type: "file",
        size: info.size,
        fileRenameMode: "auto_rename",
        contentHash: sha256.digest("hex").toUpperCase(),
        contentHashAlgorithm: "SHA256",
        partInfos,
      });
      const fileId = created?.fileId;
      if (!fileId) throw Object.assign(new Error("139 创建上传任务失败"), { status: 502 });

      const uploadUrls = created?.uploadUrls || created?.partInfos || [];
      for (const part of uploadUrls) {
        if (!part.uploadUrl) continue;
        const start = Number(part.offset || 0);
        const length = Number(part.partSize || partSize);
        const res = await fetch(part.uploadUrl, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream", "content-length": String(length) },
          body: createReadStream(filePath, { start, end: start + length - 1 }),
          duplex: "half",
        });
        if (!res.ok) throw Object.assign(new Error(`139 分片上传失败 ${res.status}`), { status: 502 });
      }

      await call("complete", { fileId, contentHash: sha256.digest("hex").toUpperCase(), contentHashAlgorithm: "SHA256" });
      return { path: `/${fileId}`, size: info.size };
    },

    async rename(target, newName) {
      await call("update", { fileId: String(target).replace(/^\//, ""), name: newName });
      const dir = String(target).replace(/\/[^/]+$/, "");
      return `${dir}/${newName}`;
    },

    async move(target, destinationDir) {
      await call("batchMove", {
        fileIds: [String(target).replace(/^\//, "")],
        toParentFileId: String(destinationDir).replace(/^\//, "") || rootFolderId,
      });
      return `${destinationDir}/${String(target).split("/").pop()}`;
    },

    async remove(target) {
      await call("batchTrash", { fileIds: [String(target).replace(/^\//, "")] });
      return true;
    },

    async probe() {
      await call("list", { parentFileId: rootFolderId, pageInfo: { pageCursor: "", pageSize: 1 } });
      return true;
    },

    get kind() {
      return kind;
    },
  };
}
