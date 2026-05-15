# 竞品分析 HTML 模板套件

三套独立视觉主题（科技风 / 马卡龙 / 简约大气），共用同一套幻灯逻辑与数据结构。定位为「可讲演 / 汇报」的单文件 HTML：**打开浏览器即可展示**，内容由内嵌 JSON 驱动，便于后续聊天机器人按字段批量填充。

---

## 文件地图

| 路径 | 作用 |
|------|------|
| `template-tech.html` | 深色科技霓虹风 |
| `template-macaron.html` | 马卡龙圆角可爱风 |
| `template-minimal.html` | 留白衬线极简风 |
| `assets/matrix-core.js` | 幻灯切换、矩阵渲染、行列筛选、弹层、可选加载 xlsx |
| `themes/layout.css` | 版面 / 表格 / 弹层结构（三套共用） |
| `themes/theme-*.css` | 各自配色与字体 |
| `data/matrix-objective.xlsx` | 客观矩阵数据源（可被页面 fetch，覆盖 JSON 里的 `matrix`） |
| `data/matrix-subjective.xlsx` | 主观矩阵数据源（运行时写进 `deck.matrixSubjective`） |
| `tools/build-matrix-xlsx.py` | 按科技风向量重建两份矩阵 xlsx |
| `assets/sheetjs.full.min.js` | SheetJS · 前端解析 `.xlsx` |
| `README.md` | 给人 + 给 AI 的说明（本文件） |

使用方式（矩阵同步）：  

1. **直接打开**：双击打开 `template-*.html`。页面加载后底部有 **载入条**，把 **`matrix-objective.xlsx` / `matrix-subjective.xlsx` 拖进浏览器任意处**，或点「载入 xlsx」选择文件——**保存表格后刷新或再次拖入**即可同步，**不一定要开本地服务器**。（若在 `http(s)` 下且能访问相对路径文件，会先尝试自动 `fetch` `data/*.xlsx`。）  

2. 内嵌 JSON 里的 `matrix` 仍会在「未载入 xlsx / 载入失败」时作为占位。

离线使用请先删除或替换表格与 JSON 里外链图片引用。

---

## Excel 矩阵表（主观 / 客观 · **版面与网页一致**）

默认文件（可被 `<html data-matrix-objective-xlsx="" …>` / `…subjective…` 覆盖；设为空字符串可关闭自动 `fetch`）：

- `data/matrix-objective.xlsx` → Slide 2（客观）  
- `data/matrix-subjective.xlsx` → Slide 3（主观，写入运行时 `deck.matrixSubjective`）

### 工作表 **`网页矩阵`**（主表）

- **第 1 行**：`A1`=左上角文案；`B` 起=产品上表头（与网页 thead 一致）  
- **第 2 行**：`A` 留空；`B` 起=内部 **列 id**（如 `p1`），不要随意改名以便与筛选、`cells` 键一致  
- **第 3 行起**：`A`=左侧对比项；`B` 起=格内 **摘要**

### **`详情`**（可选）

与 **`网页矩阵`** 共用前两行（`A1` 角标、`B…` 产品名、`A2` 空、`B…` **列 id**）。自首个对比项数据行起，**每项占连续两行**：

- **第一行**：`A` = 该行对比项名称（建议与 `网页矩阵` 左列一致）；`B…` = 弹窗文字。若以 `<` 开头则按 **HTML**；否则纯文本，两段之间用**空行**分隔。  
- **第二行**：`A` 可写「（图路径）」或留空；`B…` = **图片路径**（推荐相对页面，如 `images/detail/p1-price.png`，或任意浏览器可请求的 URL）。放空则无图。

**何时生效**：「详情」在表头下的行数 ≥ 对比项行数 ×2 时用双行解析；否则会退化为旧版「**一行一格**」整段 HTML / 全文，以兼容尚未改版的表格。

不需要弹窗时整页可删；不写图就只填第一行也可（第二行行格留空）。

维护方式：**只改一张 `网页矩阵` 就能得到与网页相同的网格**。多一个对比项时 `详情` 须多 **两行**（文 + 路径）。多一列产品时两表同步加 `B…` 列。

- **行内部 id**：从 xlsx **载入运行时**会为每个非空的左侧对比项行按**自上而下顺序**自动生成 `row_0001`、`row_0002`…（与左列文案内容无关）。
- **列内部 id**：请写在 **第 2 行** `B2` 起的 token（如 `p1`）；若整行不符合规则则省略该行，运行时按从左到右自动生成 `p1`、`p2`…。
- **仍兼容**：旧版多分表 `Meta`、`Rows`、`Columns`、`Cells`。

```bash
python tools/build-matrix-xlsx.py   # 按科技风向量重写两份演示 xlsx
```

---

## 页面结构（五页讲演流）

固定顺序（勿改 DOM id，聊天机器人只做数据替换更安全）：

