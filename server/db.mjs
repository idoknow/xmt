// SQLite（node:sqlite，无外部依赖）。表结构随版本号递增做迁移。
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { paths } from "./config.mjs";

mkdirSync(paths.files, { recursive: true });

export const db = new DatabaseSync(paths.db);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

const now = () => new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  qq            TEXT UNIQUE,
  name          TEXT NOT NULL,
  avatar        TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  note          TEXT,
  drive_root    TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ua         TEXT,
  ip         TEXT
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  verifier    TEXT NOT NULL,
  redirect    TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  driver     TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  root       TEXT NOT NULL DEFAULT '/',
  owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'members',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drive_hidden (
  drive_id   INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  prefix     TEXT NOT NULL,
  PRIMARY KEY (drive_id, prefix)
);

CREATE TABLE IF NOT EXISTS drive_public (
  drive_id   INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  prefix     TEXT NOT NULL,
  PRIMARY KEY (drive_id, prefix)
);

CREATE TABLE IF NOT EXISTS media (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_id   INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL,
  ext        TEXT,
  mime       TEXT,
  kind       TEXT NOT NULL DEFAULT 'file',
  size       INTEGER NOT NULL DEFAULT 0,
  width      INTEGER,
  height     INTEGER,
  sha256     TEXT,
  owner_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  taken_at   TEXT,
  note       TEXT,
  tags       TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS media_drive_path ON media(drive_id, path);
CREATE INDEX IF NOT EXISTS media_owner ON media(owner_id);
CREATE INDEX IF NOT EXISTS media_created ON media(created_at DESC);

CREATE TABLE IF NOT EXISTS shares (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,
  target         TEXT NOT NULL,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  allow_download INTEGER NOT NULL DEFAULT 1,
  password_hash  TEXT,
  expires_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action  TEXT NOT NULL,
  target  TEXT,
  at      TEXT NOT NULL,
  ip      TEXT
);

CREATE TABLE IF NOT EXISTS tool_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS software (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  devices    TEXT NOT NULL DEFAULT '',
  size       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  links      TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
`);

/* ---------- 小工具 ---------- */

export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);

/* 轻量迁移：老库升级时补列，已有列就跳过 */
function ensureColumn(table, column, ddl) {
  const columns = all(`PRAGMA table_info(${table})`).map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn("drives", "mount_path", "mount_path TEXT NOT NULL DEFAULT ''");
ensureColumn("drives", "sort_order", "sort_order INTEGER NOT NULL DEFAULT 0");
// 0 表示「不知道 / 跟随全局默认」
ensureColumn("drives", "quota_bytes", "quota_bytes INTEGER NOT NULL DEFAULT 0");
ensureColumn("drives", "max_file_bytes", "max_file_bytes INTEGER NOT NULL DEFAULT 0");
ensureColumn("drives", "description", "description TEXT NOT NULL DEFAULT ''");
ensureColumn("drives", "allow_upload", "allow_upload INTEGER NOT NULL DEFAULT 1");

export const setting = (key, fallback = null) => {
  const row = get("SELECT value FROM settings WHERE key = ?", key);
  return row ? row.value : fallback;
};

export const setSetting = (key, value) =>
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    String(value),
  );

export const audit = (userId, action, target, ip) =>
  run("INSERT INTO audit (user_id, action, target, at, ip) VALUES (?, ?, ?, ?, ?)", userId || null, action, target || null, now(), ip || null);

/* ---------- 首次启动：管理员与本机存储 ---------- */

export function bootstrap(adminQQ) {
  const stamp = now();
  const admin = get("SELECT * FROM users WHERE role IN ('owner', 'admin') LIMIT 1");
  if (!admin) {
    run(
      "INSERT INTO users (qq, name, role, status, drive_root, created_at) VALUES (?, ?, 'owner', 'active', ?, ?)",
      adminQQ,
      "管理员",
      "u-admin",
      stamp,
    );
  }
  // 唯一超级管理员始终绑定 admin.qq；老库里是 'admin' 的一并升级
  run("UPDATE users SET role = 'owner' WHERE role = 'admin' AND qq = ?", String(adminQQ));

  const drive = get("SELECT * FROM drives LIMIT 1");
  if (!drive) {
    run(
      "INSERT INTO drives (name, driver, config, root, visibility, created_at) VALUES (?, ?, '{}', '/', 'members', ?)",
      "本地存储",
      "local",
      stamp,
    );
  }

  if (!setting("site.title")) setSetting("site.title", "Memories");
  if (!setting("site.intro"))
    setSetting(
      "site.intro",
      "Memories 为学生打造专属的校园媒体分享空间，上传、浏览、管理校园照片，让青春的每一帧都被温柔记录。",
    );
  /* OAuth 只写非空值：部署时由 Secret 注入的凭据不该被空记录覆盖 */
  const seed = (key, value) => {
    if (!value) return;
    if (!String(setting(key, "")).trim()) setSetting(key, value);
  };
  seed("oauth.client_id", process.env.OAUTH_CLIENT_ID);
  seed("oauth.client_secret", process.env.OAUTH_CLIENT_SECRET);
  seed("oauth.issuer", process.env.OAUTH_ISSUER || "https://gz.campux.top");
  seed("share.default_days", "7");
}

export { now };
