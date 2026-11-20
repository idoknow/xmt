# 桂林中学新媒体

团委学生会新媒体运营部 · 时光驿客 · Life 摄影社团 的公开站点：<https://xmt.idoknow.top>

纯静态多页站点，无运行时框架：HTML + 一份 CSS + 一份 JS。构建脚本只做哈希指纹、链接校验与预压缩。

站点之外还有一个由同一个进程提供的小服务 **Memories**（校园图片库，`/memories`）：Node 原生 `http` + `node:sqlite`，零第三方依赖，同时对外提供只读 WebDAV。

## 目录

```
site/                 源文件（可直接读、可直接用浏览器打开）
  index.html          首页
  orgs.html           组织
  media.html          媒体资源
  cloud.html          云上桂中（入口页：把外部地址集中摆在一处）
  404.html            未找到
  assets/css/style.css      站点样式
  assets/css/app.css        Memories 样式
  assets/js/site.js         交互：滚动进入、复制、年份、配色菜单、语言菜单
  assets/js/app.js          Memories 前端：视图、多选、上传、后台
  assets/i18n/*.json        各语言词条（键是中文原句，值是译文）
  assets/fonts/newsreader-latin.woff2
  assets/img/*.webp
server/               Memories 服务端（node server/index.mjs）
  index.mjs           路由：站点静态、/memories 页面与 API、只读 WebDAV
  config.mjs db.mjs util.mjs multipart.mjs auth.mjs imgsize.mjs
  drives.mjs media.mjs ui.mjs
  drivers/{local,webdav,yun139}.mjs   存储驱动
scripts/build.mjs     构建：指纹、链接校验、预压缩，产出 dist/
scripts/serve.mjs     本地预览（干净路径 + 缓存头）
deploy/k8s/*.json     Deployment / Service / Ingress / PVC 清单
deploy/apply.mjs      把上面几份清单幂等地应用进集群
deploy/rollout.mjs    CI 用：切镜像、等滚动完成、再验公网
Dockerfile            node:24-alpine，跑 server/index.mjs
```

## 本地

```bash
npm run build              # 产出 dist/
node scripts/serve.mjs     # 预览 dist/，默认 4173
node scripts/serve.mjs site # 直接预览源文件

npm start                  # 起完整服务（站点 + Memories），默认 1145
PORT=1200 DATA_DIR=./data npm start
```

## 改内容

页面文案、组织条目、链接都在 `site/*.html` 里，一行一个，不用碰构建脚本。

- 加一个组织：`site/orgs.html` 复制一节 `entry`，同时 `site/index.html` 加一张 `org` 卡片。
- 换标识图：把横向长方形图放进 `site/assets/img/`，改 `<img src>`；白底图会靠 `mix-blend-mode: multiply` 融进纸色，深色底图直接显示。
- 补链接：`site/media.html` 里把「待上线」那行改成 `<a>`，`<span class="link__meta">` 跟着改。移动云盘按学期/活动分多个分享，每个分享一行（`data-copy` 放提取码）；官方账号在 C 组，抖音有成卡片的 `.account` 区块（二维码图放 `assets/img/douyin-qr.webp`）。
- 云上桂中：`site/cloud.html` 只是入口页，外部地址确定后把对应行的 `.link-row--muted` 去掉、`href` 换成真地址。
- 改完提交推 `main`，CI 会自动构建发布，约两三分钟。

## 部署

推 `main` → GitHub Actions 三段：构建 `dist/` → 构建并推 `ghcr.io/idoknow/xmt:sha-<commit>` → 切集群镜像并等就绪、再从公网校验。

集群位置：Rancher 的 `local` 集群（k3s），命名空间 `idoknow`，Pod 固定在香港节点 `cn-hk-fxy-01`（有两条 NoSchedule 要求，Deployment 里已带 tolerations）。Ingress class `hongkong`，入口 LB `38.39.30.208`，TLS 用现有 `wildcard-idoknow-top-tls`。

需要的仓库 Secrets（Settings → Secrets and variables → Actions）：

| 名称 | 说明 |
| --- | --- |
| `K8S_TOKEN` | Rancher 的 Bearer Token（`token-xxxx:yyyy`） |
| `K8S_BASE` | `https://rancher.rockchin.top/k8s/clusters/local` |

