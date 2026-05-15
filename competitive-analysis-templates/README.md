# 竞品分析 HTML 模板套件

三套独立视觉主题（科技风 / 马卡龙 / 简约大气），共用同一套幻灯逻辑与数据结构。定位为「可讲演 / 汇报」的单文件 HTML：**打开浏览器即可展示**，内容由内嵌 JSON 驱动，便于后续聊天机器人按字段批量填充。

---

## 文件地图

| 路径 | 作用 |
|------|------|
| `template-tech.html` | 深色科技霓虹风 |
| `template-macaron.html` | 马卡龙圆角可爱风 |
| `template-minimal.html` | 留白衬线极简风 |
| `assets/matrix-core.js` | 幻灯切换、矩阵渲染、行列筛选、弹层 |
| `themes/layout.css` | 版面 / 表格 / 弹层结构（三套共用） |
| `themes/theme-*.css` | 各自配色与字体 |
| `README.md` | 给人 + 给 AI 的说明（本文件） |

使用方式：**用浏览器直接打开任一 `template-*.html`**（或通过本地静态服务器，避免个别浏览器对 `file://` 的限制）。若离线使用，请删除或替换 JSON 中外链图片地址。

---

## 页面结构（四页讲演流）

固定顺序（勿改 DOM id，聊天机器人只做数据替换更安全）：

1. **Slide 0 — 封面**：`cover.*`（眉标、主标题、副标题可空）
2. **Slide 1 — 概述**：`overview`（`overview.title` 可空则隐藏页内二级标题）
3. **Slide 2 — 竞品对比矩阵**：`matrix.*` 驱动唯一表格；右下角「详细对比」FAB 在矩阵页内
4. **Slide 3 — 结束页**：`ending`

---

## `#deck-data` JSON Schema（必读）

整块 JSON 放在：

```html
<script id="deck-data" type="application/json">
{ ... }
</script>
```

根对象字段：`theme`，`cover`，`overview`，`matrix`，**`ending`**（结束页，对应 **Slide 3**）。`matrix.columns` 用于生成 **thead 表头行**（左上角 `cornerLabel` + 各型号 `th`）；**表头这一行不会从 DOM 消失**，只是当某型号列被勾选隐藏时，该行里对应的表头格与下方单元格一并折叠。`matrix.rows` 为对比维度，**每一条**都可勾选显示或隐藏；`matrix.columns` 同理。各项需含稳定 **`id`**，`cells` 键为 **`"行id::列id"`**。**单元格详情弹层**：`detailHtml` 在大尺寸浮层内展示；浮层后侧可见装饰性「纸张」叠边（`.modal-sheet-under`）。

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
避免改动：`#filter-deck` / `#matrix-thead` / `#matrix-tbody` / `#filter-rows` / `#filter-cols` / `#comparison-table` / `compare-fab-stack`（矩阵页内 FAB）/ `compare-launch-btn` / `#compare-report-modal*` 等 DOM id；`matrix-core.js` 文件名与路径
新增对比行：matrix.rows.push(...)，并为每个 columns[].id 写 cells["rowId::colId"].summary 与 detailHtml
结束页：顶层 `ending`: { "eyebrow","title","bodyHtml" }（对应第 4 页，索引 3）
调试：控制台执行 __matrixDeckReload()
```

---

## 实现对照

| 需求 | 实现位置 |
|------|----------|
| 多层嵌套内容 | `overview.sections[].bodyHtml`、`detailHtml` |
| 四页幻灯（含结束页） | `[data-slide-index="0–3"]`、`ending` 字段、`renderEnding()` |
| 可筛选行列 | `#filter-deck`、`hidden` |
| 表头行常驻、行列可勾选 | thead 不参与筛选 UI；勾选控制 tbody 行与各产品列，`applyFilters` 同步表头格子 |
| 大号叠纸详情弹层 | `.modal-page-stack`、`.modal-sheet-under` 叠影 + 加宽 `#modal-shell` |
| 详细对比（表格多点选 · 大卡报告） | 右下角 FAB + `#compare-report-modal`；Esc 层级见上文 |
| 三风格 | 三 HTML + `theme-*.css` |
