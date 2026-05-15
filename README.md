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