Token 只在 `idoknow` 命名空间有权限，够用：Deployment、Service、Ingress、Pod 都在这个范围里。

手工操作（本机需要同样的两个环境变量）：

```bash
node deploy/apply.mjs     # 首次或改了 k8s 清单
node deploy/rollout.mjs   # 只切镜像并校验
```

## Memories（图片库）

`https://xmt.idoknow.top/memories`。同一个进程提供，数据在 PVC `xmt-data`（`/data`：`memories.db` + `files/`）。

- 登录：Campux 校园墙 OAuth（PKCE，S256），回调 `https://xmt.idoknow.top/memories/oauth/callback`。**不开放注册**，管理员在后台手动加 QQ；没开通的 QQ 登录会直接被拒。
- 角色：游客只读（能浏览、能看分享链接）；成员能上传、改名、移动、新建文件夹、删除，但**只能动自己上传的**；管理员不限文件类型、能管存储、管成员、改站点设置。管理员 QQ 由 `ADMIN_QQ` 决定，默认 `1692138502`。
- 每人一个文件夹（`u-<id>/<YYYY-MM>/`）；管理员默认落在 `admin/<YYYY-MM>/`。
- 存储：`local`（容器磁盘）、`webdav`（任意 WebDAV，地址/账号/密码/根目录）、`139`（移动云盘，`authorization` 填网页版抓到的 `pc:<账号>:<token>` 的 base64）。后台「存储」页可加多个、可测试连通性。
- WebDAV 出口：`https://xmt.idoknow.top/memories/dav/`，游客只读（`PROPFIND`/`GET`/`HEAD`）。
- OAuth 凭据不写进仓库：集群 Secret `xmt-memories`（`oauth-client-id`、`oauth-client-secret`、`admin-qq`），也可以在后台「设置」里改，改完写回 settings 表。

```bash
node .tmp/cluster-prep.mjs   # 建 Secret 与 PVC（一次性；脚本里带 token，别提交）
```

## 域名

`xmt.idoknow.top` 是 Cloudflare 里一条独立的 `A` 记录，指向 `38.39.30.208`（不代理、TTL 300）。
必须有这条记录：zone 里还有个 `*.idoknow.top → 45.137.180.156` 的通配记录，缺了这条独立记录，请求会落到另一台机器上。

## 多语言与配色

配色三态：跟随系统 / 浅色 / 深色，页头右侧的下拉菜单里选，选择存 `localStorage` 的 `xmt-theme`。深色只换墨色，纸色底版留给图片（白底标识用 `mix-blend-mode: multiply` 融进 `--tile`，暗色下不乱）。也可以用 `?theme=dark`、`?theme=light` 直接看。

语言同理：`assets/js/site.js` 会给页头装一个语言菜单（和配色一样是下拉），选完存 `xmt-lang`，也可以用 `?lang=en` 分享链接。窄屏下品牌名会省略，两个工具按钮始终留在第一行；菜单会被夹在视口内，不会被屏幕边缘切掉。词条在 `assets/i18n/<code>.json`：

```json
{ "code": "en", "notice": "……", "map": { "首页": "Home", "组织": "Organisations" } }
```

- 键是**页面上的中文原句**（按空白折叠后逐字匹配），值是译文；匹配不到就保持中文，所以可以只翻一半。
- 当前是「界面全译、正文待译」：`notice` 一句话说明正文仍是中文，渲染在页头导语下面。英文另有正文兜底，缺词条会先找 `en.json`。
- 加一门语言：在 `site.js` 的 `LOCALES` 里加一行（`code`/`name`/`dir`），再建对应 json；RTL 语言把 `dir` 写成 `rtl`，页面会自动镜像。
- 现有：简体、繁體、English、日本語、한국어、Русский、Français、Deutsch、Español、العربية、हिन्दी、བོད་ཡིག、Монгол、ئۇيغۇرچە、Vahcuengh（后四种只译了导航与常用词）。

## 字体

标题用衬线（中文宋体族 + 自托管 Newsreader 变量字体，57KB Latin 子集），正文用系统黑体族，数字与英文小标签用等宽。
不加载中文字体包，避免几百 KB 的下载；中文标题在 macOS 上落 Songti SC、Windows 上落 SimSun/思源宋体。
