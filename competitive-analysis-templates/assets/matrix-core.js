/**
 * matrix-core.js — 竞品矩阵五页幻灯 + 矩阵交互
 *
 * 数据：<script id="deck-data" type="application/json"> 单文件 JSON（见 README）
 * slide：0 封面 · 1 概述 · 2 竞品对比矩阵（客观）· 3 竞品对比矩阵（主观）· 4 结束页（`ending`）
 * 矩阵 thead 行为产品型号列；tbody 左侧 th 行为对比参数行
 * cells 键："对比项行id::产品列id" → summary / detailHtml（单格弹层大卡）
 * 行列筛选：可隐藏任意「参数行」或「产品列」；thead 型号表头一行不参与筛选逻辑，始终存在于 DOM。
 */
(function () {
  "use strict";

  var deck = null;
  var slideIndexNav = 0;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function parseDeck() {
    var el = document.getElementById("deck-data");
    if (!el || !String(el.textContent || "").trim()) {
      console.error('[matrix-core] 缺少 id="deck-data"');
      return null;
    }
    try {
      return JSON.parse(el.textContent);
    } catch (e) {
      console.error("[matrix-core] JSON 解析失败", e);
      return null;
    }
  }

  function clampSlideIdx(i) {
    var slides = slideCountLive();
    var max = Math.max(slides - 1, 0);
    var n = parseInt(String(i), 10);
    if (isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > max) return max;
    return n;
  }

  function slideCountLive() {
    return $all("[data-slide]").length;
  }

  /** HTML 写成 data-slide-index；部分环境仅用 getAttribute 最稳 */
  function readSlideDomIndex(btn, attrName) {
    var raw = btn.getAttribute(attrName);
    if (raw == null || String(raw).trim() === "") {
      if (attrName === "data-slide-go") raw = btn.dataset.slideGo;
      else if (attrName === "data-slide-dot") raw = btn.dataset.slideDot;
    }
    var n = parseInt(String(raw).trim(), 10);
    return isNaN(n) ? 0 : n;
  }

  function sectionSlideIndex(sec) {
    var raw =
      sec.getAttribute("data-slide-index") ||
      sec.dataset.slideIndex ||
      "";
    var n = parseInt(String(raw).trim(), 10);
    return isNaN(n) ? NaN : n;
  }

  function repositionCompareFabHost(idx) {
    var host = $("#compare-fab-host");
    var park = $("#compare-fab-park");
    var aObj = $("#compare-fab-anchor-objective");
    var aSub = $("#compare-fab-anchor-subjective");
    if (!host) return;
    function markAnchors(hasObj, hasSub) {
      if (aObj) aObj.setAttribute("aria-hidden", hasObj ? "false" : "true");
      if (aSub) aSub.setAttribute("aria-hidden", hasSub ? "false" : "true");
    }
    if (idx === 2 && aObj) {
      aObj.appendChild(host);
      host.removeAttribute("hidden");
      markAnchors(true, false);
    } else if (idx === 3 && aSub) {
      aSub.appendChild(host);
      host.removeAttribute("hidden");
      markAnchors(false, true);
    } else {
      if (park) park.appendChild(host);
      host.setAttribute("hidden", "");
      markAnchors(false, false);
    }
  }

  function goSlide(idx) {
    idx = clampSlideIdx(idx);
    if (idx !== 2 && idx !== 3) exitComparePickQuiet();

    slideIndexNav = idx;
    $all("[data-slide]").forEach(function (s) {
      var si = sectionSlideIndex(s);
      var active = si === idx;
      s.hidden = !active;
      s.setAttribute("aria-hidden", active ? "false" : "true");
    });
    $all("[data-slide-dot]").forEach(function (dot) {
      var i = readSlideDomIndex(dot, "data-slide-dot");
      dot.classList.toggle("is-active", i === idx);
      dot.setAttribute("aria-current", i === idx ? "true" : "false");
    });
    var nav = $("#slide-nav");
    if (nav) nav.dataset.activeIndex = String(idx);
    repositionCompareFabHost(idx);
    try {
      history.replaceState(null, "", "#slide-" + idx);
    } catch (_) {}
  }

  function bindSlideNav() {
    $all("[data-slide-go]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        goSlide(readSlideDomIndex(btn, "data-slide-go"));
      });
    });
    $all("[data-slide-dot]").forEach(function (dot) {
      dot.addEventListener("click", function () {
        goSlide(readSlideDomIndex(dot, "data-slide-dot"));
      });
    });
    window.addEventListener("hashchange", function () {
      var m = location.hash.match(/^#slide-(\d+)/);
      if (m) goSlide(Number(m[1]));
    });

    document.addEventListener("keydown", onDeckKeydown);

    var m0 = location.hash.match(/^#slide-(\d+)/);
    goSlide(m0 ? Number(m0[1]) : 0);
  }

  /** ←/→、PageUp/Down：矩阵弹层 / 对比报告打开时不翻页 */
  function onDeckKeydown(ev) {
    var crm = $("#compare-report-modal");
    if (crm && !crm.hasAttribute("hidden")) return;

    var modal = $("#cell-modal");
    if (modal && !modal.hasAttribute("hidden")) return;

    var t = ev.target;
    var tag = t && t.tagName ? String(t.tagName) : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (t instanceof HTMLElement && t.isContentEditable) return;

    var k = ev.key;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") {
      ev.preventDefault();
      goSlide(slideIndexNav + 1);
    } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") {
      ev.preventDefault();
      goSlide(slideIndexNav - 1);
    }
  }

  function cellKey(rowId, colId) {
    return rowId + "::" + colId;
  }

  function renderMatrix() {
    if (!deck) return;
    var m = deck.matrix;
    var setups = [
      { tsuf: "", rf: "row-filter-", cf: "col-filter-" },
      { tsuf: "-sub", rf: "row-filter-sub-", cf: "col-filter-sub-" },
    ];
    setups.forEach(function (cfg) {
      var thead = $("#matrix-thead" + cfg.tsuf);
      var tbody = $("#matrix-tbody" + cfg.tsuf);
      var filtersRow = $("#filter-rows" + cfg.tsuf);
      var filtersCol = $("#filter-cols" + cfg.tsuf);
      if (!thead || !tbody || !filtersRow || !filtersCol) return;

      thead.innerHTML = "";
      tbody.innerHTML = "";
      filtersRow.innerHTML = "";
      filtersCol.innerHTML = "";
      var tab = thead.closest("table");
      if (tab) delete tab.dataset.pickDeleg;

      var trHead = document.createElement("tr");
      var corner = document.createElement("th");
      corner.className = "matrix-corner";
      corner.scope = "col";
      corner.textContent = m.cornerLabel || "对比项 \\ 型号";
      trHead.appendChild(corner);

      m.columns.forEach(function (col) {
        var th = document.createElement("th");
        th.scope = "col";
        th.dataset.colId = col.id;
        th.textContent = col.label;
        trHead.appendChild(th);
      });
      thead.appendChild(trHead);

      m.rows.forEach(function (row) {
        var tr = document.createElement("tr");
        tr.dataset.rowId = row.id;
        var thRow = document.createElement("th");
        thRow.scope = "row";
        thRow.dataset.rowId = row.id;
        thRow.textContent = row.label;
        thRow.className = "matrix-row-head";
        tr.appendChild(thRow);

        m.columns.forEach(function (col) {
          var td = document.createElement("td");
          td.className = "matrix-cell";
          td.dataset.rowId = row.id;
          td.dataset.colId = col.id;
          td.setAttribute("tabindex", "0");
          td.setAttribute("role", "button");
          td.setAttribute(
            "aria-label",
            "查看：" + row.label + " × " + col.label
          );

          var ck = cellKey(row.id, col.id);
          var cellObj =
            m.cells[ck] || {
              summary: "",
              detailHtml: "<p>—</p>",
            };

          td.innerHTML = cellObj.summary
            ? cellObj.summary
            : '<span class="cell-empty">—</span>';

          td.addEventListener("click", function (ev) {
            if (comparePick.active) {
              ev.preventDefault();
              ev.stopPropagation();
              flashCompareNope(td);
              return;
            }
            openModal(row.label, col.label, cellObj.detailHtml);
          });
          td.addEventListener("keydown", function (ev) {
            if (comparePick.active) {
              if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
              return;
            }
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              openModal(row.label, col.label, cellObj.detailHtml);
            }
          });

          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      m.rows.forEach(function (row) {
        var id = cfg.rf + row.id;
        var lab = document.createElement("label");
        lab.className = "filter-chip";
        var input = document.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.checked = !row.hidden;
        input.dataset.axisId = row.id;
        input.dataset.axis = "row";
        lab.appendChild(input);
        var span = document.createElement("span");
        span.textContent = row.label;
        lab.appendChild(span);
        filtersRow.appendChild(lab);
      });

      m.columns.forEach(function (col) {
        var id = cfg.cf + col.id;
        var lab = document.createElement("label");
        lab.className = "filter-chip";
        var input = document.createElement("input");
        input.type = "checkbox";
        input.id = id;
        input.checked = !col.hidden;
        input.dataset.axisId = col.id;
        input.dataset.axis = "column";
        lab.appendChild(input);
        var span = document.createElement("span");
        span.textContent = col.label;
        lab.appendChild(span);
        filtersCol.appendChild(lab);
      });
    });

    applyFilters();
    bindMatrixPickDelegation();
    syncComparePickUI();
  }

  function onFilterChange(ev) {
    var t = ev.target;
    if (!t || t.tagName !== "INPUT" || t.type !== "checkbox") return;
    if (!deck) return;
    var id = t.dataset.axisId;
    if (t.dataset.axis === "row") {
      var row = deck.matrix.rows.find(function (r) {
        return r.id === id;
      });
      if (row) row.hidden = !t.checked;
      $all('input[type="checkbox"][data-axis="row"][data-axis-id="' + id + '"]').forEach(function (inp) {
        if (inp !== t) inp.checked = t.checked;
      });
    } else if (t.dataset.axis === "column") {
      var col = deck.matrix.columns.find(function (c) {
        return c.id === id;
      });
      if (col) col.hidden = !t.checked;
      $all('input[type="checkbox"][data-axis="column"][data-axis-id="' + id + '"]').forEach(function (inp) {
        if (inp !== t) inp.checked = t.checked;
      });
    }
    applyFilters();
  }

  function applyFilters() {
    if (!deck) return;
    var m = deck.matrix;

    $all("#matrix-tbody tr, #matrix-tbody-sub tr").forEach(function (tr) {
      var rowId = tr.dataset.rowId;
      var row = m.rows.find(function (r) {
        return r.id === rowId;
      });
      tr.hidden = !!(row && row.hidden);
    });

    var hideCol = {};
    m.columns.forEach(function (col) {
      hideCol[col.id] = !!col.hidden;
    });

    $all("#matrix-thead, #matrix-thead-sub").forEach(function (thead) {
      var ths = $all("th", thead);
      m.columns.forEach(function (col, j) {
        var th = ths[j + 1];
        if (th) th.hidden = !!col.hidden;
      });
    });

    $all("#matrix-tbody .matrix-cell, #matrix-tbody-sub .matrix-cell").forEach(function (td) {
      var cid = td.dataset.colId;
      td.hidden = !!hideCol[cid];
      td.setAttribute("aria-hidden", hideCol[cid] ? "true" : "false");
    });
    if (comparePick.active) syncComparePickUI();
  }

  function openModal(rowLabel, colLabel, html) {
    var modal = $("#cell-modal");
    if (!modal) return;
    var meta = $("#modal-meta");
    var body = $("#modal-body");
    var shell = $("#modal-shell");
    if (meta) meta.textContent = rowLabel + " × " + colLabel;
    if (body) body.innerHTML = html;
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (shell) shell.focus();
  }

  function closeModal() {
    var modal = $("#cell-modal");
    if (!modal) return;
    var body = $("#modal-body");
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
    if (body) body.innerHTML = "";
  }

  function bindModal() {
    var c = $("#modal-close");
    var b = $("#modal-backdrop");
    if (c) c.addEventListener("click", closeModal);
    if (b) b.addEventListener("click", closeModal);
  }

  /** Escape：对比报告大卡 → 单元格详情 → 退出表格点选对比 */
  function bindEscapeStack() {
    if (document.documentElement.dataset.escapeStackBound === "1") return;
    document.documentElement.dataset.escapeStackBound = "1";
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var crm = $("#compare-report-modal");
      if (crm && !crm.hasAttribute("hidden")) {
        closeCompareReportModal();
        e.preventDefault();
        return;
      }
      var modal = $("#cell-modal");
      if (modal && !modal.hasAttribute("hidden")) {
        closeModal();
        e.preventDefault();
        return;
      }
      if (comparePick.active) {
        exitComparePick();
        e.preventDefault();
      }
    });
  }

  /** 详细对比：先点选左侧对比项（行），再点表头产品列；右下角入口，无向导弹窗 */
  var comparePick = { active: false, rows: {}, cols: {} };

  function flashCompareNope(el) {
    if (!el) return;
    el.classList.remove("cp-flash-nope");
    window.requestAnimationFrame(function () {
      el.classList.add("cp-flash-nope");
    });
    clearTimeout(el._cpNopeTimer);
    el._cpNopeTimer = setTimeout(function () {
      el.classList.remove("cp-flash-nope");
    }, 420);
  }

  function countCompareRowsSel() {
    return Object.keys(comparePick.rows).filter(function (k) {
      return comparePick.rows[k];
    }).length;
  }

  function countCompareColsSel() {
    return Object.keys(comparePick.cols).filter(function (k) {
      return comparePick.cols[k];
    }).length;
  }

  function isRowAxisHidden(rowId) {
    if (!deck || !deck.matrix) return true;
    var row = deck.matrix.rows.find(function (r) {
      return r.id === rowId;
    });
    return !row || !!row.hidden;
  }

  function isColAxisHidden(colId) {
    if (!deck || !deck.matrix) return true;
    var col = deck.matrix.columns.find(function (c) {
      return c.id === colId;
    });
    return !col || !!col.hidden;
  }

  function pruneCompareSelection() {
    var r = {};
    Object.keys(comparePick.rows).forEach(function (id) {
      if (
        comparePick.rows[id] &&
        !isRowAxisHidden(id) &&
        !rowTrHiddenDom(id)
      ) {
        r[id] = true;
      }
    });
    comparePick.rows = r;
    var c = {};
    Object.keys(comparePick.cols).forEach(function (id) {
      if (
        comparePick.cols[id] &&
        !isColAxisHidden(id) &&
        !colThHiddenDom(id)
      ) {
        c[id] = true;
      }
    });
    comparePick.cols = c;
  }

  function rowTrHiddenDom(rowId) {
    var tr = document.querySelector(
      '#matrix-tbody tr[data-row-id="' +
        cssEscapeSel(rowId) +
        '"]'
    );
    return !tr || tr.hidden;
  }

  function colThHiddenDom(colId) {
    var th = document.querySelector(
      '#matrix-thead th[data-col-id="' +
        cssEscapeSel(colId) +
        '"]'
    );
    return !th || th.hidden;
  }

  /** 仅属性选择器兜底；deck id 一般由字母数字构成 */
  function cssEscapeSel(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function toggleCompareRow(rowId) {
    if (!rowId || isRowAxisHidden(rowId)) return;
    comparePick.rows[rowId] = !comparePick.rows[rowId];
    if (!comparePick.rows[rowId]) delete comparePick.rows[rowId];
  }

  function toggleCompareCol(colId) {
    if (!colId || isColAxisHidden(colId)) return;
    comparePick.cols[colId] = !comparePick.cols[colId];
    if (!comparePick.cols[colId]) delete comparePick.cols[colId];
  }

  function exitComparePickQuiet() {
    comparePick.active = false;
    comparePick.rows = {};
    comparePick.cols = {};
    syncComparePickUI();
  }

  function exitComparePick() {
    exitComparePickQuiet();
  }

  function startComparePick() {
    pruneCompareSelection();
    comparePick.active = true;
    syncComparePickUI();
  }

  function compareSelectionValid() {
    return countCompareRowsSel() >= 1 && countCompareColsSel() >= 1;
  }

  function syncComparePickUI() {
    pruneCompareSelection();
    $all("#comparison-table, #comparison-table-sub").forEach(function (tbl) {
      if (!tbl) return;
      tbl.classList.toggle("compare-picking", comparePick.active);
      tbl.classList.toggle(
        "compare-pick-cols-live",
        comparePick.active && countCompareRowsSel() >= 1
      );
    });

    $all(".matrix-row-head").forEach(function (th) {
      th.classList.remove("is-cp-target", "is-cp-selected", "is-cp-muted");
      if (!comparePick.active) return;
      var rid = th.dataset.rowId;
      if (
        rid &&
        !isRowAxisHidden(rid) &&
        !rowTrHiddenDom(rid)
      ) {
        th.classList.add("is-cp-target");
        if (comparePick.rows[rid]) th.classList.add("is-cp-selected");
      } else if (rid) {
        th.classList.add("is-cp-muted");
      }
    });

    $all("#matrix-thead th, #matrix-thead-sub th").forEach(function (th) {
      th.classList.remove(
        "is-cp-corner",
        "is-cp-target",
        "is-cp-selected",
        "is-cp-locked",
        "is-cp-muted"
      );
      if (!comparePick.active) return;
      var cid = th.dataset.colId;
      if (!cid) {
        th.classList.add("is-cp-corner", "is-cp-muted");
        return;
      }
      var canCols = countCompareRowsSel() >= 1;
      var colOk = cid && !isColAxisHidden(cid) && !colThHiddenDom(cid);
      if (canCols && colOk) {
        th.classList.add("is-cp-target");
        if (comparePick.cols[cid]) th.classList.add("is-cp-selected");
      } else if (colOk) {
        th.classList.add("is-cp-locked");
      } else {
        th.classList.add("is-cp-muted");
      }
    });

    $all(".matrix-cell").forEach(function (td) {
      td.classList.toggle(
        "is-cp-muted",
        comparePick.active
      );
    });

    var main = $("#compare-launch-btn");
    var cx = $("#compare-fab-cancel");
    if (main) {
      if (!comparePick.active) {
        main.textContent = "详细对比";
        main.classList.remove("compare-fab__main--armed");
        main.removeAttribute("aria-label");
      } else {
        main.textContent = "生成对比报告";
        main.classList.toggle("compare-fab__main--armed", compareSelectionValid());
        main.setAttribute("aria-expanded", "true");
      }
    }
    if (!comparePick.active && main) {
      main.setAttribute("aria-expanded", "false");
    }
    if (cx) {
      cx.hidden = !comparePick.active;
      cx.style.display = comparePick.active ? "" : "none";
    }
  }

  function bindMatrixPickDelegation() {
    $all("#comparison-table, #comparison-table-sub").forEach(function (tbl) {
      if (!tbl || tbl.dataset.pickDeleg === "1") return;
      tbl.dataset.pickDeleg = "1";
      tbl.addEventListener("click", function (ev) {
        if (!comparePick.active) return;

        var trh = ev.target.closest("tbody .matrix-row-head");
        if (trh && tbl.contains(trh) && !ev.target.closest("thead")) {
          ev.preventDefault();
          var rid = trh.dataset.rowId;
          if (!rid || isRowAxisHidden(rid)) return;
          toggleCompareRow(rid);
          syncComparePickUI();
          return;
        }

        var thCol = ev.target.closest("thead th[data-col-id]");
        if (thCol && tbl.contains(thCol) && !thCol.hidden) {
          ev.preventDefault();
          if (countCompareRowsSel() < 1) {
            flashCompareNope(thCol);
            return;
          }
          var cid = thCol.dataset.colId;
          if (!cid || isColAxisHidden(cid)) return;
          toggleCompareCol(cid);
          syncComparePickUI();
          return;
        }

        var corner = ev.target.closest("thead .matrix-corner");
        if (corner && tbl.contains(corner)) {
          ev.preventDefault();
          flashCompareNope(tbl);
        }
      });
    });
  }

  function buildCompareReportHTML(rowIdsOrdered, colIdsOrdered) {
    var m = deck.matrix;
    var nr = rowIdsOrdered.length;
    var nc = colIdsOrdered.length;
    var intro =
      '<header class="cr-intro cr-intro--tight">' +
      "<p class=\"cr-muted cr-intro-meta\">" +
      nr +
      " 项 × " +
      nc +
      " 款</p>" +
      "</header>";
    var body = "";

    rowIdsOrdered.forEach(function (rowId, rbx) {
      var row = m.rows.find(function (r) {
        return r.id === rowId;
      });
      var rowLabel = row ? row.label : rowId;

      body += '<section class="cr-block">';
      body += '<div class="cr-block-head">';
      body += '<h4 class="cr-block-title">' + rowLabel + "</h4>";
      body +=
        '<span class="cr-block-chip">' +
        nc +
        " 款并列</span></div>";
      body += '<div class="cr-model-grid">';

      colIdsOrdered.forEach(function (colId, cix) {
        var col = m.columns.find(function (c) {
          return c.id === colId;
        });
        var colLabel = col ? col.label : colId;
        var ck = cellKey(rowId, colId);
        var cell = m.cells[ck] || {};
        var summary = cell.summary ? cell.summary : "—";
        var detail = cell.detailHtml || "<p>—</p>";

        body +=
          '<article class="cr-card cr-card--model" style="animation-delay:' +
          (rbx * 0.04 + cix * 0.035) +
          's">';
        body += '<header class="cr-card-head">';
        body += '<span class="cr-param">' + rowLabel + "</span>";
        body += '<span class="cr-chip">' + colLabel + "</span></header>";
        body += '<div class="cr-sum">' + summary + "</div>";
        body += '<div class="cr-detail">' + detail + "</div>";
        body += "</article>";
      });

      body += "</div></section>";
    });

    return intro + body;
  }

  function openCompareReportModal(html) {
    var modal = $("#compare-report-modal");
    var meta = $("#compare-report-meta");
    var shell = $("#compare-report-shell");
    var body = $("#compare-report-body-inner");
    if (!modal || !body) return;
    if (meta) meta.textContent = "对比报告";
    body.innerHTML = html;
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (shell) shell.focus();
  }

  function closeCompareReportModal() {
    var modal = $("#compare-report-modal");
    var body = $("#compare-report-body-inner");
    if (!modal) return;
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
    if (body) body.innerHTML = "";
  }

  function bindCompareReportModal() {
    var cls = $("#compare-report-close");
    var bk = $("#compare-report-backdrop");
    var once = $("#compare-report-modal");
    if (!once || once.dataset.bound === "1") return;
    once.dataset.bound = "1";
    if (cls)
      cls.addEventListener("click", closeCompareReportModal);
    if (bk)
      bk.addEventListener("click", closeCompareReportModal);
  }

  function runCompareGenerate() {
    if (!deck || !deck.matrix) return;
    if (!compareSelectionValid()) return;
    var orderR = deck.matrix.rows.map(function (r) {
      return r.id;
    }).filter(function (id) {
      return !!comparePick.rows[id] && !isRowAxisHidden(id);
    });

    var orderC = deck.matrix.columns.map(function (c) {
      return c.id;
    }).filter(function (id) {
      return !!comparePick.cols[id] && !isColAxisHidden(id);
    });

    if (!orderR.length || !orderC.length) return;

    var html = buildCompareReportHTML(orderR, orderC);
    openCompareReportModal(html);
    exitComparePickQuiet();
  }

  function bindCompareFab() {
    var btn = $("#compare-launch-btn");
    var cx = $("#compare-fab-cancel");
    if (!btn || btn.dataset.boundFab === "1") return;
    btn.dataset.boundFab = "1";
    btn.addEventListener("click", function () {
      if (!comparePick.active) {
        startComparePick();
        return;
      }
      if (compareSelectionValid()) {
        runCompareGenerate();
      } else {
        flashCompareNope(btn);
      }
    });
    if (cx && cx.dataset.bound !== "1") {
      cx.dataset.bound = "1";
      cx.addEventListener("click", function () {
        exitComparePick();
      });
    }
  }

  function renderCover() {
    if (!deck) return;
    var eb = $("#cover-eyebrow");
    var t = $("#cover-title");
    var s = $("#cover-subtitle");
    if (eb) eb.textContent = deck.cover.eyebrow || "竞品分析";
    if (t) t.innerHTML = deck.cover.title || "";
    if (s) {
      var sub = deck.cover.subtitle != null ? deck.cover.subtitle : "";
      s.innerHTML = sub;
      if (!String(sub).replace(/<[^>]*>/g, "").trim()) {
        s.setAttribute("hidden", "");
      } else {
        s.removeAttribute("hidden");
      }
    }
  }

  function renderOverview() {
    if (!deck) return;
    var ot = $("#overview-title");
    if (ot) {
      var oti = deck.overview.title;
      if (oti != null && String(oti).trim() !== "") {
        ot.textContent = oti;
        ot.removeAttribute("hidden");
      } else {
        ot.textContent = "";
        ot.setAttribute("hidden", "");
      }
    }
    var root = $("#overview-sections");
    if (!root) return;
    root.innerHTML = "";
    deck.overview.sections.forEach(function (sec) {
      var article = document.createElement("article");
      article.className = "nested-block";
      if (sec.heading && String(sec.heading).trim() !== "") {
        var h = document.createElement("h3");
        h.className = "nested-heading";
        h.innerHTML = sec.heading;
        article.appendChild(h);
      }
      var wrap = document.createElement("div");
      wrap.className = "nested-body";
      wrap.innerHTML = sec.bodyHtml;
      article.appendChild(wrap);
      root.appendChild(article);
    });
  }

  function renderEnding() {
    if (!deck) return;
    var e = deck.ending || {};
    var eb = $("#ending-eyebrow");
    var t = $("#ending-title");
    var b = $("#ending-body");
    if (eb) eb.textContent = e.eyebrow != null ? e.eyebrow : "谢谢观看";
    if (t) t.innerHTML = e.title != null ? e.title : "感谢聆听";
    if (b)
      b.innerHTML =
        e.bodyHtml != null
          ? e.bodyHtml
          : "<p>在此补充结论回顾、待办或 Q&amp;A 邀请。</p>";
  }

  function hydrateTitle() {
    if (!deck || !deck.cover || !deck.cover.title) return;
    var strip = String(deck.cover.title).replace(/<[^>]*>/g, "").trim();
    document.title = strip.slice(0, 80) || document.title;
  }

  function init() {
    deck = parseDeck();
    if (!deck) return;
    var filterDeck = $("#filter-deck");
    if (filterDeck && !filterDeck.dataset.bound) {
      filterDeck.addEventListener("change", onFilterChange);
      filterDeck.dataset.bound = "1";
    }
    var filterDeckSub = $("#filter-deck-sub");
    if (filterDeckSub && !filterDeckSub.dataset.bound) {
      filterDeckSub.addEventListener("change", onFilterChange);
      filterDeckSub.dataset.bound = "1";
    }
    bindSlideNav();
    bindModal();
    bindEscapeStack();
    renderCover();
    renderOverview();
    renderEnding();
    renderMatrix();
    bindCompareFab();
    bindCompareReportModal();
    hydrateTitle();
    if (deck.theme) document.documentElement.dataset.deckTheme = deck.theme;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /** 控制台：修改 deck-data 后执行 __matrixDeckReload() */
  window.__matrixDeckReload = function () {
    deck = parseDeck();
    if (!deck) return;
    renderCover();
    renderOverview();
    renderEnding();
    renderMatrix();
    bindCompareFab();
    bindCompareReportModal();
    hydrateTitle();
  };
})();
