// 运行配置：全部来自环境变量，缺省值只够本地开发。
import path from "node:path";

const bool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const base = (process.env.BASE_URL || "http://localhost:1145").replace(/\/+$/, "");

export const config = {
  baseUrl: base,
  port: Number(process.env.PORT || 1145),
  host: process.env.HOST || "0.0.0.0",

  // 文件与数据库都放这里；容器里挂一个 volume
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  distDir: path.resolve(process.env.DIST_DIR || "./dist"),

  // Campux 校园墙 OAuth2（PKCE）
  oauth: {
    issuer: (process.env.OAUTH_ISSUER || "https://gz.campux.top").replace(/\/+$/, ""),
    // 服务端直连 token/userinfo 用的地址：集群内经 Service 访问，绕开公网回环
    apiBase: (process.env.OAUTH_API_BASE || process.env.OAUTH_ISSUER || "https://gz.campux.top").replace(/\/+$/, ""),
    clientId: process.env.OAUTH_CLIENT_ID || "",
    clientSecret: process.env.OAUTH_CLIENT_SECRET || "",
    redirectUri: process.env.OAUTH_REDIRECT_URI || `${base}/memories/oauth/callback`,
    scope: process.env.OAUTH_SCOPE || "profile",
  },

  adminQQ: String(process.env.ADMIN_QQ || "1692138502"),

  // 上传限制（字节）
  limits: {
    userImage: Number(process.env.LIMIT_IMAGE || 250 * 1024 * 1024),
    userVideo: Number(process.env.LIMIT_VIDEO || 10 * 1024 * 1024 * 1024),
    admin: Number(process.env.LIMIT_ADMIN || 10 * 1024 * 1024 * 1024),
  },

  sessionDays: Number(process.env.SESSION_DAYS || 30),
  cookieName: process.env.COOKIE_NAME || "mem_sid",
  secureCookie: bool(process.env.COOKIE_SECURE, base.startsWith("https://")),
  trustProxy: bool(process.env.TRUST_PROXY, true),
};

export const paths = {
  db: path.join(config.dataDir, "memories.db"),
  files: path.join(config.dataDir, "files"),
};
