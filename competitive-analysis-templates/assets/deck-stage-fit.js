/**
 * deck-stage-fit.js — 等比缩放（base 尺寸覆盖） + 矩阵表格内容自适应
 *
 * 等比缩放主体逻辑由 CSS（layout.css 末尾的虚拟舞台块）使用
 *   transform: scale(min(100vw / 1440px, 100vh / 900px))
 * 完成，浏览器对窗口大小变化同步响应，无需 JS 干预。
 *
 * 本文件职责：
 *
 *   1) 可选：把 <html data-deck-base-w="…" data-deck-base-h="…"> 写回 CSS 变量，
 *      让站点能调整设计画布尺寸（默认 1440×900）。
 *
 *   2) 矩阵表格 cell 字号 / padding 自适应
 *      - 监听 .table-scroll 尺寸变化（ResizeObserver）、表格 DOM 变化（MutationObserver）、
 *        以及筛选 chip 的 change 事件，重算 --matrix-cell-font / --matrix-cell-pad-*。
 *      - 算法目标：让 ⌈可见行 × 可见列⌉ 的表格内容刚好填满 .table-scroll 矩形，
 *        既不溢出（出滚动条 / 顶穿底栏），也不留大块空白。
 *      - 单元格自适应只对应「设计像素」尺寸（容器宽高为未变换值），与外层 scale 完全解耦——
 *        浏览器缩放页面不会让字号重算，只有行/列数量、容器尺寸变化才会触发。
 *
 * 关掉整套体系：在 <html> 上加 data-deck-fit-disabled="true" 即可（CSS 也跟着回退）。
 */

