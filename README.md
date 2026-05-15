# vibe-html

竞品分析用 **纯静态 HTML/CSS/JS** 模板：本地用浏览器打开即可预览，**不依赖 Node 打包**。可选使用 **Apache Ant** 把源码目录打成 **`build/dist`** 便于上传静态站或发 zip。

---

## 仓库里有什么

| 路径 | 说明 |
|------|------|
| `competitive-analysis-templates/` | 三套主题入口 `template-*.html`、`assets/`、`themes/`、`data/`、`tools/` |
| `competitive-analysis-templates/README.md` | 模板数据 JSON 结构、幻灯顺序、Excel / xlsx 版面说明（**改内容请优先读这份**） |
| `build.xml` | Ant：将 `competitive-analysis-templates` 复制到 `build/dist/` |
| `DEPENDENCIES.md` | 运行与构建依赖（给人 + 给 CI/Agent） |
| `environment.json` | 与 `DEPENDENCIES.md` 对应的机器可读摘要 |

---

## 本地预览（必选：只有浏览器）

1. 直接用 **Chrome / Edge / Firefox** 打开：  
   `competitive-analysis-templates/template-tech.html`（或 `template-macaron.html`、`template-minimal.html`）。
2. 只改数据且不动结构时：编辑对应 HTML 里 `<script id="deck-data">` 内的 JSON（字段说明见子目录 `README.md`）。

个别环境对 `file://` 限制较多；若遇阻，用任意静态服务器指向 `competitive-analysis-templates` 即可（示例见 `DEPENDENCIES.md`，**不是**仓库硬性依赖）。

---

## 云端：白盒（自动回归）+ 黑盒（你手动点）

| 能力 | 说明 |
|------|------|
| **白盒** | 合并进 `main` 的 PR 与 `main` 本仓库会跑 **GitHub Actions**（`.github/workflows/ci.yml`）：**Playwright** 打开三套模板，校验 DOM、无未捕获 `pageerror`，并走「封面 → 概述 → 客观矩阵」导航。本地：`npm ci` 后 `npm run test:e2e`。 |
| **黑盒** | **GitHub Pages**（`.github/workflows/pages.yml`，Actions 里显示为 **「Publish GitHub Pages」**）：每次推送到 `main`（或手动运行该 workflow）会把 `competitive-analysis-templates/` 发布到站点根目录。根路径提供 **`index.html`**（入口列表）；三套模板仍可直链 **`…/template-tech.html`** 等。在仓库 **Settings → Pages** 将 **Source** 设为 **GitHub Actions** 后，用浏览器打开站点即可手动操作（矩阵、弹层、编辑模式等）。公开仓库下该 URL 通常对互联网可读；若需非公开预览，请改用带访问控制的静态托管或内网部署。 |

**黑盒：站点地址去哪找（没有叫「Deploy Pages」的菜单是正常的）**

1. **站点 URL 最稳**：仓库 **Settings（设置）→ Pages（页面）**，在 **Build and deployment** 下方会看到 **Visit site** 或 **Your site is live at `https://…`**。这是 GitHub 官方展示 Pages 地址的位置。
2. **Actions 里对应什么名字**：顶部 **Actions**，左侧或 **All workflows** 列表里找 **「Publish GitHub Pages」**（不是左侧单独一项「Deploy Pages」；GitHub 没有这个固定子菜单）。
3. **若列表里根本没有「Publish GitHub Pages」**：多半是 **含 `.github/workflows/pages.yml` 的改动还没合并进默认分支 `main`**。只有 `main` 上已有该文件时，左侧栏才会长期出现这条 workflow，且 `Run workflow` 手动运行才可用；请先合并相关 PR，或把该 workflow 直接推到 `main` 并再进 Actions 查看。
4. **可选**：在 Actions 里点开最近一次 **绿色成功** 的「Publish GitHub Pages」运行，在 **Summary** / **deploy** job 旁有时会看到 **github-pages** 环境的链接，与 Settings → Pages 的地址一致。

如需 **每个 PR 一条独立预览链接**（不合并也能在云端点），可在同一静态目录上接 **Netlify / Cloudflare Pages / Vercel** 的 PR Preview（需在对应平台连接仓库并配置，本仓库未内置）。

---

## 构建与产物（可选：Ant）

**前提**：已安装 [Apache Ant](https://ant.apache.org/)，且 `ant` 在 `PATH` 中。

| 命令 | 作用 |
|------|------|
| `ant` 或 `ant info` | 打印项目说明 |
| `ant verify-layout` | 检查 `competitive-analysis-templates/` 是否存在 |
| `ant dist` | 先 `clean`，再整目录复制到 **`build/dist/`**（可用于 zip / 静态托管） |
| `ant clean` | 删除 `build/` |

**说明**：`dist` 每次会先清空 `build/`，保证产物可复现。复制时会排除明显垃圾文件（见 `build.xml` 内 `<exclude>`）。

打包前请确认根目录 **`.gitignore`** 已就位，避免把构建产物或个人垃圾提交进 Git。

---

## 与 Git 上传相关

- **`build/`**：构建输出，已在 `.gitignore` 中忽略，**不要提交**。
- **依赖与工具链**：以 `DEPENDENCIES.md` / `environment.json` 为准。
- 模板业务细节、DOM id 约定、`matrix` schema：以 **`competitive-analysis-templates/README.md`** 为准。

---

## 延伸阅读

- **`DEPENDENCIES.md`** — 浏览器、Ant、Python（仅生成演示 xlsx 时需要）等逐项说明。
- **`competitive-analysis-templates/README.md`** — 幻灯结构、矩阵、导入导出 JSON、xlsx 工作表版面。