1. **Slide 0 — 封面**：`cover.*`（眉标、主标题、副标题可空）
2. **Slide 1 — 概述**：`overview`（`overview.title` 可空则隐藏页内二级标题）
3. **Slide 2 — 竞品对比矩阵（客观）**：优先由 `matrix-objective.xlsx`（或仍为 JSON `matrix`）驱动
4. **Slide 3 — 竞品对比矩阵（主观）**：优先由 `matrix-subjective.xlsx` 驱动的独立 `deck.matrixSubjective`；若未抓取到主观表，则用客观矩阵的同构深拷贝占位
5. **Slide 4 — 结束页**：`ending`；**客观/主观** 两页将 `#compare-fab-host` 挂到页内 `#compare-fab-anchor-*`，与 `.slide-actions` 同一底栏；其它页停靠 `#compare-fab-park`

---

## `#deck-data` JSON Schema（必读）

整块 JSON 放在：

```html
<script id="deck-data" type="application/json">
{ ... }
</script>
```

根对象字段：`theme`，`cover`，`overview`，`matrix`，**`ending`**（结束页，对应 **Slide 4**，索引 `4`）。`matrix.columns` 用于生成 **thead 表头行**（左上角 `cornerLabel` + 各型号 `th`）；**表头这一行不会从 DOM 消失**，只是当某型号列被勾选隐藏时，该行里对应的表头格与下方单元格一并折叠。`matrix.rows` 为对比维度，**每一条**都可勾选显示或隐藏；`matrix.columns` 同理。若以 **JSON** 手写，各项需含稳定 **`id`**，`cells` 键为 **`"行id::列id"`**。若页面成功从 **`网页矩阵`** xlsx 覆盖数据，运行时会把行 id 生成为 `row_0001…`（见上文），并以第 2 行或自动 `p*` 作为列 id。**单元格详情弹层**：`detailHtml` 在主面板展示；单层背衬与主题顶边线（`.modal-sheet-wrap` / `#modal-shell`，见 `layout.css`）。

详见各 HTML 文件顶部注释与各字段说明：`summary` → 表格内；`detailHtml` → 弹层。

---

## 切换视觉主题

直接使用对应 `template-*.html`；或复制 HTML 后替换外链 `theme-*.css`，并把 JSON 顶层 `theme` 同步为 `'tech'` / `'macaron'` / `'minimal'`。

---

## 常见问题

### 幻灯「下一页」点了没反应，或三页能一起往下滚

根本原因常有两类：

1. **不要在同一标签上重复写同名 `data-*`**（如两个 `data-slide-go`）；否则目标页会变成 `NaN`/0，`goSlide` 不起作用。
2. **不要被 CSS 盖住 `hidden`**：`[data-slide]{ display:flex }` 若没有配套规则，会盖掉 `[hidden]` 的默认隐藏，浏览器会把三页都排开。本项目已在 `themes/layout.css` 增加 `[data-slide][hidden]{ display:none !important; }`，并限制 `body.deck { overflow:hidden }`、`deck-stage` 仅一屏高，观感接近 **PPT 单页讲演**。

翻页还支持键盘：**← / ↑ / PageUp** 上一页，**→ / ↓ / PageDown** 下一页（矩阵 **单元格详情**、**对比报告大卡**打开时不抢翻页键；**Esc** 依次为对比报告大卡 → 单元格详情 → 退出表格点选模式）。

---

## 给聊天机器人的操作守则（可复制）

```
工作目录：competitive-analysis-templates/
目标文件：template-minimal.html（或 tech / macaron）
优先只改：<script id="deck-data"> 内的 JSON
避免改动：`#compare-fab-park` / `#compare-fab-anchor-objective` / `#compare-fab-anchor-subjective` / `#filter-deck` / `#filter-deck-sub` / `#matrix-*` / `#comparison-table` / `#comparison-table-sub` / `compare-fab-host` / `compare-launch-btn` / `#compare-report-modal*` 等 DOM id；`matrix-core.js` 文件名与路径
新增对比行：若以 **JSON** 写死数据，仍为 matrix.rows.push(...)，并为每个 columns[].id 写 cells["行id::列id"]；若以 **xlsx** 为准，载入后行列 id 由表结构决定（行 id 如上 auto）
结束页：顶层 `ending`: { "eyebrow","title","bodyHtml" }（对应第 5 页，索引 4）
调试：控制台执行 __matrixDeckReload()
```

---

## 实现对照

| 需求 | 实现位置 |
|------|----------|
| 多层嵌套内容 | `overview.sections[].bodyHtml`、`detailHtml` |
| 五页幻灯（含结束页） | `[data-slide-index="0–4"]`、`ending` 字段、`renderEnding()` |
| 可筛选行列（胶囊高亮，无系统蓝勾） | `#filter-deck` / `#filter-deck-sub`、`hidden`、`layout.css` `.filter-chip:has()` |
| 表头行常驻、行列可勾选 | thead 不参与筛选 UI；勾选控制 tbody 行与各产品列，`applyFilters` 同步表头格子 |
| 大号详情弹层 | `.modal-sheet-wrap` 单层背衬 + 加宽 `#modal-shell`、`#compare-report-shell` |
| 详细对比（表格多点选 · 大卡报告） | 矩阵底栏 `#compare-fab-host` + `#compare-report-modal`；Esc 层级见上文 |
| 三风格 | 三 HTML + `theme-*.css` |
