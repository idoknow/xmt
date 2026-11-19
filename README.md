# 桂林中学新媒体

团委学生会新媒体运营部 · 时光驿客 · Life 摄影社团 的公开站点。

纯静态多页站点，无运行时框架：HTML + 一份 CSS + 一份 JS，构建脚本只做哈希指纹、链接校验与预压缩，产物由 nginx 直接托管。

## 目录

```
site/                 源文件（直接可读、可直接打开）
  index.html          首页
  orgs.html           组织
  media.html          媒体资源
  cloud.html          云上桂中
  404.html            未找到
  assets/css/style.css
  assets/js/site.js
  assets/fonts/newsreader-latin.woff2
  assets/img/*.webp
scripts/build.mjs     构建：指纹、校验、生成 dist 与 .gz
deploy/apply.mjs      集群对象（Deployment / Service / Ingress）幂等应用
deploy/rollout.mjs    CI 用：切镜像并等就绪
nginx.conf            静态站托管配置（gzip_static、缓存、安全头）
Dockerfile            构建产物 → nginx:alpine
```

## 字体

标题用衬线（中文宋体族 + 自托管 Newsreader 变量字体），正文用系统黑体族，
数字与英文小标签用等宽。不加载中文字体包，避免几百 KB 的下载。

## 本地

```bash
npm run build        # 产出 dist/
node scripts/serve.mjs   # 可选：本地起一个静态服务
```

## 部署

推 `main` 即触发 GitHub Actions：构建 → 推 `ghcr.io/idoknow/xmt` → PATCH 集群 Deployment 并等 Pod 就绪。

需要的仓库 Secrets：

| 名称 | 说明 |
| --- | --- |
| `K8S_TOKEN` | Rancher 的 Bearer Token（`token-xxx:secret`） |
| `K8S_BASE` | 形如 `https://rancher.rockchin.top/k8s/clusters/local` |

站点：<https://xmt.idoknow.top>（香港节点，Ingress class `hongkong`）。