(function () {
  "use strict";

  if (document.documentElement.getAttribute("data-deck-fit-disabled") === "true") {
    return;
  }

  var root = document.documentElement;
  var baseWAttr = parseFloat(root.getAttribute("data-deck-base-w"));
  var baseHAttr = parseFloat(root.getAttribute("data-deck-base-h"));
  if (baseWAttr > 0) root.style.setProperty("--deck-base-w", baseWAttr + "px");
  if (baseHAttr > 0) root.style.setProperty("--deck-base-h", baseHAttr + "px");

  // 由于 CSS 已经把缩放绑死到 vw/vh，浏览器自身的 resize 会同步重算缩放比例；
  // 但 .table-scroll 在某些 slide 切换时刻才出现，ResizeObserver 仍然需要兜底。
  window.addEventListener("resize", scheduleFitAllTables, { passive: true });
  window.addEventListener("orientationchange", scheduleFitAllTables, { passive: true });

  // ---------------------------------------------------------------------------
  // 2) 矩阵表格内容自适应
  // ---------------------------------------------------------------------------

  var TABLE_IDS = ["comparison-table", "comparison-table-sub"];

  // 字号下限：低于这个值哪怕牺牲「完全无滚动」也不再继续缩小（继续缩小可读性极差）
  var MIN_FONT_PX = 8;
  // 字号上限：避免极少数行列时字号大到失真（>40px 在 1440 设计宽里已经像海报字了）
  var MAX_FONT_PX = 40;
  // 经验系数：以单元格高 / 宽估算字号
  //   - cellH * H_FACTOR：单行所需的视觉高度（字号 + 行距 + 内边距）大约 = cellH * (1.4 + 2*0.45/H_FACTOR)；
  //     反推 H_FACTOR ≈ 1 / (1.4 + 0.9 + 0.6 余裕) ≈ 0.32~0.40，这里取 0.42 让纵向略激进，迭代缩字即可
  //   - cellW * W_FACTOR：单元格宽度能塞下多少个中文字符；中文 ≈ 字宽，留 ~7 字符
  var H_FACTOR = 0.42;
  var W_FACTOR = 0.13;
  // padding 与字号的比例
  var PAD_Y_RATIO = 0.45;
  var PAD_X_RATIO = 0.7;

  function visibleColumnCount(table) {
    var thead = table.tHead;
    if (!thead || !thead.rows[0]) return 0;
    var n = 0;
    var ths = thead.rows[0].cells;
    for (var i = 0; i < ths.length; i++) {
      if (!ths[i].hidden && ths[i].offsetParent !== null) n++;
      else if (!ths[i].hidden) n++; // offsetParent 为 null 可能是 stage display:none，保守按非 hidden 计
    }
    return n;
  }

  function visibleRowCount(table) {
    var tbody = table.tBodies && table.tBodies[0];
    if (!tbody) return 0;
    var n = 0;
    for (var i = 0; i < tbody.rows.length; i++) {
      if (!tbody.rows[i].hidden) n++;
    }
    return n;
  }

  function tableScrollAreaFor(table) {
    var s = table.parentElement;
    while (s && !s.classList.contains("table-scroll")) s = s.parentElement;
    return s;
  }

  function fitTable(table) {
    var scroll = tableScrollAreaFor(table);
    if (!scroll || !scroll.isConnected) return;

    var availW = scroll.clientWidth;
    var availH = scroll.clientHeight;
    if (availW < 40 || availH < 40) return; // 区域还没就位

    var nCol = visibleColumnCount(table);
    var nRow = visibleRowCount(table) + 1; // +1 表头
    if (!nCol || !nRow) return;

    // 给左侧「对比项」列分配 22% 宽度，剩余 78% 在产品列间均分
    var leadColPct = nCol > 1 ? 22 : 100;
    var otherCols = Math.max(1, nCol - 1);
    var otherPct = nCol > 1 ? (100 - leadColPct) / otherCols : 0;

    var colgroup = table.querySelector("colgroup[data-fit-colgroup]");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      colgroup.setAttribute("data-fit-colgroup", "1");
      table.insertBefore(colgroup, table.firstChild);
    }
    // 重建 colgroup 以匹配当前列数（含 hidden 列也占位，避免 nth-of-type 错位；hidden 由 td.hidden 控制是否显示）
    var totalCols = table.tHead && table.tHead.rows[0] ? table.tHead.rows[0].cells.length : nCol;
    var colsHtml = "";
    var visibleIdx = 0;
    for (var c = 0; c < totalCols; c++) {
      var th = table.tHead.rows[0].cells[c];
      if (th && th.hidden) {
        colsHtml += '<col style="width:0">';
      } else {
        var pct = visibleIdx === 0 ? leadColPct : otherPct;
        colsHtml += '<col style="width:' + pct.toFixed(4) + '%">';
        visibleIdx++;
      }
    }
    colgroup.innerHTML = colsHtml;

    var cellW = availW / nCol;
    var cellH = availH / nRow;

    var fontPx = Math.min(cellW * W_FACTOR, cellH * H_FACTOR);
    fontPx = clamp(fontPx, MIN_FONT_PX, MAX_FONT_PX);

    function write(px) {
      table.style.setProperty("--matrix-cell-font", px.toFixed(2) + "px");
      table.style.setProperty("--matrix-cell-pad-y", (px * PAD_Y_RATIO).toFixed(2) + "px");
      table.style.setProperty("--matrix-cell-pad-x", (px * PAD_X_RATIO).toFixed(2) + "px");
      table.style.setProperty("--matrix-cell-line", "1.4");
    }

    write(fontPx);

    // 迭代收敛：若文字换行后总高仍超出，缩小再试；最多 8 次
    var slack = 2; // 允许 2px 容差以避免亚像素抖动
    for (var iter = 0; iter < 8; iter++) {
      var tableH = table.getBoundingClientRect().height;
      var tableW = table.getBoundingClientRect().width;
      var overH = tableH - availH;
      var overW = tableW - availW;
      if (overH <= slack && overW <= slack) break;
      var shrink = 0.92;
      fontPx = Math.max(MIN_FONT_PX, fontPx * shrink);
      write(fontPx);
      if (fontPx <= MIN_FONT_PX + 0.01) break;
    }
  }

  function fitAllTables() {
    for (var i = 0; i < TABLE_IDS.length; i++) {
      var t = document.getElementById(TABLE_IDS[i]);
      if (t) fitTable(t);
    }
  }

  var fitRaf = 0;
  function scheduleFitAllTables() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitAllTables();
    });
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // 监听：表格自身大小变化（如 slide 切换、工具条多行收纳） + 表格 DOM 结构 / hidden 变化 + 筛选 chip 切换
  function bindObservers() {
    TABLE_IDS.forEach(function (id) {
      var table = document.getElementById(id);
      if (!table) return;
      var scroll = tableScrollAreaFor(table);

      if (scroll && window.ResizeObserver) {
        var ro = new ResizeObserver(scheduleFitAllTables);
        ro.observe(scroll);
      }

      if (window.MutationObserver) {
        var mo = new MutationObserver(scheduleFitAllTables);
        mo.observe(table, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["hidden", "data-row-id", "data-col-id"],
        });
      }
    });

    // 筛选 chip 触发 applyFilters，但 applyFilters 内部仅切换 hidden（被 MutationObserver 抓到）
    // 加一道 change 监听做双保险，避免某些浏览器对 hidden 属性事件吞掉
    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== "INPUT" || t.type !== "checkbox") return;
      if (t.closest && (t.closest("#filter-deck") || t.closest("#filter-deck-sub"))) {
        scheduleFitAllTables();
      }
    });

    // slide-dot 翻页后 .table-scroll 才显示，ResizeObserver 也会触发；但保险起见也手动跑一次
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.matches && t.matches("[data-slide-dot], [data-slide-go]")) {
        setTimeout(scheduleFitAllTables, 50);
      }
    });
  }

  function init() {
    bindObservers();
    // 等待 matrix-core 完成首次渲染（大约一拍）再补算一次
    setTimeout(scheduleFitAllTables, 0);
    setTimeout(scheduleFitAllTables, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
