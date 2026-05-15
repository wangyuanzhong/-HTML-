# Dependencies & environment

供**人工开发者**与**自动化（CI / Cursor Agent 等）**判断：在什么环境下能预览、打包、可选地重建演示用 Excel。

---

## 项目形态

| 项目 | 说明 |
|------|------|
| 类型 | 静态前端：HTML5 + CSS3 + **ES5 风格** vanilla JS |
| 包管理 | **无** `package.json`，**无需** `npm install` 即可浏览模板 |
| 主运行时 | 启用 JavaScript 的现代浏览器 |

---

## 必选：浏览模板

| 依赖 | 说明 |
|------|------|
| 浏览器 | Chromium / Firefox / Safari / Edge 等现行版本均可 |
| 源码 | UTF-8 编码；仓库检出后路径保持完整 |

入口文件（任选其一打开）：

- `competitive-analysis-templates/template-tech.html`
- `competitive-analysis-templates/template-macaron.html`
- `competitive-analysis-templates/template-minimal.html`

核心脚本：`competitive-analysis-templates/assets/matrix-core.js`

---

## 可选：静态 HTTP（仅当 `file://` 不便时）

仓库**不捆绑**任何 Node 服务。**若你已自行安装 Node**，可临时起静态目录，例如：

```bash
npx --yes serve competitive-analysis-templates -p 3000
```

或：

```bash
cd competitive-analysis-templates
python -m http.server 3000
```

（需本机已有对应 Python。**不要**在文档外默认假定 CI 上一定存在 Node/Python。）

---

## 可选：Apache Ant · 打包 `build/dist`

| 依赖 | 用途 |
|------|------|
| [Apache Ant](https://ant.apache.org/) ≥ 1.10 | 执行根目录 **`build.xml`** |

常用命令：`ant verify-layout`、`ant dist`、`ant clean`（详见根目录 **`README.md`**）。

**与预览无关**：不写 Ant、不执行 `dist`，照样可以只打开 HTML 开发。

---

## 可选：Python · 演示用矩阵 Excel

仅在需要**重写**演示数据 **`data/matrix-objective.xlsx`** / **`matrix-subjective.xlsx`** 时：

| 依赖 | 用途 |
|------|------|
| Python 3 | 解释器 |
| [openpyxl](https://openpyxl.readthedocs.io/) | 写 `.xlsx` |

示例（在项目根或 `competitive-analysis-templates` 上一级执行，脚本内路径相对于 `tools/`）：

```bash
pip install openpyxl
python competitive-analysis-templates/tools/build-matrix-xlsx.py
```

业务含义与表格版面见 **`competitive-analysis-templates/README.md`**。

---

## 路径约定（给自动化）

- **工作区根**：与 `build.xml`、`.gitignore`、本文件同级目录。
- **源码树根**：必须为 **`competitive-analysis-templates/`**（勿改名，否则需同步改 `build.xml`）。

---

## 网络

示例 JSON / 演示图可能引用**外链图片**（如 picsum）。完全离线使用前请替换或删掉这些 URL。

---

## 校验清单（Agent 可逐项核对）

1. 目录 **`competitive-analysis-templates/`** 存在。
2. 至少存在上述三个 **`template-*.html`** 之一。
3. 存在 **`competitive-analysis-templates/assets/matrix-core.js`**。
4. 浏览器能加载模板页面；不要求必须起 HTTP。

机器可读同款字段：**`environment.json`**。
