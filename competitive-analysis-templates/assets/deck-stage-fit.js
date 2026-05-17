/**
 * deck-stage-fit.js — 等比缩放（CSS 驱动）+ 矩阵表格内容自适应
 *
 * 整页等比缩放由 layout.css 末尾的 `transform: scale(min(100vw/1440px, 100vh/900px))`
 * 自动完成；本文件只负责：
 *
 *   1) 可选：把 <html data-deck-base-w="…" data-deck-base-h="…"> 写回 CSS 变量。
 *
 *   2) 矩阵表格 cell 字号 / padding 自适应。每个 table 都会被独立观察 / 重算，
 *      字号目标是「视觉中等」：默认 4×3 行列时 ~20px 设计像素，行列变多 / 内容变长
 *      时在 ≤7 数据行、≤5 产品列范围内迭代缩小直到不溢出 .table-scroll 矩形。
 *      超过上述上限后不再缩小，改为 .table-scroll--overflow 内滚动（slider）。
 *      整页 transform scale 不会影响 fontPx 计算（clientWidth/Height 始终是设计像素）。
 *
 * 关掉整套体系：在 <html> 上加 data-deck-fit-disabled="true"。
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

  window.addEventListener("resize", scheduleFitAllTables, { passive: true });
  window.addEventListener("orientationchange", scheduleFitAllTables, {
    passive: true,
  });

  /* ------------------------------------------------------------------
   * 矩阵表格内容自适应
   *
   * 经验调整（针对用户反馈「字太大」）：
   *   - W_FACTOR 0.13 → 0.095：单格宽度估算字号更保守，默认 4 列时 ~22px 而非 ~34px
   *   - H_FACTOR 0.42 → 0.30：纵向预留 line-height 与上下 padding，避免顶到栅格
   *   - MAX_FONT_PX 40 → 26：1440×900 设计画布上，矩阵单元格再大也不超过 26px
   *     （映射到 1920×1080 浏览器 100% 缩放后约 31px，对应 PPT 24pt）
   *   - 行/列极少时不再无脑顶到上限，保留合理的视觉密度
   * ------------------------------------------------------------------ */

  var MIN_FONT_PX = 9;
  var MAX_FONT_PX = 26;
  var H_FACTOR = 0.3;
  var W_FACTOR = 0.095;
  var PAD_Y_RATIO = 0.42;
  var PAD_X_RATIO = 0.65;
  /** 超过后不再缩小字号，改由 .table-scroll 内滚动 */
  var MAX_FIT_DATA_ROWS = 7;
  var MAX_FIT_DATA_COLS = 5;

  /** 在 ≤7 行且 ≤5 列时缓存一次 fit 结果，超限时冻结未超限侧尺寸 */
  var rowBaselineCache = new WeakMap();

  function visibleColumnCount(table) {
    var thead = table.tHead;
    if (!thead || !thead.rows[0]) return 0;
    var n = 0;
    var ths = thead.rows[0].cells;
    for (var i = 0; i < ths.length; i++) {
      if (!ths[i].hidden) n++;
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

  /** 产品列数（thead 第 0 列为 corner，其余为产品列；含隐藏列） */
  function productColumnCount(table) {
    var tr = table.tHead && table.tHead.rows[0];
    if (!tr) return 0;
    return Math.max(0, tr.cells.length - 1);
  }

  function visibleProductColumnCount(table) {
    var n = visibleColumnCount(table);
    return n > 0 ? Math.max(0, n - 1) : 0;
  }

  function tableNeedsScrollMode(table) {
    return (
      visibleRowCount(table) > MAX_FIT_DATA_ROWS ||
      productColumnCount(table) > MAX_FIT_DATA_COLS
    );
  }

  function gridMetrics(availW, availH, colSlots, rowSlots) {
    var colPx = availW / Math.max(1, colSlots);
    var rowPx = availH / Math.max(1, rowSlots);
    var fontPx = Math.min(colPx * W_FACTOR, rowPx * H_FACTOR);
    fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, fontPx));
    return { colPx: colPx, rowPx: rowPx, fontPx: fontPx };
  }

  function lockedColPx(availW) {
    return availW / (MAX_FIT_DATA_COLS + 1);
  }

  function estimateRowHeightPx(fontPx) {
    return fontPx * PAD_Y_RATIO * 2 + fontPx * 1.42;
  }

  /** 表头与数据行分开算高：表头高度不随数据行数均分变矮 */
  function fitTypographyAndRows(availW, availH, nColVisible, dataRows) {
    dataRows = Math.max(1, dataRows);
    var colW = availW / Math.max(1, nColVisible);
    var fontPx = Math.min(
      colW * W_FACTOR,
      ((availH / (dataRows + 1)) * H_FACTOR)
    );
    fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, fontPx));
    var slack = 2;
    var theadH = estimateRowHeightPx(fontPx);
    var bodyRowH = (availH - theadH) / dataRows;
    for (var iter = 0; iter < 8; iter++) {
      theadH = estimateRowHeightPx(fontPx);
      bodyRowH = (availH - theadH) / dataRows;
      fontPx = Math.min(colW * W_FACTOR, bodyRowH * H_FACTOR);
      fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, fontPx));
      theadH = estimateRowHeightPx(fontPx);
      bodyRowH = (availH - theadH) / dataRows;
      if (theadH + dataRows * bodyRowH <= availH + slack) break;
      fontPx = Math.max(MIN_FONT_PX, fontPx * 0.92);
      if (fontPx <= MIN_FONT_PX + 0.01) break;
    }
    return {
      fontPx: fontPx,
      theadH: estimateRowHeightPx(fontPx),
      bodyRowH: (availH - estimateRowHeightPx(fontPx)) / dataRows,
    };
  }

  /** 行上限基准（7 数据行）；nColVisible 默认按当前可见列 */
  function computeCapHeights(availW, availH, nColVisible) {
    var cols =
      nColVisible == null || nColVisible < 1
        ? MAX_FIT_DATA_COLS + 1
        : nColVisible;
    return fitTypographyAndRows(availW, availH, cols, MAX_FIT_DATA_ROWS);
  }

  /** 列上限基准（5 产品列 + corner），字号/表头/行高均按此锁定 */
  function computeColCapHeights(availW, availH) {
    return fitTypographyAndRows(
      availW,
      availH,
      MAX_FIT_DATA_COLS + 1,
      MAX_FIT_DATA_ROWS
    );
  }

  function fitWithLockedThead(availW, availH, nColVisible, dataRows, lockedTheadH) {
    dataRows = Math.max(1, dataRows);
    var colW = availW / Math.max(1, nColVisible);
    var bodyRowH = (availH - lockedTheadH) / dataRows;
    var fontPx = Math.min(colW * W_FACTOR, bodyRowH * H_FACTOR);
    fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, fontPx));
    for (var iter = 0; iter < 8; iter++) {
      bodyRowH = (availH - lockedTheadH) / dataRows;
      fontPx = Math.min(colW * W_FACTOR, bodyRowH * H_FACTOR);
      fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, fontPx));
      if (estimateRowHeightPx(fontPx) <= lockedTheadH + 2) break;
      fontPx = Math.max(MIN_FONT_PX, fontPx * 0.92);
      if (fontPx <= MIN_FONT_PX + 0.01) break;
    }
    return {
      fontPx: fontPx,
      theadH: lockedTheadH,
      bodyRowH: (availH - lockedTheadH) / dataRows,
    };
  }

  function applyRowHeights(table, theadH, bodyRowH) {
    table.style.setProperty("--matrix-thead-h", theadH.toFixed(2) + "px");
    table.style.setProperty(
      "--matrix-body-row-h",
      bodyRowH.toFixed(2) + "px"
    );
  }

  function clearRowHeights(table) {
    table.style.removeProperty("--matrix-thead-h");
    table.style.removeProperty("--matrix-body-row-h");
    table.style.removeProperty("--matrix-row-h");
  }

  function applyTableWidth(table, widthPx) {
    var w = Math.max(0, widthPx);
    table.style.setProperty("--matrix-table-w", w.toFixed(2) + "px");
    table.style.width = w.toFixed(2) + "px";
  }

  function clearTableWidth(table) {
    table.style.removeProperty("--matrix-table-w");
    table.style.removeProperty("width");
  }

  function saveRowBaseline(table, snap) {
    rowBaselineCache.set(table, snap);
  }

  function readRowBaseline(table, availW, availH) {
    var b = rowBaselineCache.get(table);
    if (!b) return null;
    if (Math.abs(b.availW - availW) > 2 || Math.abs(b.availH - availH) > 2) return null;
    return b;
  }

  function pickFrozenHeights(table, availW, availH, nColVisible, overRow, overCol) {
    var base = readRowBaseline(table, availW, availH);
    var colCap = computeColCapHeights(availW, availH);
    var rowCap = computeCapHeights(availW, availH, nColVisible);

    if (!overRow && overCol) {
      if (base && base.theadH > 0 && base.bodyRowH > 0) {
        return {
          fontPx: base.fontPx,
          theadH: base.theadH,
          bodyRowH: base.bodyRowH,
        };
      }
      return colCap;
    }
    if (overRow && !overCol) {
      if (
        base &&
        base.theadH > 0 &&
        base.bodyRowH > 0 &&
        base.dataRows >= MAX_FIT_DATA_ROWS &&
        base.nColVisible === nColVisible
      ) {
        return {
          fontPx: base.fontPx,
          theadH: base.theadH,
          bodyRowH: base.bodyRowH,
        };
      }
      return rowCap;
    }
    if (overRow && overCol) {
      if (
        base &&
        base.theadH > 0 &&
        base.bodyRowH > 0 &&
        base.dataRows >= MAX_FIT_DATA_ROWS
      ) {
        return {
          fontPx: Math.min(base.fontPx, colCap.fontPx),
          theadH: base.theadH,
          bodyRowH: base.bodyRowH,
        };
      }
      return {
        fontPx: Math.min(rowCap.fontPx, colCap.fontPx),
        theadH: rowCap.theadH,
        bodyRowH: rowCap.bodyRowH,
      };
    }
    return colCap;
  }

  function applyCellTypography(table, fontPx) {
    table.style.setProperty("--matrix-cell-font", fontPx.toFixed(2) + "px");
    table.style.setProperty(
      "--matrix-cell-pad-y",
      (fontPx * PAD_Y_RATIO).toFixed(2) + "px"
    );
    table.style.setProperty(
      "--matrix-cell-pad-x",
      (fontPx * PAD_X_RATIO).toFixed(2) + "px"
    );
    table.style.setProperty("--matrix-cell-line", "1.42");
  }

  function buildColgroupHtml(table, totalCols, nColVisible, mode, colPx) {
    var leadColPct = nColVisible > 1 ? 22 : 100;
    var otherCols = Math.max(1, nColVisible - 1);
    var otherPct = nColVisible > 1 ? (100 - leadColPct) / otherCols : 0;
    var html = "";
    var visibleIdx = 0;
    for (var c = 0; c < totalCols; c++) {
      var th = table.tHead.rows[0].cells[c];
      if (th && th.hidden) {
        html += '<col style="width:0">';
        continue;
      }
      if (mode === "fixed" && colPx > 0) {
        html +=
          '<col style="width:' +
          colPx.toFixed(2) +
          "px;min-width:" +
          colPx.toFixed(2) +
          'px">';
        visibleIdx++;
      } else {
        var pct = visibleIdx === 0 ? leadColPct : otherPct;
        html += '<col style="width:' + pct.toFixed(4) + '%">';
        visibleIdx++;
      }
    }
    return html;
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
    if (availW < 40 || availH < 40) return;
    var nColVisible = visibleColumnCount(table);
    var dataRows = visibleRowCount(table);
    var nRow = dataRows + 1;
    if (!nColVisible || !nRow) return;

    var scrollMode = tableNeedsScrollMode(table);
    var productCols = productColumnCount(table);
    var overRow = dataRows > MAX_FIT_DATA_ROWS;
    var overCol = productCols > MAX_FIT_DATA_COLS;
    if (scrollMode) {
      scroll.classList.add("table-scroll--overflow");
      table.classList.add("comparison-table--scroll-mode");
      table.classList.toggle("comparison-table--scroll-rows", overRow);
      table.classList.toggle("comparison-table--scroll-cols", overCol);
    } else {
      scroll.classList.remove("table-scroll--overflow");
      table.classList.remove("comparison-table--scroll-mode");
      table.classList.remove("comparison-table--scroll-rows");
      table.classList.remove("comparison-table--scroll-cols");
      clearTableWidth(table);
      table.style.removeProperty("height");
    }

    var colgroup = table.querySelector("colgroup[data-fit-colgroup]");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      colgroup.setAttribute("data-fit-colgroup", "1");
      table.insertBefore(colgroup, table.firstChild);
    }
    var totalCols =
      table.tHead && table.tHead.rows[0] ? table.tHead.rows[0].cells.length : nColVisible;

    if (scrollMode) {
      var colPxLock = lockedColPx(availW);
      var frozen = pickFrozenHeights(
        table,
        availW,
        availH,
        nColVisible,
        overRow,
        overCol
      );
      applyCellTypography(table, frozen.fontPx);
      colgroup.innerHTML = buildColgroupHtml(
        table,
        totalCols,
        nColVisible,
        overCol ? "fixed" : "percent",
        colPxLock
      );
      if (overRow) {
        applyRowHeights(table, frozen.theadH, frozen.bodyRowH);
        table.style.height = "auto";
      } else if (overCol) {
        applyRowHeights(table, frozen.theadH, frozen.bodyRowH);
        table.style.height = "100%";
      } else {
        clearRowHeights(table);
        table.style.height = "100%";
      }
      if (overCol) {
        applyTableWidth(table, visibleColumnCount(table) * colPxLock);
      } else {
        clearTableWidth(table);
        table.style.width = "100%";
      }
      return;
    }

    clearRowHeights(table);

    var colCapHeights = computeColCapHeights(availW, availH);
    var leadColPct = nColVisible > 1 ? 22 : 100;
    var otherCols = Math.max(1, nColVisible - 1);
    var otherPct = nColVisible > 1 ? (100 - leadColPct) / otherCols : 0;

    var colsHtmlFit = "";
    var visibleIdxFit = 0;
    for (var c2 = 0; c2 < totalCols; c2++) {
      var thFit = table.tHead.rows[0].cells[c2];
      if (thFit && thFit.hidden) {
        colsHtmlFit += '<col style="width:0">';
      } else {
        var pctFit = visibleIdxFit === 0 ? leadColPct : otherPct;
        colsHtmlFit += '<col style="width:' + pctFit.toFixed(4) + '%">';
        visibleIdxFit++;
      }
    }
    colgroup.innerHTML = colsHtmlFit;

    var fit = fitWithLockedThead(
      availW,
      availH,
      nColVisible,
      dataRows,
      colCapHeights.theadH
    );
    fit.fontPx = colCapHeights.fontPx;
    applyCellTypography(table, fit.fontPx);
    applyRowHeights(table, colCapHeights.theadH, fit.bodyRowH);

    if (dataRows <= MAX_FIT_DATA_ROWS && productCols <= MAX_FIT_DATA_COLS) {
      saveRowBaseline(table, {
        fontPx: colCapHeights.fontPx,
        theadH: colCapHeights.theadH,
        bodyRowH:
          dataRows >= MAX_FIT_DATA_ROWS
            ? colCapHeights.bodyRowH
            : fit.bodyRowH,
        availW: availW,
        availH: availH,
        dataRows: dataRows,
        productCols: productCols,
        nColVisible: nColVisible,
      });
    }
  }

  function listAllMatrixTables() {
    return Array.prototype.slice.call(
      document.querySelectorAll('table[id^="comparison-table"]')
    );
  }

  function fitAllTables() {
    listAllMatrixTables().forEach(fitTable);
  }

  var fitRaf = 0;
  function scheduleFitAllTables() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitAllTables();
    });
  }

  var observedTables = new WeakSet();

  function ensureTableObservers() {
    listAllMatrixTables().forEach(function (table) {
      if (observedTables.has(table)) return;
      observedTables.add(table);
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
  }

  function watchStageForNewTables() {
    var stage = document.getElementById("deck-stage");
    if (!stage || !window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      ensureTableObservers();
      scheduleFitAllTables();
    });
    mo.observe(stage, { childList: true, subtree: true });
  }

  function bindObservers() {
    ensureTableObservers();
    watchStageForNewTables();

    document.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== "INPUT" || t.type !== "checkbox") return;
      if (
        t.closest &&
        (t.closest('[id^="filter-deck"]') ||
          t.closest(".matrix-toolbar"))
      ) {
        scheduleFitAllTables();
      }
    });
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t) return;
      if (t.matches && t.matches("[data-slide-dot], [data-slide-go]")) {
        setTimeout(scheduleFitAllTables, 60);
      }
    });
  }

  function init() {
    bindObservers();
    setTimeout(scheduleFitAllTables, 0);
    setTimeout(scheduleFitAllTables, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.__scheduleMatrixTableFit = scheduleFitAllTables;
})();
