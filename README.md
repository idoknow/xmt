# 桂林中学新媒体

团委学生会新媒体运营部 · 时光驿客 · Life 摄影社团 的公开站点：<https://xmt.idoknow.top>

纯静态多页站点，无运行时框架：HTML + 一份 CSS + 一份 JS。构建脚本只做哈希指纹、链接校验与预压缩。

站点之外还有一个由同一个进程提供的小服务 **Memories**（校园媒体库，`/memories`）：Node 原生 `http` + `node:sqlite`，零第三方依赖，同时对外提供只读 WebDAV。

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

## Memories（媒体库）

`https://xmt.idoknow.top/memories`。同一个进程提供，数据在 PVC `xmt-data-v2`（40Gi，`/data`：`memories.db` + `files/` + `tmp/uploads/` 分块暂存）。

- 上传上限：成员单张图片 250MB、单个视频 10GB（`LIMIT_IMAGE`/`LIMIT_VIDEO` 可改）；管理员不限类型，上限 10GB（`LIMIT_ADMIN`）。**存储可以各自设「单文件上限」**（后台「存储 → 编辑 → 单文件上限（GB）」），填了就按这个存储的数值执行，填 0 回到上面的默认值——比如某个 WebDAV 只允许 1GB，就给它填 1；移动云盘没那么严，可以留 0 或填更大。超过 4MB 的文件自动走**分块上传**：8MB 一块、4 路并发、进度条显示「已传/总量 · n/m 块 · 并行 k」，中断后再点一次上传会从已传的块接着传（`localStorage` 记 `uploadId` 与已完成块，服务端按 `drive+folder+name+size+user` 指纹找回未完成的会话）。
- 容量：后台「存储」页每行有「容量」「单文件」两列，以及一个「刷新容量」按钮。`local` 与 `webdav` 支持自动获取（本地读磁盘 `statfs`；WebDAV 读 RFC 4331 的 `quota-used-bytes`/`quota-available-bytes`，坚果云、Nextcloud、群晖一般都有），拿到的总量会顺手写进库；不支持的存储（比如移动云盘）可以在「编辑 → 总容量（GB）」里手填，只影响显示。
- 磁盘余量：`local-path` 不校验 claim 大小，实际能写多少取决于节点磁盘（`/data` 所在盘 316GB，留了 59GB 可用）。10GB 视频落盘时需要「暂存块 + 拼好的成品」两份空间，建议长期保持 ≥30GB 空闲。2026-11-21 从旧的 `xmt-data`（5Gi）迁到 `xmt-data-v2`（40Gi）：旧卷连同数据先留着当备份，确认没问题后可 `DELETE /api/v1/namespaces/idoknow/persistentvolumeclaims/xmt-data`。

- 登录：Campux 校园墙 OAuth（PKCE，S256），回调 `https://xmt.idoknow.top/memories/oauth/callback`。**不开放注册**，管理员在后台手动加 QQ（只填号码即可，昵称与头像等他第一次登录时从 Campux 同步，头像按 QQ 号取 `q1.qlogo.cn`）；没开通的 QQ 登录会直接被拒。
- 角色：游客只读（能浏览、能看分享链接）；成员能上传、改名、移动、新建文件夹、删除，但**只能动自己上传的**；管理员不限文件类型、能管存储、管成员、改站点设置。管理员 QQ 由 `ADMIN_QQ` 决定，默认 `1692138502`。
- 每人一个文件夹（`u-<id>/<YYYY-MM>/`）；管理员默认落在 `admin/<YYYY-MM>/`。
- 存储：`local`（容器磁盘）、`webdav`（任意 WebDAV，地址/账号/密码/根目录）、`139`（移动云盘）。后台「存储」页可加多个、可测试连通性；每行的「编辑」改名字/凭据/根目录/可见性，「浏览」直接看该存储里的目录与文件。
- 隐藏目录：在「编辑」里点「选择目录」，从存储里逐层点选要藏的目录（支持加多个、可移除）。隐藏只对成员与游客生效——他们的画廊、详情、直链、分享页里都看不到；管理员始终能看到全部，画廊里会带「已隐藏」角标。
- 139 的凭据两种填法，任选其一：① 整段 `yun.139.com` 的 Cookie（含 `ORCHES-C-TOKEN`、`ORCHES-I-ACCOUNT-ENCRYPT`）。服务端会用它解出账号，并按网页端的规则（AES-128-ECB + 前端常量 `C_ENCRYPT_CODE`）把 `ORCHES-C-TOKEN` 解成接口认可的 `authToken`；② 直接填 `Authorization`（`Basic` + `pc:<账号>:<authToken>` 的 base64）。根目录固定用个人云的 `root`。
- WebDAV 出口：`https://xmt.idoknow.top/memories/dav/`，游客只读（`PROPFIND`/`GET`/`HEAD`）。
- OAuth 凭据不写进仓库：集群 Secret `xmt-memories`（`oauth-client-id`、`oauth-client-secret`、`admin-qq`），也可以在后台「设置」里改，改完写回 settings 表。
- 管理台（AList 风格，左侧栏 + 四个分页）：
  - `/memories/admin/files`：文件管理器。存储标签切换、面包屑进目录，列头可按名称/大小/时间排序；勾选（支持 Shift 连选、点整行切换）后批量移动/复制/下载/删除，批量操作走自绘弹窗（不用浏览器 `prompt`），上传带进度（大文件同样分块 + 续传），单个文件可预览（图片/视频/音频/PDF/文本）、改名、下载。
  - `/memories/admin/storages`：存储列表 + 表单（名称/类型/挂载路径/根路径/可见性/总容量/单文件上限/启用/隐藏目录），可编辑、测试、删除、直接打开，「刷新容量」可让服务端去问存储本身有多大。
  - `/memories/admin/users`：加成员（只填 QQ）、改角色、停用、移除。
  - `/memories/admin/settings`：站点标题与介绍、管理员 QQ、OAuth 凭据。
  - 这些页面只在管理台加载（`assets/css/admin.css` + `assets/js/admin.js`），画廊不背这部分体积。

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
