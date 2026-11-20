// 驱动注册表：数据库里的 drive 记录 → 具体驱动实例（带缓存）
import path from "node:path";
import { paths } from "./config.mjs";
import { localDriver } from "./drivers/local.mjs";
import { webdavDriver } from "./drivers/webdav.mjs";
import { yun139Driver } from "./drivers/yun139.mjs";

export const DRIVERS = {
  local: {
    label: "本地存储",
    hint: "文件存在服务器磁盘上，最简单也最快。",
    fields: [
      { key: "base", label: "存储目录", placeholder: "留空 = data/files/drive-<id>" },
    ],
    build: (cfg, drive) => localDriver({ root: cfg.base || path.join(paths.files, `drive-${drive.id}`) }),
  },
  webdav: {
    label: "WebDAV",
    hint: "坚果云、Nextcloud、群晖、Alist 挂载出来的 WebDAV 都可以。",
    fields: [
      { key: "address", label: "服务地址", placeholder: "https://dav.example.com/dav", required: true },
      { key: "username", label: "用户名" },
      { key: "password", label: "密码", type: "password" },
      { key: "root", label: "根路径", placeholder: "/" },
    ],
    build: (cfg) => webdavDriver({ address: cfg.address, username: cfg.username, password: cfg.password, root: cfg.root || "" }),
  },
  yun139: {
    label: "移动云盘 139",
    hint: "填 Authorization（pc:<账号>:<token>），或账号密码让它自己换。",
    fields: [
      { key: "authorization", label: "Authorization", type: "password" },
      { key: "username", label: "手机号/账号" },
      { key: "password", label: "密码", type: "password" },
      { key: "root_folder_id", label: "根目录 ID", placeholder: "留空 = 根目录" },
      { key: "type", label: "类型", placeholder: "personal_new" },
    ],
    build: (cfg) => yun139Driver(cfg),
  },
};

const cache = new Map();

export function driverFor(drive) {
  const spec = DRIVERS[drive.driver];
  if (!spec) throw Object.assign(new Error(`未知驱动：${drive.driver}`), { status: 400 });
  let cfg = {};
  try {
    cfg = JSON.parse(drive.config || "{}");
  } catch {}
  const key = JSON.stringify(cfg) + drive.id;
  const hit = cache.get(drive.id);
  if (hit && hit.key === key) return hit.instance;
  const instance = spec.build(cfg, drive);
  cache.set(drive.id, { key, instance });
  return instance;
}

export const forgetDriver = (driveId) => cache.delete(driveId);
