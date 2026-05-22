/**
 * matrix-core.js — 页面（pages）驱动的幻灯框架 + 矩阵交互
 *
 * 数据：<script id="deck-data" type="application/json">
 *
 *   - 新版结构（推荐）：
 *       { theme, pages: [ { id, type, data }, ... ] }
 *     type ∈ { cover, overview, table, mindmap, ending }
 *     - cover.data:    { eyebrow, title, subtitle }
 *     - overview.data: { title, sections: [ { heading, bodyHtml } ] }
 *     - table.data:    { title, matrix: { cornerLabel, rows[], columns[], cells } }
 *     - ending.data:   { eyebrow, title, bodyHtml }
 *
 *   - 旧版结构（兼容）：顶层 cover / overview / matrix / matrixSubjective / ending —
 *     启动时自动迁移到 pages 数组（顺序：cover → overview → table(客观) → table(主观) → ending）。
 *
 * 渲染：
 *   - HTML 仅保留 chrome（编辑栏、浮层、modal），<main id="deck-stage"> 和
 *     <nav id="slide-nav"> 由本文件按 deck.pages 顺序生成。
 *   - 每个 `<section data-slide>` 含 data-page-id / data-page-type / data-slide-index。
 *   - 模板逻辑见 TEMPLATES 注册表；新增模板时往里加一条即可（页与页相互独立）。
 *
 * 表格页：
 *   - 同一份 deck 可有任意多个 table 页面，每页持有独立的 matrix。
 *   - 为兼容旧版测试 / 选择器，前两个 table 页使用旧 ID（""、"-sub" 后缀）。
 *     第 3+ 个 table 页使用 `-t${idx}` 后缀。
 *   - 数据键 `data-matrix-structure` 也按相同规则：第一张 "obj"，第二张 "sub"，其余为
 *     页面 ID 字符串。所有交互在 matrix-core 内部按页面 ID 区分。
 *
 * 添加 / 复制 / 删除页：
 *   - 顶部编辑栏含 `[data-page-add="<type>"]`、`[data-page-action="duplicate|delete"]`、
 *     `#deck-template-select`（切换 `template-*.html`）。
 *   - "添加" 默认插入到当前页的下一页位置；"复制本页" 把当前页深克隆插到下一页。
 *
 * 文稿编辑、IndexedDB 快照、对比报告、模态、xlsx 等沿用旧版功能；
 * 控制台：`__matrixDeckReload()` 重载 deck-data；`__matrixResetLocalDeck()` 清除 IndexedDB 快照。
 */
(function () {
  "use strict";

  /* ============================================================
   * 0. 顶部状态
   * ============================================================ */

  var deck = null;
  var slideIndexNav = 0;
  var comparePick = { active: false, rows: {}, cols: {}, pageId: null };
  var deckEditActive = false;
  var deckEditBaselineJSON = "";
  /** 详情弹层标题（行 × 列）是否在编辑中被用户改过；保存前据此决定是否写回 matrix / 表头 DOM */
  var modalMetaDirty = false;

  /** 关闭 xlsx fetch / 拖入 / 底栏；改 true 可恢复 */
  var MATRIX_FEATURE_XLSX_ENABLED = false;

  /* ============================================================
   * 1. 工具
   * ============================================================ */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeHtmlAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }
  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  /** 与 template-tech 演示稿第五页「收束」一致的新增结束页默认数据 */
  var DEFAULT_ENDING_PAGE_DATA = {
    eyebrow: "Session Closing",
    title:
      '收束<br><span style="opacity:.7;font-size:.48em;display:block;margin-top:.45em;font-weight:500;">问题与对齐时间</span>',
    bodyHtml: "<p>感谢聆听。若需进一步对齐资源与排期，会后单独沟通。</p>",
  };

  function cellKey(rowId, colId) {
    return rowId + "::" + colId;
  }

  var _idSeq = 0;
  function newPageId(type) {
    _idSeq += 1;
    return "page_" + type + "_" + Date.now().toString(36) + "_" + _idSeq;
  }

  function plainDetailToHtml(s) {
    var t = String(s == null ? "" : s).trim();
    if (!t) return "<p>—</p>";
    if (/^\s*</.test(t)) return t;
    var paras = escapeHtml(String(s)).split(/\r?\n\s*\r?\n/).filter(Boolean);
    if (!paras.length) return "<p>—</p>";
    return paras
      .map(function (p) {
        return "<p>" + p.replace(/\r?\n/g, "<br>") + "</p>";
      })
      .join("");
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

  /* ============================================================
   * 2. 数据迁移：legacy → pages[]
   * ============================================================ */

  function migrateDeckIfNeeded(d) {
    if (!d) return d;
    if (Array.isArray(d.pages) && d.pages.length) return finalizeDeckPages(d);
    var pages = [];
    if (d.cover) {
      pages.push({ id: newPageId("cover"), type: "cover", data: d.cover });
    } else {
      pages.push({
        id: newPageId("cover"),
        type: "cover",
        data: { eyebrow: "竞品分析", title: "新封面", subtitle: "" },
      });
    }
    if (d.overview) {
      pages.push({ id: newPageId("overview"), type: "overview", data: d.overview });
    } else {
      pages.push({
        id: newPageId("overview"),
        type: "overview",
        data: { title: "概述", sections: [] },
      });
    }
    if (d.matrix) {
      pages.push({
        id: newPageId("table"),
        type: "table",
        data: { title: "竞品对比矩阵（客观）", matrix: d.matrix },
      });
      var subMatrix = d.matrixSubjective || deepClone(d.matrix);
      pages.push({
        id: newPageId("table"),
        type: "table",
        data: { title: "竞品对比矩阵（主观）", matrix: subMatrix },
      });
    }
    if (d.ending) {
      pages.push({ id: newPageId("ending"), type: "ending", data: d.ending });
    } else {
      pages.push({
        id: newPageId("ending"),
        type: "ending",
        data: deepClone(DEFAULT_ENDING_PAGE_DATA),
      });
    }
    d.pages = pages;
    delete d.cover;
    delete d.overview;
    delete d.matrix;
    delete d.matrixSubjective;
    delete d.ending;
    return finalizeDeckPages(d);
  }

  /** 演示稿默认插入一页思维导图（概述之后），避免用户找不到「+ 思维导图」入口 */
  function ensureMindmapPage(d) {
    if (!d || !Array.isArray(d.pages)) return d;
    for (var i = 0; i < d.pages.length; i++) {
      if (d.pages[i] && d.pages[i].type === "mindmap") return d;
    }
    var MM = typeof window !== "undefined" ? window.MindmapDeck : null;
    var data = MM && MM.defaultPageData ? MM.defaultPageData() : { title: "思维导图", zoom: 1, roots: [] };
    var at = Math.min(2, d.pages.length);
    for (var j = 0; j < d.pages.length; j++) {
      if (d.pages[j].type === "overview") {
        at = j + 1;
        break;
      }
    }
    d.pages.splice(at, 0, { id: newPageId("mindmap"), type: "mindmap", data: data });
    return d;
  }

  /** 迁移思维导图页数据（root → roots 等）；快照恢复后也要执行 */
  function migrateMindmapPagesInDeck(d) {
    if (!d || !Array.isArray(d.pages)) return d;
    var MM = typeof window !== "undefined" ? window.MindmapDeck : null;
    if (!MM || !MM.normalizePageData) return d;
    for (var i = 0; i < d.pages.length; i++) {
      var p = d.pages[i];
      if (p && p.type === "mindmap" && p.data) {
        p.data = MM.normalizePageData(p.data);
      }
    }
    return d;
  }

  /** 在 deck-data / IndexedDB 快照合并后统一补齐思维导图页并规范化数据 */
  function finalizeDeckPages(d) {
    if (!d) return d;
    migrateMindmapPagesInDeck(d);
    return ensureMindmapPage(d);
  }

  /* ============================================================
   * 3. 表格页：ID 取号、查询
   *    第 0 张 → ""（旧 ID 兼容）；第 1 张 → "-sub"；其余 → `-t${idx}`
   * ============================================================ */

  function tablePages() {
    if (!deck || !Array.isArray(deck.pages)) return [];
    return deck.pages.filter(function (p) {
      return p && p.type === "table";
    });
  }

  function tableSlotIndex(page) {
    var ts = tablePages();
    for (var i = 0; i < ts.length; i++) {
      if (ts[i] === page || ts[i].id === page.id) return i;
    }
    return -1;
  }

  function tableSlotSuffix(idx) {
    if (idx === 0) return "";
    if (idx === 1) return "-sub";
    return "-t" + idx;
  }

  function tableStructureKey(page) {
    var idx = tableSlotIndex(page);
    if (idx === 0) return "obj";
    if (idx === 1) return "sub";
    return page.id;
  }

  function pageById(id) {
    if (!deck) return null;
    for (var i = 0; i < deck.pages.length; i++) {
      if (deck.pages[i].id === id) return deck.pages[i];
    }
    return null;
  }

  function pageByStructureKey(key) {
    if (key === "obj") return tablePages()[0] || null;
    if (key === "sub") return tablePages()[1] || null;
    return pageById(key);
  }

  function pageDomIds(page) {
    var idx = tableSlotIndex(page);
    var suf = tableSlotSuffix(idx);
    return {
      tableId: "comparison-table" + suf,
      theadId: "matrix-thead" + suf,
      tbodyId: "matrix-tbody" + suf,
      filterDeckId: "filter-deck" + suf,
      filterRowsId: "filter-rows" + suf,
      filterColsId: "filter-cols" + suf,
      anchorId:
        idx === 0
          ? "compare-fab-anchor-objective"
          : idx === 1
            ? "compare-fab-anchor-subjective"
            : "compare-fab-anchor-" + page.id,
    };
  }

  /* ============================================================
   * 4. 模板注册表
   * ============================================================ */

  var TEMPLATES = {
    cover: {
      label: "封面",
      defaultData: function () {
        return { eyebrow: "竞品分析", title: "新封面", subtitle: "" };
      },
      render: function (section, page, ctx) {
        var data = page.data || {};
        section.setAttribute("aria-label", "封面");
        section.innerHTML =
          '<div class="slide-inner">' +
          '<p class="cover-eyebrow" data-field="eyebrow">' +
          escapeHtml(data.eyebrow || "竞品分析") +
          "</p>" +
          '<h1 class="cover-title" data-field="title">' +
          (data.title || "") +
          "</h1>" +
          '<div class="cover-subtitle" data-field="subtitle"' +
          (subtitleVisible(data.subtitle) ? "" : " hidden") +
          ">" +
          (data.subtitle || "") +
          "</div>" +
          renderSlideActionsHtml(ctx) +
          "</div>";

        if (ctx.index === 0) {
          var et = section.querySelector('[data-field="eyebrow"]');
          if (et) et.id = "cover-eyebrow";
          var tt = section.querySelector('[data-field="title"]');
          if (tt) tt.id = "cover-title";
          var st = section.querySelector('[data-field="subtitle"]');
          if (st) st.id = "cover-subtitle";
        }
      },
      collectFromDom: function (section, page) {
        var eb = section.querySelector('[data-field="eyebrow"]');
        var t = section.querySelector('[data-field="title"]');
        var s = section.querySelector('[data-field="subtitle"]');
        page.data = page.data || {};
        if (eb) page.data.eyebrow = String(eb.innerText || "").trim();
        if (t) page.data.title = String(t.innerHTML || "").trim();
        if (s) page.data.subtitle = String(s.innerHTML || "").trim();
      },
    },

    overview: {
      label: "概述",
      defaultData: function () {
        return {
          title: "概述",
          sections: [
            { heading: "", bodyHtml: "<p>填充本页正文…</p>" },
          ],
        };
      },
      render: function (section, page, ctx) {
        var data = page.data || {};
        var sections = Array.isArray(data.sections) ? data.sections : [];
        var titleVisible = !!(data.title && String(data.title).trim());
        section.setAttribute("aria-label", "概述");
        var html =
          '<div class="slide-inner">' +
          '<h2 class="overview-title" data-field="overview-title"' +
          (titleVisible ? "" : " hidden") +
          ">" +
          escapeHtml(data.title || "") +
          "</h2>" +
          '<div class="overview-sections" data-field="overview-sections">';
        sections.forEach(function (sec) {
          html += '<article class="nested-block">';
          if (sec.heading && String(sec.heading).trim() !== "") {
            html +=
              '<h3 class="nested-heading">' + sec.heading + "</h3>";
          }
          html +=
            '<div class="nested-body">' + (sec.bodyHtml || "") + "</div>";
          html += "</article>";
        });
        html += "</div>" + renderSlideActionsHtml(ctx) + "</div>";
        section.innerHTML = html;

        if (firstPageOfType("overview") === page) {
          var tt = section.querySelector('[data-field="overview-title"]');
          if (tt) tt.id = "overview-title";
          var os = section.querySelector('[data-field="overview-sections"]');
          if (os) os.id = "overview-sections";
        }
      },
      collectFromDom: function (section, page) {
        var titleEl = section.querySelector('[data-field="overview-title"]');
        var sectionsRoot = section.querySelector('[data-field="overview-sections"]');
        page.data = page.data || {};
        if (titleEl && !titleEl.hasAttribute("hidden")) {
          page.data.title = String(titleEl.innerText || "").trim();
        }
        if (sectionsRoot) {
          page.data.sections = $all("article.nested-block", sectionsRoot).map(
            function (art) {
              var h = art.querySelector(".nested-heading");
              var b = art.querySelector(".nested-body");
              return {
                heading: h ? String(h.innerHTML || "").trim() : "",
                bodyHtml: b ? String(b.innerHTML || "").trim() : "",
              };
            }
          );
        }
      },
    },

    table: {
      label: "表格",
      defaultData: function () {
        return {
          title: "对比矩阵",
          matrix: defaultMatrixData(),
        };
      },
      render: function (section, page, ctx) {
        var data = page.data || {};
        var ids = pageDomIds(page);
        var structKey = tableStructureKey(page);
        section.setAttribute("aria-label", data.title || "对比矩阵");
        section.classList.add("slide-table");
        section.dataset.tableStructureKey = structKey;

        var html =
          '<div class="slide-inner">' +
          '<h2 class="slide-matrix-title" data-field="title">' +
          escapeHtml(data.title || "对比矩阵") +
          "</h2>" +
          '<div class="matrix-toolbar" id="' +
          ids.filterDeckId +
          '">' +
          "<div><h3>参数行</h3>" +
          '<div class="filter-group" id="' +
          ids.filterRowsId +
          '" aria-label="参数行"></div></div>' +
          "<div><h3>产品列</h3>" +
          '<div class="filter-group" id="' +
          ids.filterColsId +
          '" aria-label="产品列"></div></div>' +
          '<div class="matrix-structure-tools" aria-label="编辑表格结构">' +
          '<span class="matrix-structure-tools__hint">结构</span>' +
          structToolButton(structKey, "add-row", "+行") +
          structToolButton(structKey, "remove-row", "−行") +
          structToolButton(structKey, "add-col", "+列") +
          structToolButton(structKey, "remove-col", "−列") +
          structToolButton(
            structKey,
            "col-move-left",
            "列←",
            "编辑模式下先点一下列表头（会记住该列），再点此左移一列"
          ) +
          structToolButton(
            structKey,
            "col-move-right",
            "列→",
            "编辑模式下先点一下列表头（会记住该列），再点此右移一列"
          ) +
          structToolButton(
            structKey,
            "row-move-up",
            "行↑",
            "编辑模式下先点一下左侧参数行标题（会记住该行），再点此上移一行"
          ) +
          structToolButton(
            structKey,
            "row-move-down",
            "行↓",
            "编辑模式下先点一下左侧参数行标题（会记住该行），再点此下移一行"
          ) +
          "</div></div>" +
          '<div class="table-scroll">' +
          '<table id="' +
          ids.tableId +
          '"><thead id="' +
          ids.theadId +
          '"></thead><tbody id="' +
          ids.tbodyId +
          '"></tbody></table>' +
          "</div>" +
          '<div class="matrix-slide-footer">' +
          renderSlideActionsHtmlInner(ctx) +
          '<div class="compare-fab-anchor" id="' +
          ids.anchorId +
          '" aria-hidden="true"></div>' +
          "</div>" +
          "</div>";

        section.innerHTML = html;
        renderMatrixPage(page);
      },
      collectFromDom: function (section, page) {
        var ttl = section.querySelector('[data-field="title"]');
        page.data = page.data || {};
        if (ttl) page.data.title = String(ttl.innerText || "").trim();
        collectMatrixFromTable(page);
      },
    },

    mindmap: {
      label: "思维导图",
      defaultData: function () {
        var MM = window.MindmapDeck;
        return MM && MM.defaultPageData
          ? MM.defaultPageData()
          : { title: "思维导图", zoom: 1, roots: [] };
      },
      render: function (section, page, ctx) {
        var data = page.data || {};
        var MM = window.MindmapDeck;
        if (MM) data = MM.normalizePageData(data);
        section.setAttribute("aria-label", data.title || "思维导图");
        section.classList.add("slide-mindmap");
        var html =
          '<div class="slide-inner">' +
          '<h2 class="mindmap-title" data-field="title">' +
          escapeHtml(data.title || "思维导图") +
          "</h2>" +
          '<div class="mindmap-toolbar" aria-label="思维导图结构">' +
          '<span class="mindmap-toolbar__hint">结构</span>' +
          mindmapToolBtn(page.id, "add-hub", "+ 总节点") +
          mindmapToolBtn(page.id, "add-branch", "+ 分支") +
          mindmapToolBtn(page.id, "remove-branch", "− 分支") +
          mindmapToolBtn(page.id, "toggle-note", "说明") +
          "</div>" +
          (MM ? MM.renderZoomControls(page.id, data.zoom) : "") +
          '<div class="mindmap-entry-row">' +
          '<p class="mindmap-slide-hint" data-mindmap-hint>讲演时可缩放；点「编辑导图」可增删节点、拖拽布局</p>' +
          '<button type="button" class="btn mindmap-edit-cta" data-mindmap-enter-edit>编辑导图</button>' +
          "</div>" +
          '<div class="mindmap-viewport" data-mindmap-viewport>' +
          '<div class="mindmap-stage" data-mindmap-stage>' +
          '<div class="mindmap-canvas" data-mindmap-canvas></div>' +
          "</div></div>" +
          renderSlideActionsHtml(ctx) +
          "</div>";
        section.innerHTML = html;
        var firstHub = data.roots && data.roots[0] ? data.roots[0].id : "";
        section.setAttribute(
          "data-mindmap-selected",
          section.getAttribute("data-mindmap-selected") || firstHub
        );
        paintMindmapSection(section, page);
      },
      collectFromDom: function (section, page) {
        var ttl = section.querySelector('[data-field="title"]');
        page.data = page.data || {};
        if (ttl) page.data.title = String(ttl.innerText || "").trim();
        var MM = window.MindmapDeck;
        if (MM) page.data = MM.collectPageFromDom(section, page.data);
      },
    },

    ending: {
      label: "结束页",
      defaultData: function () {
        return deepClone(DEFAULT_ENDING_PAGE_DATA);
      },
      render: function (section, page, ctx) {
        var data = page.data || {};
        section.setAttribute("aria-label", "结束");
        section.innerHTML =
          '<div class="slide-inner">' +
          '<p class="cover-eyebrow" data-field="eyebrow">' +
          escapeHtml(data.eyebrow || "") +
          "</p>" +
          '<h1 class="cover-title" data-field="title">' +
          (data.title || "") +
          "</h1>" +
          '<div class="ending-body" data-field="body">' +
          (data.bodyHtml || "") +
          "</div>" +
          renderSlideActionsHtml(ctx) +
          "</div>";

        if (firstPageOfType("ending") === page) {
          var eb = section.querySelector('[data-field="eyebrow"]');
          if (eb) eb.id = "ending-eyebrow";
          var tt = section.querySelector('[data-field="title"]');
          if (tt) tt.id = "ending-title";
          var b = section.querySelector('[data-field="body"]');
          if (b) b.id = "ending-body";
        }
      },
      collectFromDom: function (section, page) {
        var eb = section.querySelector('[data-field="eyebrow"]');
        var t = section.querySelector('[data-field="title"]');
        var b = section.querySelector('[data-field="body"]');
        page.data = page.data || {};
        if (eb) page.data.eyebrow = String(eb.innerText || "").trim();
        if (t) page.data.title = String(t.innerHTML || "").trim();
        if (b) page.data.bodyHtml = String(b.innerHTML || "").trim();
      },
    },
  };

  function mindmapToolBtn(pageId, action, label) {
    return (
      '<button type="button" class="btn btn--ghost" ' +
      'data-mindmap-page="' +
      escapeHtmlAttr(pageId) +
      '" data-mindmap-action="' +
      action +
      '">' +
      label +
      "</button>"
    );
  }

  function paintMindmapSection(section, page) {
    var MM = window.MindmapDeck;
    if (!MM || !page.data) return;
    var viewport = section.querySelector("[data-mindmap-viewport]");
    var stage = section.querySelector("[data-mindmap-stage]");
    var canvas = section.querySelector("[data-mindmap-canvas]");
    if (!viewport || !stage || !canvas) return;
    page.data = MM.normalizePageData(page.data);
    var selected = MM.getSelectedId(section);
    var layout = MM.computeLayout(page.data);
    canvas.style.width = layout.width + "px";
    canvas.style.height = layout.height + "px";
    canvas.innerHTML =
      MM.renderEdgesSvg(layout.edges) + MM.renderNodesHtml(layout.nodes, selected);
    MM.applyViewportTransform(viewport, stage, layout, page.data.zoom);
    MM.bindViewportFit(viewport, stage, function () {
      return { layout: MM.computeLayout(page.data), zoom: page.data.zoom };
    });
    if (section.dataset.mindmapDragBound !== "1") {
      MM.bindNodeDrag(section, page.data, function () {
        MM.repaintEdgesFromDom(section, page.data);
      });
    }
    var zr = section.querySelector("[data-mindmap-zoom-range]");
    var zl = section.querySelector("[data-mindmap-zoom-label]");
    if (zr) {
      zr.value = String(Math.round((page.data.zoom || 1) * 100));
      if (!zr.dataset.bound) {
        zr.dataset.bound = "1";
        zr.addEventListener("input", function () {
          page.data.zoom = Number(zr.value) / 100;
          if (zl) zl.textContent = zr.value + "%";
          MM.applyViewportTransform(
            viewport,
            stage,
            MM.computeLayout(page.data),
            page.data.zoom
          );
        });
      }
      if (zl) zl.textContent = zr.value + "%";
    }
    if (deckEditActive) applyMindmapEditable(section);
  }

  function structToolButton(structKey, action, label, title) {
    return (
      '<button type="button" class="btn btn--ghost" ' +
      'data-matrix-structure="' +
      escapeHtmlAttr(structKey) +
      '" data-matrix-action="' +
      action +
      '"' +
      (title ? ' title="' + escapeHtmlAttr(title) + '"' : "") +
      ">" +
      label +
      "</button>"
    );
  }

  function subtitleVisible(s) {
    return !!(s && String(s).replace(/<[^>]*>/g, "").trim());
  }

  function firstPageOfType(t) {
    if (!deck) return null;
    for (var i = 0; i < deck.pages.length; i++) {
      if (deck.pages[i].type === t) return deck.pages[i];
    }
    return null;
  }

  function defaultMatrixData() {
    return {
      cornerLabel: "对比项 \\ 型号",
      rows: [
        { id: "row_0001", label: "新参数 1", hidden: false },
        { id: "row_0002", label: "新参数 2", hidden: false },
      ],
      columns: [
        { id: "p1", label: "产品 A", hidden: false },
        { id: "p2", label: "产品 B", hidden: false },
      ],
      cells: {
        "row_0001::p1": { summary: "", detailHtml: "<p>—</p>" },
        "row_0001::p2": { summary: "", detailHtml: "<p>—</p>" },
        "row_0002::p1": { summary: "", detailHtml: "<p>—</p>" },
        "row_0002::p2": { summary: "", detailHtml: "<p>—</p>" },
      },
    };
  }

  function renderSlideActionsHtml(ctx) {
    return renderSlideActionsHtmlInner(ctx);
  }

  function renderSlideActionsHtmlInner(ctx) {
    var prev = ctx.index > 0;
    var next = ctx.index < ctx.total - 1;
    var html = '<div class="slide-actions">';
    if (prev) {
      html +=
        '<button type="button" class="btn btn--ghost" data-slide-go="' +
        (ctx.index - 1) +
        '">← 上一页</button>';
    }
    if (next) {
      html +=
        '<button type="button" class="btn" data-slide-go="' +
        (ctx.index + 1) +
        '">下一页 →</button>';
    } else if (prev) {
      html +=
        '<button type="button" class="btn btn--ghost" data-slide-go="0">回封面</button>';
    }
    html += "</div>";
    return html;
  }

  /* ============================================================
   * 5. 渲染 deck → 幻灯
   * ============================================================ */

  /** #compare-fab-host 会挂进 deck-stage；清空 stage 前须移回 park，否则节点被一并销毁 */
  function parkCompareFabHostBeforeStageClear() {
    var host = $("#compare-fab-host");
    var park = $("#compare-fab-park");
    if (!host || !park) return;
    if (host.closest("#deck-stage")) {
      park.appendChild(host);
      host.setAttribute("hidden", "");
    }
  }

  function renderAllSlides() {
    var stage = $("#deck-stage");
    var nav = $("#slide-nav");
    if (!stage || !nav) return;

    if (slideIndexNav >= deck.pages.length) {
      slideIndexNav = Math.max(0, deck.pages.length - 1);
    }

    parkCompareFabHostBeforeStageClear();
    stage.innerHTML = "";
    nav.innerHTML = "";

    deck.pages.forEach(function (page, idx) {
      var section = document.createElement("section");
      section.setAttribute("data-slide", "");
      section.setAttribute("data-slide-index", String(idx));
      section.setAttribute("data-page-id", page.id);
      section.setAttribute("data-page-type", page.type);
      if (idx !== slideIndexNav) section.hidden = true;
      // 先把空 section 挂进 DOM，再让模板渲染（部分模板会用 document.getElementById
      // 查找子节点，要求 section 已经连进 document 树）
      stage.appendChild(section);
      var tpl = TEMPLATES[page.type];
      if (tpl && typeof tpl.render === "function") {
        try {
          tpl.render(section, page, { index: idx, total: deck.pages.length });
        } catch (err) {
          console.warn("[matrix-core] 模板渲染失败：", page.type, err);
          section.innerHTML =
            '<div class="slide-inner"><p>模板 ' +
            escapeHtml(page.type) +
            " 渲染失败</p></div>";
        }
      } else {
        section.innerHTML =
          '<div class="slide-inner"><p>未知模板：' +
          escapeHtml(page.type) +
          "</p></div>";
      }

      var dot = document.createElement("button");
      dot.type = "button";
      dot.setAttribute("data-slide-dot", String(idx));
      dot.setAttribute("data-page-id", page.id);
      var label = tpl ? tpl.label : page.type;
      dot.setAttribute("aria-label", label + "（第 " + (idx + 1) + " 页）");
      dot.title = label;
      nav.appendChild(dot);
    });

    bindSlideNav();
    bindAllPageFilters();
    bindStageDelegations();
    repositionCompareFabHost(slideIndexNav);
    syncActiveSlide();
    hydrateTitle();
    if (deckEditActive) applyEditableToDOM(true);
  }

  /** 仅切换 hidden + active 状态（不重新生成 DOM，保留输入/滚动位置） */
  function syncActiveSlide() {
    $all("[data-slide]").forEach(function (s) {
      var idx = Number(s.getAttribute("data-slide-index"));
      s.hidden = idx !== slideIndexNav;
      s.setAttribute("aria-hidden", idx === slideIndexNav ? "false" : "true");
    });
    $all("[data-slide-dot]").forEach(function (dot) {
      var idx = Number(dot.getAttribute("data-slide-dot"));
      dot.classList.toggle("is-active", idx === slideIndexNav);
      dot.setAttribute("aria-current", idx === slideIndexNav ? "true" : "false");
    });
    var nav = $("#slide-nav");
    if (nav) nav.dataset.activeIndex = String(slideIndexNav);
  }

  function clampSlideIdx(i) {
    var max = deck ? Math.max(0, deck.pages.length - 1) : 0;
    var n = parseInt(String(i), 10);
    if (isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > max) return max;
    return n;
  }

  function currentPage() {
    if (!deck) return null;
    return deck.pages[slideIndexNav] || null;
  }

  function goSlide(idx) {
    idx = clampSlideIdx(idx);
    var prev = slideIndexNav;
    if (prev !== idx) exitComparePickQuiet();
    slideIndexNav = idx;
    syncActiveSlide();
    repositionCompareFabHost(idx);
    try {
      history.replaceState(null, "", "#slide-" + idx);
    } catch (_) {}
  }

  function bindSlideNav() {
    $all("[data-slide-go]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var n = parseInt(btn.getAttribute("data-slide-go"), 10);
        if (!isNaN(n)) goSlide(n);
      });
    });
    $all("[data-slide-dot]").forEach(function (dot) {
      dot.addEventListener("click", function () {
        var n = parseInt(dot.getAttribute("data-slide-dot"), 10);
        if (!isNaN(n)) goSlide(n);
      });
    });
  }

  /** Compare-fab host 跟着当前页移动；非矩阵页停靠到 park */
  function repositionCompareFabHost(idx) {
    var host = $("#compare-fab-host");
    var park = $("#compare-fab-park");
    if (!host) return;
    var page = deck && deck.pages[idx];
    if (page && page.type === "table") {
      var ids = pageDomIds(page);
      var anchor = document.getElementById(ids.anchorId);
      if (anchor) {
        anchor.appendChild(host);
        host.removeAttribute("hidden");
        anchor.setAttribute("aria-hidden", "false");
        return;
      }
    }
    if (park) park.appendChild(host);
    host.setAttribute("hidden", "");
  }

  /* ============================================================
   * 6. 矩阵渲染（每一张表格页独立）
   * ============================================================ */

  function renderAllMatrices() {
    tablePages().forEach(function (page) {
      renderMatrixPage(page);
    });
    applyAllFilters();
  }

  function renderMatrixPage(page) {
    var m = page.data && page.data.matrix;
    if (!m || !Array.isArray(m.rows) || !Array.isArray(m.columns)) return;
    var ids = pageDomIds(page);
    var thead = document.getElementById(ids.theadId);
    var tbody = document.getElementById(ids.tbodyId);
    var filterRows = document.getElementById(ids.filterRowsId);
    var filterCols = document.getElementById(ids.filterColsId);
    if (!thead || !tbody || !filterRows || !filterCols) return;

    thead.innerHTML = "";
    tbody.innerHTML = "";
    filterRows.innerHTML = "";
    filterCols.innerHTML = "";

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
        td.dataset.pageId = page.id;
        td.setAttribute("tabindex", "0");
        td.setAttribute("role", "button");
        td.setAttribute("aria-label", "查看：" + formatCellModalAxisTitle(row.label, col.label));
        var ck = cellKey(row.id, col.id);
        var cellObj = m.cells[ck] || { summary: "", detailHtml: "<p>—</p>" };
        td.innerHTML = cellObj.summary
          ? cellObj.summary
          : '<span class="cell-empty">—</span>';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    m.rows.forEach(function (row) {
      var id = "rowfilter-" + page.id + "-" + row.id;
      var lab = document.createElement("label");
      lab.className = "filter-chip";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.checked = !row.hidden;
      input.dataset.axisId = row.id;
      input.dataset.axis = "row";
      input.dataset.pageId = page.id;
      lab.appendChild(input);
      var span = document.createElement("span");
      span.textContent = row.label;
      lab.appendChild(span);
      filterRows.appendChild(lab);
    });
    m.columns.forEach(function (col) {
      var id = "colfilter-" + page.id + "-" + col.id;
      var lab = document.createElement("label");
      lab.className = "filter-chip";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.checked = !col.hidden;
      input.dataset.axisId = col.id;
      input.dataset.axis = "column";
      input.dataset.pageId = page.id;
      lab.appendChild(input);
      var span = document.createElement("span");
      span.textContent = col.label;
      lab.appendChild(span);
      filterCols.appendChild(lab);
    });

    applyFiltersFor(page);
    bindCellInteractions(page);
    bindMatrixPickDelegationFor(page);
    syncComparePickUI();
    if (typeof window.__scheduleMatrixTableFit === "function") {
      window.__scheduleMatrixTableFit();
    }
  }

  function bindCellInteractions(page) {
    var ids = pageDomIds(page);
    var tbody = document.getElementById(ids.tbodyId);
    if (!tbody) return;
    $all(".matrix-cell", tbody).forEach(function (td) {
      td.addEventListener("click", function (ev) {
        if (comparePick.active) {
          ev.preventDefault();
          ev.stopPropagation();
          flashCompareNope(td);
          return;
        }
        if (deckEditActive) return;
        openCellModal(page, td.dataset.rowId, td.dataset.colId);
      });
      td.addEventListener("dblclick", function (ev) {
        if (comparePick.active) return;
        if (!deckEditActive) return;
        ev.preventDefault();
        openCellModal(page, td.dataset.rowId, td.dataset.colId);
      });
      td.addEventListener("keydown", function (ev) {
        if (comparePick.active) {
          if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
          return;
        }
        if (deckEditActive) return;
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openCellModal(page, td.dataset.rowId, td.dataset.colId);
        }
      });
    });
  }

  function bindAllPageFilters() {
    tablePages().forEach(function (page) {
      var ids = pageDomIds(page);
      var deckEl = document.getElementById(ids.filterDeckId);
      if (!deckEl || deckEl.dataset.bound === "1") return;
      deckEl.dataset.bound = "1";
      deckEl.addEventListener("change", onFilterChange);
    });
  }

  function onFilterChange(ev) {
    var t = ev.target;
    if (!t || t.tagName !== "INPUT" || t.type !== "checkbox") return;
    if (!deck) return;
    var pid = t.dataset.pageId;
    var page = pageById(pid);
    if (!page || !page.data || !page.data.matrix) return;
    var id = t.dataset.axisId;
    if (t.dataset.axis === "row") {
      var row = page.data.matrix.rows.find(function (r) {
        return r.id === id;
      });
      if (row) row.hidden = !t.checked;
    } else if (t.dataset.axis === "column") {
      var col = page.data.matrix.columns.find(function (c) {
        return c.id === id;
      });
      if (col) col.hidden = !t.checked;
    }
    applyFiltersFor(page);
    if (comparePick.active) syncComparePickUI();
  }

  function applyAllFilters() {
    tablePages().forEach(applyFiltersFor);
  }

  function applyFiltersFor(page) {
    var m = page.data && page.data.matrix;
    if (!m) return;
    var ids = pageDomIds(page);
    var tbody = document.getElementById(ids.tbodyId);
    var thead = document.getElementById(ids.theadId);
    if (!tbody || !thead) return;

    $all("tr", tbody).forEach(function (tr) {
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
    var ths = $all("th", thead);
    m.columns.forEach(function (col, j) {
      var th = ths[j + 1];
      if (th) th.hidden = !!col.hidden;
    });
    $all(".matrix-cell", tbody).forEach(function (td) {
      var cid = td.dataset.colId;
      td.hidden = !!hideCol[cid];
      td.setAttribute("aria-hidden", hideCol[cid] ? "true" : "false");
    });
  }

  function cellModalAxisSep() {
    return " × ";
  }

  function formatCellModalAxisTitle(rowLabel, colLabel) {
    return (
      String(rowLabel == null ? "" : rowLabel).trim() +
      cellModalAxisSep() +
      String(colLabel == null ? "" : colLabel).trim()
    );
  }

  function pageFromMatrixTableElement(tableEl) {
    if (!tableEl || !tableEl.id) return null;
    var tid = tableEl.id;
    var found = null;
    tablePages().forEach(function (p) {
      if (pageDomIds(p).tableId === tid) found = p;
    });
    return found;
  }

  function syncCellModalMetaFromMatrixIfOpen(page) {
    if (!page || !page.data || !page.data.matrix) return;
    var modal = $("#cell-modal");
    if (!modal || modal.hasAttribute("hidden")) return;
    if (String(modal.dataset.uploadPageId || "") !== String(page.id)) return;
    if (modalMetaDirty) return;
    var rid = modal.dataset.uploadRowId;
    var cid = modal.dataset.uploadColId;
    var meta = $("#modal-meta");
    if (!rid || !cid || !meta) return;
    var m = page.data.matrix;
    var row = m.rows.find(function (r) {
      return String(r.id) === String(rid);
    });
    var col = m.columns.find(function (c) {
      return String(c.id) === String(cid);
    });
    if (!row || !col) return;
    var t = formatCellModalAxisTitle(row.label, col.label);
    if (meta.textContent !== t) meta.textContent = t;
  }

  function parseModalMetaAxisLabels(metaEl) {
    if (!metaEl) return null;
    var raw = String(metaEl.innerText != null ? metaEl.innerText : metaEl.textContent || "").trim();
    var sep = cellModalAxisSep();
    var i = raw.indexOf(sep);
    if (i < 0) return null;
    var rowLab = raw.slice(0, i).trim();
    var colLab = raw.slice(i + sep.length).trim();
    if (!rowLab && !colLab) return null;
    return { row: rowLab, col: colLab };
  }

  function refreshMatrixCellAriaForTable(page) {
    var m = page.data && page.data.matrix;
    if (!m || !m.rows || !m.columns) return;
    var ids = pageDomIds(page);
    var table = document.getElementById(ids.tableId);
    if (!table) return;
    $all("tbody .matrix-cell", table).forEach(function (td) {
      var rid = td.dataset.rowId;
      var cid = td.dataset.colId;
      if (!rid || !cid) return;
      var row = m.rows.find(function (r) {
        return String(r.id) === String(rid);
      });
      var col = m.columns.find(function (c) {
        return String(c.id) === String(cid);
      });
      if (!row || !col) return;
      td.setAttribute("aria-label", "查看：" + formatCellModalAxisTitle(row.label, col.label));
    });
  }

  function applyModalAxisLabelsFromMetaToMatrixAndDom(page, rowId, colId) {
    var meta = $("#modal-meta");
    if (!meta || !page || !page.data || !page.data.matrix) return;
    var parsed = parseModalMetaAxisLabels(meta);
    if (!parsed) return;
    var m = page.data.matrix;
    var row = m.rows.find(function (r) {
      return String(r.id) === String(rowId);
    });
    var col = m.columns.find(function (c) {
      return String(c.id) === String(colId);
    });
    if (!row || !col) return;
    row.label = parsed.row;
    col.label = parsed.col;
    var ids = pageDomIds(page);
    var table = document.getElementById(ids.tableId);
    if (table) {
      $all("thead th[data-col-id]", table).forEach(function (th) {
        if (String(th.dataset.colId) === String(colId)) th.textContent = col.label;
      });
      $all("tbody tr", table).forEach(function (tr) {
        if (String(tr.dataset.rowId) !== String(rowId)) return;
        var rth = $(".matrix-row-head", tr);
        if (rth) rth.textContent = row.label;
      });
    }
    var fr = document.getElementById(ids.filterRowsId);
    if (fr) {
      $all("input[data-axis-id]", fr).forEach(function (inp) {
        if (String(inp.dataset.axisId) === String(rowId)) {
          var span = inp.nextElementSibling;
          if (span && String(span.tagName || "").toLowerCase() === "span") span.textContent = row.label;
        }
      });
    }
    var fc = document.getElementById(ids.filterColsId);
    if (fc) {
      $all("input[data-axis-id]", fc).forEach(function (inp) {
        if (String(inp.dataset.axisId) === String(colId)) {
          var span2 = inp.nextElementSibling;
          if (span2 && String(span2.tagName || "").toLowerCase() === "span") span2.textContent = col.label;
        }
      });
    }
    refreshMatrixCellAriaForTable(page);
  }

  function bindModalMetaAxisDirtyTracking() {
    if (document.documentElement.dataset.modalMetaAxisDirtyBound === "1") return;
    var meta = $("#modal-meta");
    if (!meta) return;
    document.documentElement.dataset.modalMetaAxisDirtyBound = "1";
    meta.addEventListener("input", function () {
      var modal = $("#cell-modal");
      if (deckEditActive && modal && !modal.hasAttribute("hidden")) modalMetaDirty = true;
    });
  }

  function bindMatrixAxisLabelInputDelegation() {
    if (document.documentElement.dataset.matrixAxisLabelInputBound === "1") return;
    document.documentElement.dataset.matrixAxisLabelInputBound = "1";
    function onMatrixAxisLabelMutated(ev) {
      if (!deckEditActive) return;
      var t = ev.target;
      if (!(t instanceof Element) || !t.isContentEditable) return;
      var th = t.closest("thead th[data-col-id], tbody th.matrix-row-head, thead th.matrix-corner");
      if (!th) return;
      var tbl = th.closest("table");
      if (!tbl) return;
      var page = pageFromMatrixTableElement(tbl);
      if (!page) return;
      collectMatrixFromTable(page);
      syncCellModalMetaFromMatrixIfOpen(page);
    }
    document.addEventListener("input", onMatrixAxisLabelMutated, true);
    document.addEventListener("compositionend", onMatrixAxisLabelMutated, true);
  }

  /* ============================================================
   * 7. 单元格 modal（详情）
   * ============================================================ */

  function openCellModal(page, rowId, colId) {
    var modal = $("#cell-modal");
    if (!modal) return;
    var m = page.data && page.data.matrix;
    if (!m) return;
    var row = m.rows.find(function (r) {
      return r.id === rowId;
    });
    var col = m.columns.find(function (c) {
      return c.id === colId;
    });
    if (!row || !col) return;
    var ck = cellKey(rowId, colId);
    var cellObj = m.cells[ck] || { summary: "", detailHtml: "<p>—</p>" };
    var meta = $("#modal-meta");
    var body = $("#modal-body");
    var shell = $("#modal-shell");
    var inp = $("#modal-image-input");
    modalMetaDirty = false;
    if (meta) {
      meta.textContent = formatCellModalAxisTitle(row.label, col.label);
      if (deckEditActive) setCe(meta, bestPlainCe());
      else setCe(meta, "inherit");
    }
    modal.dataset.uploadPageId = page.id;
    modal.dataset.uploadRowId = rowId;
    modal.dataset.uploadColId = colId;
    if (body) body.innerHTML = cellObj.detailHtml || "<p>—</p>";
    if (inp) inp.value = "";
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    if (deckEditActive && body) {
      body.contentEditable = "true";
      refreshFigureRemoveButtonsInModalBody();
    }
    if (shell) shell.focus();
  }

  function closeModal() {
    var modal = $("#cell-modal");
    if (!modal) return;
    var body = $("#modal-body");
    if (deckEditActive) flushModalDetailIntoDeckWhenOpen();
    modal.setAttribute("hidden", "");
    modal.setAttribute("aria-hidden", "true");
    delete modal.dataset.uploadPageId;
    delete modal.dataset.uploadRowId;
    delete modal.dataset.uploadColId;
    var meta = $("#modal-meta");
    if (meta) {
      setCe(meta, "inherit");
      meta.textContent = "";
    }
    modalMetaDirty = false;
    if (body) {
      body.removeAttribute("contenteditable");
      body.innerHTML = "";
    }
  }

  function bindModal() {
    var c = $("#modal-close");
    var b = $("#modal-backdrop");
    if (c) c.addEventListener("click", closeModal);
    if (b) b.addEventListener("click", closeModal);
    var photoBtn = $("#modal-photo-trigger");
    var imgInput = $("#modal-image-input");
    var shell = $("#modal-shell");
    if (
      photoBtn &&
      imgInput &&
      document.documentElement.dataset.modalPhotoBound !== "1"
    ) {
      document.documentElement.dataset.modalPhotoBound = "1";
      photoBtn.addEventListener("click", function () {
        if (!deckEditActive) return;
        imgInput.click();
      });
      imgInput.addEventListener("change", function () {
        if (!deckEditActive) return;
        if (imgInput.files && imgInput.files.length)
          appendUploadedDetailFigures(imgInput.files);
        imgInput.value = "";
      });
    }
    if (shell && document.documentElement.dataset.modalDropBound !== "1") {
      document.documentElement.dataset.modalDropBound = "1";
      shell.addEventListener("dragover", function (ev) {
        if (!deckEditActive) return;
        ev.preventDefault();
        try {
          ev.dataTransfer.dropEffect = "copy";
        } catch (err) {}
      });
      shell.addEventListener("drop", function (ev) {
        ev.preventDefault();
        if (!deckEditActive) return;
        var modal = $("#cell-modal");
        if (!modal || modal.hasAttribute("hidden")) return;
        var dt = ev.dataTransfer;
        if (!dt || !dt.files || !dt.files.length) return;
        appendUploadedDetailFigures(dt.files);
      });
    }
    bindModalMetaAxisDirtyTracking();
  }

  function readFileAsDataItem(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || "");
        var m = /^data:([^;]+);base64,(.+)$/.exec(s);
        if (!m) {
          reject(new Error("base64 parse"));
          return;
        }
        resolve({ mime: m[1] || "image/png", dataB64: m[2] });
      };
      r.onerror = function () {
        reject(r.error || new Error("FileReader"));
      };
      r.readAsDataURL(file);
    });
  }

  function appendDataItemFigure(body, it) {
    if (!body || !it || !it.dataB64) return;
    var fig = document.createElement("figure");
    fig.className = "detail-figure";
    var img = document.createElement("img");
    img.src = "data:" + it.mime + ";base64," + it.dataB64;
    img.alt = "";
    fig.appendChild(img);
    body.appendChild(fig);
  }

  function appendUploadedDetailFigures(fileList) {
    var modal = $("#cell-modal");
    var body = $("#modal-body");
    if (!deckEditActive || !modal || !body || !fileList || !fileList.length) return;
    if (modal.hasAttribute("hidden")) return;
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f && f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return;
    Promise.all(files.map(readFileAsDataItem))
      .then(function (items) {
        var mNow = $("#cell-modal");
        var bNow = $("#modal-body");
        if (!deckEditActive || !mNow || mNow.hasAttribute("hidden") || !bNow) return;
        items.forEach(function (it) {
          appendDataItemFigure(bNow, it);
        });
        refreshFigureRemoveButtonsInModalBody();
      })
      .catch(function (err) {
        console.warn("[matrix-core] 添加图片失败", err);
      });
  }

  function refreshFigureRemoveButtonsInModalBody() {
    if (!deckEditActive) return;
    var modal = $("#cell-modal");
    var body = $("#modal-body");
    if (!modal || modal.hasAttribute("hidden") || !body) return;
    $all(".detail-figure", body).forEach(function (fig) {
      if (fig.querySelector(".detail-upload-remove")) return;
      var bt = document.createElement("button");
      bt.type = "button";
      bt.className = "detail-upload-remove";
      bt.setAttribute("aria-label", "删除");
      bt.innerHTML = "\u2715";
      fig.appendChild(bt);
      bt.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
      });
      bt.addEventListener("click", function (ev2) {
        ev2.preventDefault();
        ev2.stopPropagation();
        if (fig.parentNode) fig.parentNode.removeChild(fig);
      });
    });
  }

  function cloneBodyStripFigureRemoveUi(body) {
    var w = body.cloneNode(true);
    $all(".detail-upload-remove", w).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    return String(w.innerHTML || "").trim();
  }

  function flushModalDetailIntoDeckWhenOpen() {
    var modal = $("#cell-modal");
    if (!modal || modal.hasAttribute("hidden")) return;
    var pid = modal.dataset.uploadPageId;
    var rid = modal.dataset.uploadRowId;
    var cid = modal.dataset.uploadColId;
    var body = $("#modal-body");
    if (!pid || !rid || !cid || !body) return;
    var page = pageById(pid);
    if (!page || !page.data || !page.data.matrix) return;
    var ck = cellKey(rid, cid);
    var co = page.data.matrix.cells[ck] || { summary: "", detailHtml: "<p>—</p>" };
    var stripped = cloneBodyStripFigureRemoveUi(body);
    co.detailHtml = stripped !== "" ? stripped : "<p>—</p>";
    page.data.matrix.cells[ck] = co;

    if (!deckEditActive) return;

    var meta = $("#modal-meta");
    if (modalMetaDirty && meta) {
      applyModalAxisLabelsFromMetaToMatrixAndDom(page, rid, cid);
      modalMetaDirty = false;
      return;
    }
    if (meta) {
      var row = page.data.matrix.rows.find(function (r) {
        return String(r.id) === String(rid);
      });
      var col = page.data.matrix.columns.find(function (c) {
        return String(c.id) === String(cid);
      });
      if (row && col) meta.textContent = formatCellModalAxisTitle(row.label, col.label);
    }
  }

  /* ============================================================
   * 8. Compare picker / report
   * ============================================================ */

  function exitComparePickQuiet() {
    comparePick.active = false;
    comparePick.rows = {};
    comparePick.cols = {};
    comparePick.pageId = null;
    syncComparePickUI();
  }
  function exitComparePick() {
    exitComparePickQuiet();
  }

  function activeComparePage() {
    if (comparePick.pageId) return pageById(comparePick.pageId);
    var cp = currentPage();
    if (cp && cp.type === "table") return cp;
    return null;
  }

  function isRowAxisHidden(rowId) {
    var page = activeComparePage();
    if (!page) return true;
    var m = page.data && page.data.matrix;
    if (!m) return true;
    var row = m.rows.find(function (r) {
      return r.id === rowId;
    });
    return !row || !!row.hidden;
  }
  function isColAxisHidden(colId) {
    var page = activeComparePage();
    if (!page) return true;
    var m = page.data && page.data.matrix;
    if (!m) return true;
    var col = m.columns.find(function (c) {
      return c.id === colId;
    });
    return !col || !!col.hidden;
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
  function compareSelectionValid() {
    return countCompareRowsSel() >= 1 && countCompareColsSel() >= 1;
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

  function startComparePick() {
    var cp = currentPage();
    if (!cp || cp.type !== "table") return;
    comparePick.pageId = cp.id;
    comparePick.active = true;
    pruneCompareSelection();
    syncComparePickUI();
  }

  function pruneCompareSelection() {
    var r = {};
    Object.keys(comparePick.rows).forEach(function (id) {
      if (comparePick.rows[id] && !isRowAxisHidden(id)) r[id] = true;
    });
    comparePick.rows = r;
    var c = {};
    Object.keys(comparePick.cols).forEach(function (id) {
      if (comparePick.cols[id] && !isColAxisHidden(id)) c[id] = true;
    });
    comparePick.cols = c;
  }

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

  function syncComparePickUI() {
    pruneCompareSelection();
    tablePages().forEach(function (page) {
      var ids = pageDomIds(page);
      var tbl = document.getElementById(ids.tableId);
      if (!tbl) return;
      var activeHere = comparePick.active && comparePick.pageId === page.id;
      tbl.classList.toggle("compare-picking", activeHere);
      tbl.classList.toggle(
        "compare-pick-cols-live",
        activeHere && countCompareRowsSel() >= 1
      );

      $all(".matrix-row-head", tbl).forEach(function (th) {
        th.classList.remove("is-cp-target", "is-cp-selected", "is-cp-muted");
        if (!activeHere) return;
        var rid = th.dataset.rowId;
        if (rid && !isRowAxisHidden(rid)) {
          th.classList.add("is-cp-target");
          if (comparePick.rows[rid]) th.classList.add("is-cp-selected");
        } else if (rid) {
          th.classList.add("is-cp-muted");
        }
      });
      $all("thead th", tbl).forEach(function (th) {
        th.classList.remove(
          "is-cp-corner",
          "is-cp-target",
          "is-cp-selected",
          "is-cp-locked",
          "is-cp-muted"
        );
        if (!activeHere) return;
        var cid = th.dataset.colId;
        if (!cid) {
          th.classList.add("is-cp-corner", "is-cp-muted");
          return;
        }
        var canCols = countCompareRowsSel() >= 1;
        var colOk = cid && !isColAxisHidden(cid);
        if (canCols && colOk) {
          th.classList.add("is-cp-target");
          if (comparePick.cols[cid]) th.classList.add("is-cp-selected");
        } else if (colOk) {
          th.classList.add("is-cp-locked");
        } else {
          th.classList.add("is-cp-muted");
        }
      });
      $all("tbody .matrix-cell", tbl).forEach(function (td) {
        td.classList.toggle("is-cp-muted", activeHere);
      });
    });

    var main = $("#compare-launch-btn");
    var cx = $("#compare-fab-cancel");
    if (main) {
      if (!comparePick.active) {
        main.textContent = "详细对比";
        main.classList.remove("compare-fab__main--armed");
        main.setAttribute("aria-expanded", "false");
      } else {
        main.textContent = "生成对比报告";
        main.classList.toggle(
          "compare-fab__main--armed",
          compareSelectionValid()
        );
        main.setAttribute("aria-expanded", "true");
      }
    }
    if (cx) {
      cx.hidden = !comparePick.active;
      cx.style.display = comparePick.active ? "" : "none";
    }
  }

  function bindMatrixPickDelegationFor(page) {
    var ids = pageDomIds(page);
    var tbl = document.getElementById(ids.tableId);
    if (!tbl || tbl.dataset.pickDeleg === "1") return;
    tbl.dataset.pickDeleg = "1";
    tbl.addEventListener("click", function (ev) {
      if (!comparePick.active || comparePick.pageId !== page.id) return;
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
  }

  function compareReportHeavyMedia(mx, rowIds, colIds) {
    if (!mx || !mx.cells) return false;
    var heavy = false;
    rowIds.forEach(function (rid) {
      colIds.forEach(function (cid) {
        if (heavy) return;
        var ck = cellKey(rid, cid);
        var d =
          mx.cells[ck] && mx.cells[ck].detailHtml != null
            ? String(mx.cells[ck].detailHtml)
            : "";
        if (/<img\b/i.test(d) || /detail-figure/.test(d)) heavy = true;
      });
    });
    return heavy;
  }
  function compareReportCellMinPx(nc, heavy) {
    var n = Math.max(1, nc);
    var spread = Math.round(980 / n);
    var lo = heavy ? 228 : 198;
    var hi = heavy ? 400 : 360;
    return Math.min(hi, Math.max(lo, spread));
  }

  function buildCompareReportHTML(m, rowIds, colIds) {
    var nr = rowIds.length;
    var nc = colIds.length;
    var heavy = compareReportHeavyMedia(m, rowIds, colIds);
    var cellMin = compareReportCellMinPx(nc, heavy);
    var rootStyle =
      "--cr-cols:" +
      nc +
      ";--cr-cell-min:" +
      cellMin +
      "px;--cr-gap:0.65rem;";
    var intro =
      '<header class="cr-intro cr-intro--tight"><p class="cr-muted cr-intro-meta">' +
      nr +
      " 项 × " +
      nc +
      " 款</p></header>";
    var body = "";
    rowIds.forEach(function (rowId, rbx) {
      var row = m.rows.find(function (r) {
        return r.id === rowId;
      });
      var rowLabel = row ? row.label : rowId;
      body +=
        '<section class="cr-block"><div class="cr-block-head"><h4 class="cr-block-title">' +
        rowLabel +
        '</h4><span class="cr-block-chip">' +
        nc +
        " 款并列</span></div>";
      body +=
        '<div class="cr-model-grid-scroll"><div class="cr-model-grid">';
      colIds.forEach(function (colId, cix) {
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
          's"><header class="cr-card-head"><span class="cr-chip">' +
          colLabel +
          '</span><span class="cr-param">' +
          rowLabel +
          '</span></header><div class="cr-sum">' +
          summary +
          '</div><div class="cr-detail">' +
          detail +
          "</div></article>";
      });
      body += "</div></div></section>";
    });
    return (
      '<div class="cr-report-root" style="' +
      rootStyle +
      '" data-cr-cols="' +
      nc +
      '" data-cr-heavy="' +
      (heavy ? "1" : "0") +
      '">' +
      intro +
      body +
      "</div>"
    );
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
    var modal = $("#compare-report-modal");
    if (!modal || modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";
    var cls = $("#compare-report-close");
    var bk = $("#compare-report-backdrop");
    if (cls) cls.addEventListener("click", closeCompareReportModal);
    if (bk) bk.addEventListener("click", closeCompareReportModal);
  }

  function runCompareGenerate() {
    if (!compareSelectionValid()) return;
    var page = activeComparePage();
    if (!page) return;
    var m = page.data && page.data.matrix;
    if (!m) return;
    var orderR = m.rows
      .map(function (r) {
        return r.id;
      })
      .filter(function (id) {
        return !!comparePick.rows[id] && !isRowAxisHidden(id);
      });
    var orderC = m.columns
      .map(function (c) {
        return c.id;
      })
      .filter(function (id) {
        return !!comparePick.cols[id] && !isColAxisHidden(id);
      });
    if (!orderR.length || !orderC.length) return;
    openCompareReportModal(buildCompareReportHTML(m, orderR, orderC));
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
      if (compareSelectionValid()) runCompareGenerate();
      else flashCompareNope(btn);
    });
    if (cx && cx.dataset.bound !== "1") {
      cx.dataset.bound = "1";
      cx.addEventListener("click", function () {
        exitComparePick();
      });
    }
  }

  /* ============================================================
   * 9. 矩阵结构工具（行列增删 / 顺序换位）
   * ============================================================ */

  var lastMatrixAxisPick = {};

  function bindMatrixAxisPickMemory() {
    if (document.documentElement.dataset.matrixAxisPickBound === "1") return;
    document.documentElement.dataset.matrixAxisPickBound = "1";
    document.addEventListener(
      "focusin",
      function (ev) {
        if (!deckEditActive) return;
        var t = ev.target;
        if (!(t instanceof Element)) return;
        var pageSection = t.closest('[data-slide][data-page-type="table"]');
        if (!pageSection) return;
        var pid = pageSection.getAttribute("data-page-id");
        if (!pid) return;
        var slot = lastMatrixAxisPick[pid] || (lastMatrixAxisPick[pid] = {
          colId: null,
          rowId: null,
        });
        if (t.closest("thead") && t.hasAttribute("data-col-id")) {
          slot.colId = String(t.dataset.colId || "");
          return;
        }
        if (
          t.classList.contains("matrix-row-head") &&
          t.closest("tbody") &&
          t.getAttribute("data-row-id") != null
        ) {
          slot.rowId = String(t.getAttribute("data-row-id"));
        }
      },
      true
    );
  }

  function getStructTargetColId(page) {
    var slot = lastMatrixAxisPick[page.id];
    if (slot && slot.colId) return slot.colId;
    var ae = document.activeElement;
    if (!ae || !(ae instanceof Element)) return null;
    var th = ae.closest("thead th[data-col-id]");
    if (!th) return null;
    var section = th.closest('[data-page-id="' + page.id + '"]');
    if (!section) return null;
    return th.dataset.colId || null;
  }
  function getStructTargetRowId(page) {
    var slot = lastMatrixAxisPick[page.id];
    if (slot && slot.rowId) return slot.rowId;
    var ae = document.activeElement;
    if (!ae || !(ae instanceof Element)) return null;
    var th = ae.closest("tbody th.matrix-row-head");
    if (!th) return null;
    var section = th.closest('[data-page-id="' + page.id + '"]');
    if (!section) return null;
    return th.dataset.rowId || null;
  }

  function ensureCells(m) {
    m.cells = m.cells || {};
  }

  function addMatrixRow(page) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = page.data && page.data.matrix;
    if (!m || !m.rows || !m.columns) return;
    if (m.rows.length >= 80 || m.columns.length >= 40) return;
    ensureCells(m);
    var newId = "row_e_" + String(Date.now());
    m.rows.push({ id: newId, label: "新参数", hidden: false });
    m.columns.forEach(function (col) {
      m.cells[cellKey(newId, col.id)] = { summary: "", detailHtml: "<p>—</p>" };
    });
    renderMatrixPage(page);
    if (deckEditActive) applyMatrixTableEditable(page, bestPlainCe());
  }
  function removeLastMatrixRow(page) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = page.data && page.data.matrix;
    if (!m || m.rows.length <= 1) return;
    ensureCells(m);
    var row = m.rows.pop();
    m.columns.forEach(function (col) {
      delete m.cells[cellKey(row.id, col.id)];
    });
    renderMatrixPage(page);
    if (deckEditActive) applyMatrixTableEditable(page, bestPlainCe());
  }
  function addMatrixColumn(page) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = page.data && page.data.matrix;
    if (!m || !m.rows || !m.columns) return;
    if (m.rows.length >= 80 || m.columns.length >= 40) return;
    ensureCells(m);
    var newId = "col_e_" + String(Date.now());
    m.columns.push({ id: newId, label: "新型号", hidden: false });
    m.rows.forEach(function (row) {
      m.cells[cellKey(row.id, newId)] = { summary: "", detailHtml: "<p>—</p>" };
    });
    renderMatrixPage(page);
    if (deckEditActive) applyMatrixTableEditable(page, bestPlainCe());
  }
  function removeLastMatrixColumn(page) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = page.data && page.data.matrix;
    if (!m || m.columns.length <= 1) return;
    ensureCells(m);
    var col = m.columns.pop();
    m.rows.forEach(function (row) {
      delete m.cells[cellKey(row.id, col.id)];
    });
    renderMatrixPage(page);
    if (deckEditActive) applyMatrixTableEditable(page, bestPlainCe());
  }
  function swapMatrixColumn(page, colId, delta) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = page.data && page.data.matrix;
    if (!m || !colId) return;
    var j = -1;
    for (var i = 0; i < m.columns.length; i++) {
      if (String(m.columns[i].id) === String(colId)) {
        j = i;
        break;
      }
    }
    var k = j + delta;
    if (j < 0 || k < 0 || k >= m.columns.length) return;
    var t = m.columns[j];
    m.columns[j] = m.columns[k];
    m.columns[k] = t;
    renderMatrixPage(page);
    if (deckEditActive) applyMatrixTableEditable(page, bestPlainCe());
  }
  function swapMatrixRow(page, rowId, delta) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = page.data && page.data.matrix;
    if (!m || !rowId) return;
    var j = -1;
    for (var i = 0; i < m.rows.length; i++) {
      if (String(m.rows[i].id) === String(rowId)) {
        j = i;
        break;
      }
    }
    var k = j + delta;
    if (j < 0 || k < 0 || k >= m.rows.length) return;
    var t = m.rows[j];
    m.rows[j] = m.rows[k];
    m.rows[k] = t;
    renderMatrixPage(page);
    if (deckEditActive) applyMatrixTableEditable(page, bestPlainCe());
  }

  function bindStageDelegations() {
    if (document.documentElement.dataset.stageDelegBound === "1") return;
    document.documentElement.dataset.stageDelegBound = "1";
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!(t instanceof Element)) return;
      var btn = t.closest("[data-matrix-action]");
      if (!btn) return;
      if (!deckEditActive) return;
      var structKey = btn.getAttribute("data-matrix-structure");
      var action = btn.getAttribute("data-matrix-action");
      var page = pageByStructureKey(structKey);
      if (!page || !action) return;
      if (action === "add-row") addMatrixRow(page);
      else if (action === "remove-row") removeLastMatrixRow(page);
      else if (action === "add-col") addMatrixColumn(page);
      else if (action === "remove-col") removeLastMatrixColumn(page);
      else if (action === "col-move-left") {
        var ci = getStructTargetColId(page);
        if (ci) swapMatrixColumn(page, ci, -1);
      } else if (action === "col-move-right") {
        var cj = getStructTargetColId(page);
        if (cj) swapMatrixColumn(page, cj, 1);
      } else if (action === "row-move-up") {
        var ri = getStructTargetRowId(page);
        if (ri) swapMatrixRow(page, ri, -1);
      } else if (action === "row-move-down") {
        var rj = getStructTargetRowId(page);
        if (rj) swapMatrixRow(page, rj, 1);
      }
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  function bindMindmapDelegations() {
    if (document.documentElement.dataset.mindmapDelegBound === "1") return;
    document.documentElement.dataset.mindmapDelegBound = "1";
    var MM = window.MindmapDeck;
    if (!MM) return;

    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!(t instanceof Element)) return;

      var enterEdit = t.closest("[data-mindmap-enter-edit]");
      if (enterEdit) {
        var ent = document.getElementById("deck-edit-enter");
        if (ent) ent.click();
        ev.preventDefault();
        return;
      }

      var nodeEl = t.closest(".mindmap-node[data-node-id]");
      if (nodeEl && nodeEl.closest("[data-page-type='mindmap']")) {
        var sec0 = nodeEl.closest("[data-slide]");
        if (sec0 && deckEditActive) {
          MM.setSelectedId(sec0, nodeEl.getAttribute("data-node-id"));
        }
      }

      var btn = t.closest("[data-mindmap-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-mindmap-action");
      var pageId = btn.getAttribute("data-mindmap-page");
      var page = pageById(pageId);
      if (!page || page.type !== "mindmap") return;
      var section = document.querySelector(
        '[data-slide][data-page-id="' + page.id + '"]'
      );
      if (!section) return;

      var zoomOnly =
        action === "zoom-in" || action === "zoom-out" || action === "zoom-reset";
      if (!zoomOnly && !deckEditActive) return;

      syncDeckFromEditableDomBeforeMatrixRebuild();
      page.data = MM.normalizePageData(page.data);
      var sel = MM.getSelectedId(section);

      if (action === "add-hub") {
        MM.addHub(page.data);
        var hubs = page.data.roots;
        if (hubs.length) MM.setSelectedId(section, hubs[hubs.length - 1].id);
        paintMindmapSection(section, page);
      } else if (action === "add-branch") {
        MM.addChild(page.data, sel);
        paintMindmapSection(section, page);
      } else if (action === "remove-branch") {
        var selNode = MM.findNodeInForest(page.data.roots, sel);
        if (!selNode) return;
        if (MM.isHubNode(page.data.roots, sel)) {
          if (MM.removeHub(page.data, sel) && page.data.roots[0]) {
            MM.setSelectedId(section, page.data.roots[0].id);
          }
        } else {
          var par = MM.findParentInForest(page.data.roots, sel);
          if (selNode.children && selNode.children.length) {
            MM.removeChild(page.data, selNode.id, null);
          } else if (par) {
            MM.removeChild(page.data, par.id, sel);
            MM.setSelectedId(section, par.id);
          }
        }
        paintMindmapSection(section, page);
      } else if (action === "toggle-note") {
        var n = MM.findNodeInForest(page.data.roots, sel);
        if (n) {
          if (noteVisibleMindmap(n.note)) {
            n.note = "";
          } else {
            n.note = "引出说明…";
          }
          paintMindmapSection(section, page);
        }
      } else if (action === "zoom-in") {
        page.data.zoom = Math.min(MM.ZOOM_MAX, (page.data.zoom || 1) + 0.12);
        paintMindmapSection(section, page);
      } else if (action === "zoom-out") {
        page.data.zoom = Math.max(MM.ZOOM_MIN, (page.data.zoom || 1) - 0.12);
        paintMindmapSection(section, page);
      } else if (action === "zoom-reset") {
        page.data.zoom = 1;
        paintMindmapSection(section, page);
      }
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  function noteVisibleMindmap(note) {
    return !!(note && String(note).replace(/\s/g, "").length);
  }

  /* ============================================================
   * 10. 编辑模式 / DOM 收集 / 保存
   * ============================================================ */

  function bestPlainCe() {
    try {
      var probe = document.createElement("div");
      probe.contentEditable = "plaintext-only";
      return probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";
    } catch (e) {
      return "true";
    }
  }

  function applyMindmapEditable(section) {
    var plc = bestPlainCe();
    $all(".mindmap-node__label", section).forEach(function (el) {
      setCe(el, plc);
    });
    $all(".mindmap-node__note:not([hidden])", section).forEach(function (el) {
      setCe(el, plc);
    });
  }

  function applyMatrixTableEditable(page, plc) {
    var ids = pageDomIds(page);
    var tbl = document.getElementById(ids.tableId);
    if (!tbl) return;
    $all("thead .matrix-corner", tbl).forEach(function (th) {
      th.contentEditable = plc;
    });
    $all("thead th:not(.matrix-corner)", tbl).forEach(function (th) {
      th.contentEditable = plc;
    });
    $all("tbody .matrix-row-head", tbl).forEach(function (th) {
      th.contentEditable = plc;
    });
    $all("tbody .matrix-cell", tbl).forEach(function (td) {
      td.contentEditable = plc;
    });
  }

  function applyEditableToDOM(on) {
    deckEditActive = !!on;
    document.body.classList.toggle("deck--editing", !!on);
    var plc = on ? bestPlainCe() : "inherit";
    var stage = $("#deck-stage");
    if (!stage) return;
    $all("[data-slide]", stage).forEach(function (sec) {
      var t = sec.getAttribute("data-page-type");
      var inl = sec.querySelector(".slide-inner");
      if (!inl) return;
      if (t === "cover" || t === "ending") {
        var eb = sec.querySelector('[data-field="eyebrow"]');
        var tt = sec.querySelector('[data-field="title"]');
        var bo = sec.querySelector('[data-field="subtitle"], [data-field="body"]');
        setCe(eb, on ? plc : "inherit");
        setCe(tt, on ? "true" : "inherit");
        setCe(bo, on ? "true" : "inherit");
      } else if (t === "overview") {
        var ot = sec.querySelector('[data-field="overview-title"]');
        if (ot && !ot.hasAttribute("hidden")) setCe(ot, on ? plc : "inherit");
        $all(".nested-heading, .nested-body", sec).forEach(function (n) {
          setCe(n, on ? "true" : "inherit");
        });
      } else if (t === "table") {
        var ttl = sec.querySelector('[data-field="title"]');
        setCe(ttl, on ? plc : "inherit");
        var pid = sec.getAttribute("data-page-id");
        var page = pageById(pid);
        if (page) applyMatrixTableEditable(page, on ? plc : "inherit");
      } else if (t === "mindmap") {
        var mttl = sec.querySelector('[data-field="title"]');
        setCe(mttl, on ? plc : "inherit");
        if (on) applyMindmapEditable(sec);
        else {
          $all(".mindmap-node__label, .mindmap-node__note", sec).forEach(function (n) {
            setCe(n, "inherit");
          });
        }
      }
    });
    var mbody = $("#modal-body");
    var mmeta = $("#modal-meta");
    var cmod = $("#cell-modal");
    if (on && mbody && cmod && !cmod.hasAttribute("hidden")) {
      mbody.contentEditable = "true";
      if (mmeta) setCe(mmeta, plc);
      refreshFigureRemoveButtonsInModalBody();
    } else if (!on) {
      if (mbody) mbody.removeAttribute("contenteditable");
      if (mmeta) setCe(mmeta, "inherit");
      $all("#modal-body .detail-upload-remove").forEach(function (b3) {
        if (b3.parentNode) b3.parentNode.removeChild(b3);
      });
      lastMatrixAxisPick = {};
    }
  }
  function setCe(el, val) {
    if (!el) return;
    if (val === "inherit") el.removeAttribute("contenteditable");
    else el.contentEditable = val;
  }

  function collectDOMIntoDeck() {
    if (!deck) return;
    $all("[data-slide]").forEach(function (sec) {
      var pid = sec.getAttribute("data-page-id");
      var page = pageById(pid);
      if (!page) return;
      var tpl = TEMPLATES[page.type];
      if (tpl && typeof tpl.collectFromDom === "function") {
        try {
          tpl.collectFromDom(sec, page);
        } catch (err) {
          console.warn("[matrix-core] 收集失败：", page.type, err);
        }
      }
    });
  }

  function collectMatrixFromTable(page) {
    var ids = pageDomIds(page);
    var table = document.getElementById(ids.tableId);
    if (!table || !page.data || !page.data.matrix) return;
    var m = page.data.matrix;
    var cr = $("thead .matrix-corner", table);
    if (cr) m.cornerLabel = String(cr.innerText || "").trim();
    var ths = $all("thead th", table);
    for (var ii = 1; ii < ths.length; ii++) {
      var th = ths[ii];
      var cid = th.dataset.colId;
      if (!cid) continue;
      var col = m.columns.find(function (x) {
        return String(x.id) === String(cid);
      });
      if (col) col.label = String(th.innerText || "").trim();
    }
    $all("tbody tr", table).forEach(function (tr) {
      var rid = tr.dataset.rowId;
      if (!rid) return;
      var rth = $(".matrix-row-head", tr);
      if (rth) {
        var row = m.rows.find(function (x) {
          return String(x.id) === String(rid);
        });
        if (row) row.label = String(rth.innerText || "").trim();
      }
      $all(".matrix-cell", tr).forEach(function (td) {
        var cid2 = td.dataset.colId;
        if (!cid2) return;
        var ck = cellKey(rid, cid2);
        var cellObj = m.cells[ck] || { summary: "", detailHtml: "<p>—</p>" };
        var t = String(td.innerText != null ? td.innerText : td.textContent || "")
          .replace(/\u00a0/g, " ")
          .replace(/\u2014|\u2212|\uff0d/g, "-")
          .trim();
        cellObj.summary = t.replace(/^[\-\u2014\u2212]+$/, "").trim();
        m.cells[ck] = cellObj;
      });
    });
    syncMatrixFilterChipLabelsFromMatrix(page);
    syncCellModalMetaFromMatrixIfOpen(page);
  }

  function syncMatrixFilterChipLabelsFromMatrix(page) {
    var m = page.data && page.data.matrix;
    if (!m || !m.rows || !m.columns) return;
    var ids = pageDomIds(page);
    var fr = document.getElementById(ids.filterRowsId);
    var fc = document.getElementById(ids.filterColsId);
    if (fr) {
      $all('input[data-axis="row"]', fr).forEach(function (inp) {
        var rid = inp.dataset.axisId;
        if (!rid) return;
        var row = m.rows.find(function (r) {
          return String(r.id) === String(rid);
        });
        if (!row) return;
        var span = inp.nextElementSibling;
        if (span && String(span.tagName || "").toLowerCase() === "span") span.textContent = row.label;
      });
    }
    if (fc) {
      $all('input[data-axis="column"]', fc).forEach(function (inp) {
        var cid = inp.dataset.axisId;
        if (!cid) return;
        var col = m.columns.find(function (c) {
          return String(c.id) === String(cid);
        });
        if (!col) return;
        var span2 = inp.nextElementSibling;
        if (span2 && String(span2.tagName || "").toLowerCase() === "span") span2.textContent = col.label;
      });
    }
  }

  function syncDeckFromEditableDomBeforeMatrixRebuild() {
    if (deckEditActive && deck) collectDOMIntoDeck();
  }

  /* ============================================================
   * 11. 添加 / 复制 / 删除页
   * ============================================================ */

  function addPageOfTypeAfterCurrent(type) {
    if (!deck || !TEMPLATES[type]) return;
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var idx = slideIndexNav;
    var data;
    var sourceTablePage = type === "table" ? findNearestTablePageForClone(idx) : null;
    if (sourceTablePage) {
      data = deepClone(sourceTablePage.data);
      data.title = (data.title || "对比矩阵") + "（副本）";
    } else {
      data = TEMPLATES[type].defaultData();
    }
    var page = { id: newPageId(type), type: type, data: data };
    deck.pages.splice(idx + 1, 0, page);
    slideIndexNav = idx + 1;
    renderAllSlides();
  }

  function duplicateCurrentPage() {
    if (!deck) return;
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var idx = slideIndexNav;
    var src = deck.pages[idx];
    if (!src) return;
    var clone = {
      id: newPageId(src.type),
      type: src.type,
      data: deepClone(src.data || {}),
    };
    deck.pages.splice(idx + 1, 0, clone);
    slideIndexNav = idx + 1;
    renderAllSlides();
  }

  function deleteCurrentPage() {
    if (!deck) return;
    if (deck.pages.length <= 1) return;
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var idx = slideIndexNav;
    deck.pages.splice(idx, 1);
    if (slideIndexNav >= deck.pages.length) slideIndexNav = deck.pages.length - 1;
    renderAllSlides();
  }

  function findNearestTablePageForClone(idx) {
    if (!deck) return null;
    if (deck.pages[idx] && deck.pages[idx].type === "table") return deck.pages[idx];
    var ts = tablePages();
    return ts[0] || null;
  }

  function bindPageToolbar() {
    if (document.documentElement.dataset.pageToolbarBound === "1") return;
    document.documentElement.dataset.pageToolbarBound = "1";
    $all("[data-page-add]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-page-add");
        addPageOfTypeAfterCurrent(t);
      });
    });
    $all('[data-page-action="duplicate"]').forEach(function (btn) {
      btn.addEventListener("click", duplicateCurrentPage);
    });
    $all('[data-page-action="delete"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (
          deck &&
          deck.pages.length > 1 &&
          window.confirm("删除当前页？此操作可通过「退出」放弃。")
        ) {
          deleteCurrentPage();
        }
      });
    });
  }

  /* ============================================================
   * 12. 键盘 / Escape 栈
   * ============================================================ */

  function bindKeyboard() {
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        var crm = $("#compare-report-modal");
        if (crm && !crm.hasAttribute("hidden")) {
          closeCompareReportModal();
          ev.preventDefault();
          return;
        }
        var modal = $("#cell-modal");
        if (modal && !modal.hasAttribute("hidden")) {
          closeModal();
          ev.preventDefault();
          return;
        }
        if (comparePick.active) {
          exitComparePick();
          ev.preventDefault();
        }
        return;
      }
      var crm2 = $("#compare-report-modal");
      if (crm2 && !crm2.hasAttribute("hidden")) return;
      var modal2 = $("#cell-modal");
      if (modal2 && !modal2.hasAttribute("hidden")) return;
      var t = ev.target;
      var tag = t && t.tagName ? String(t.tagName) : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown" || ev.key === "PageDown") {
        ev.preventDefault();
        goSlide(slideIndexNav + 1);
      } else if (
        ev.key === "ArrowLeft" ||
        ev.key === "ArrowUp" ||
        ev.key === "PageUp"
      ) {
        ev.preventDefault();
        goSlide(slideIndexNav - 1);
      }
    });
  }

  /* ============================================================
   * 13. Hash 导航
   * ============================================================ */

  function bindHashNav() {
    window.addEventListener("hashchange", function () {
      var m = location.hash.match(/^#slide-(\d+)/);
      if (m) goSlide(Number(m[1]));
    });
    var m0 = location.hash.match(/^#slide-(\d+)/);
    if (m0) slideIndexNav = clampSlideIdx(Number(m0[1]));
  }

  /* ============================================================
   * 14. IndexedDB 快照 + 导入导出
   * ============================================================ */

  var DECK_DB_NAME = "matrix-cell-detail-uploads";
  var DECK_DB_STORE = "deckPatch";
  var DECK_DB_VER = 2;
  var DECK_DB_KEY = "deck-pages-v1";
  var DECK_DB_OK = true;
  var MEM_DECK_FULL = null;

  function dbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("no indexedDB"));
        return;
      }
      var req = indexedDB.open(DECK_DB_NAME, DECK_DB_VER);
      req.onerror = function () {
        reject(req.error || new Error("idb open"));
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains("byKey")) db.createObjectStore("byKey");
        if (!db.objectStoreNames.contains(DECK_DB_STORE))
          db.createObjectStore(DECK_DB_STORE);
      };
    });
  }
  function dbGet() {
    if (!DECK_DB_OK) return Promise.resolve(MEM_DECK_FULL);
    return dbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        if (!db.objectStoreNames.contains(DECK_DB_STORE)) {
          resolve(null);
          db.close();
          return;
        }
        var tx = db.transaction(DECK_DB_STORE, "readonly");
        var rq = tx.objectStore(DECK_DB_STORE).get(DECK_DB_KEY);
        rq.onsuccess = function () {
          resolve(rq.result);
        };
        rq.onerror = function () {
          reject(rq.error);
        };
        tx.oncomplete = function () {
          db.close();
        };
      });
    });
  }
  function dbPut(val) {
    MEM_DECK_FULL = val;
    if (!DECK_DB_OK) return Promise.resolve();
    return dbOpen()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          if (!db.objectStoreNames.contains(DECK_DB_STORE)) {
            db.close();
            resolve();
            return;
          }
          var tx = db.transaction(DECK_DB_STORE, "readwrite");
          tx.objectStore(DECK_DB_STORE).put(val, DECK_DB_KEY);
          tx.oncomplete = function () {
            db.close();
            resolve();
          };
          tx.onerror = function () {
            reject(tx.error);
          };
        });
      })
      .catch(function () {
        DECK_DB_OK = false;
      });
  }
  function clearDeckSnapshot() {
    MEM_DECK_FULL = null;
    if (!DECK_DB_OK) return Promise.resolve();
    return dbOpen()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          if (!db.objectStoreNames.contains(DECK_DB_STORE)) {
            db.close();
            resolve();
            return;
          }
          var tx = db.transaction(DECK_DB_STORE, "readwrite");
          tx.objectStore(DECK_DB_STORE).delete(DECK_DB_KEY);
          tx.oncomplete = function () {
            db.close();
            resolve();
          };
          tx.onerror = function () {
            reject(tx.error);
          };
        });
      })
      .catch(function () {
        DECK_DB_OK = false;
      });
  }
  function loadSnapshot() {
    if (!DECK_DB_OK) return Promise.resolve(MEM_DECK_FULL);
    return dbGet().catch(function () {
      DECK_DB_OK = false;
      return MEM_DECK_FULL;
    });
  }

  function applySnapshot(snap) {
    if (!snap || snap.v !== 2 || !Array.isArray(snap.pages)) return;
    deck.pages = snap.pages;
    /* theme 不随快照恢复：每个 template-*.html 只链一份 theme-*.css */
  }

  /** 以当前 HTML 的 data-deck-theme 为准，避免 IndexedDB 里旧 theme 与 CSS 不匹配 */
  function syncDeckThemeFromHtml() {
    if (!deck) return;
    var bound = String(
      document.documentElement.getAttribute("data-deck-theme") || ""
    ).trim();
    if (!bound) return;
    deck.theme = bound;
    document.documentElement.dataset.deckTheme = bound;
  }

  function buildSnapshot() {
    return { v: 2, theme: deck.theme, pages: deepClone(deck.pages) };
  }

  function saveDeckPersistAll() {
    if (!deck) return Promise.resolve();
    collectDOMIntoDeck();
    return Promise.resolve(flushModalDetailIntoDeckWhenOpen()).then(function () {
      return dbPut(deepClone(buildSnapshot())).then(function () {
        deckEditBaselineJSON = JSON.stringify(deck);
      });
    });
  }

  /* ----- Portable JSON ----- */

  function normalizePortableDeckImport(raw) {
    if (!raw || typeof raw !== "object") return null;
    var migrated = migrateDeckIfNeeded(raw);
    if (!Array.isArray(migrated.pages)) return null;
    return migrated;
  }

  function exportDeckPortableDownload() {
    if (!deck) return;
    collectDOMIntoDeck();
    flushModalDetailIntoDeckWhenOpen();
    try {
      var blob = new Blob([JSON.stringify(deck, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "matrix-deck-data.json";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[matrix-core] 导出失败", err);
    }
  }

  function applyPortableDeckImported(next) {
    var wasEditing = deckEditActive;
    if (wasEditing) applyEditableToDOM(false);
    closeModal();
    exitComparePickQuiet();
    var importedTheme = next.theme != null ? String(next.theme).trim() : "";
    deck = next;
    syncDeckThemeFromHtml();
    if (importedTheme && deck.theme && importedTheme !== deck.theme) {
      console.info(
        "[matrix-core] 导入 JSON 主题为",
        importedTheme,
        "，已按当前页面保留",
        deck.theme
      );
    }
    slideIndexNav = 0;
    renderAllSlides();
    bindCompareFab();
    return saveDeckPersistAll().then(function () {
      if (wasEditing) enterDeckEditMode();
    });
  }

  function bindDeckPortableTransfer() {
    var exBtn = $("#deck-portable-export");
    var trig = $("#deck-portable-import-trigger");
    var inp = $("#deck-portable-import-file");
    if (!exBtn || !trig || !inp) return;
    if (document.documentElement.dataset.deckPortableBound === "1") return;
    document.documentElement.dataset.deckPortableBound = "1";
    exBtn.addEventListener("click", exportDeckPortableDownload);
    trig.addEventListener("click", function () {
      inp.click();
    });
    inp.addEventListener("change", function () {
      if (!inp.files || !inp.files[0]) return;
      var f = inp.files[0];
      var reader = new FileReader();
      reader.onload = function () {
        inp.value = "";
        try {
          var parsed = JSON.parse(String(reader.result || ""));
          var norm = normalizePortableDeckImport(parsed);
          if (!norm) {
            console.warn("[matrix-core] 导入失败：JSON 不含 pages 或 matrix");
            return;
          }
          applyPortableDeckImported(norm).catch(Boolean);
        } catch (err) {
          console.warn("[matrix-core] 导入失败：", err);
        }
      };
      reader.onerror = function () {
        inp.value = "";
        console.warn("[matrix-core] 读取文件失败");
      };
      reader.readAsText(f);
    });
  }

  function bindDeckTemplateSelect() {
    var sel = document.getElementById("deck-template-select");
    if (!sel || String(sel.tagName || "").toLowerCase() !== "select") return;
    if (document.documentElement.dataset.deckTemplateSelectBound === "1") return;
    document.documentElement.dataset.deckTemplateSelectBound = "1";
    var path = window.location.pathname || "";
    var base = path.split("/").pop() || "";
    var opts = sel.querySelectorAll("option");
    for (var i = 0; i < opts.length; i++) {
      if (String(opts[i].getAttribute("value") || "") === base) {
        sel.selectedIndex = i;
        break;
      }
    }
    sel.addEventListener("change", function () {
      var v = String(sel.value || "").trim();
      if (!v) return;
      try {
        var url = new URL(v, window.location.href);
        url.hash = window.location.hash;
        url.search = window.location.search;
        window.location.assign(url.toString());
      } catch (err) {
        window.location.href = v;
      }
    });
  }

  /* ============================================================
   * 15. Paste plain-only
   * ============================================================ */

  function bindDeckPastePlainOnly() {
    if (document.documentElement.dataset.deckPastePlainBound === "1") return;
    document.documentElement.dataset.deckPastePlainBound = "1";
    document.addEventListener(
      "paste",
      function (ev) {
        if (!deckEditActive) return;
        var targ = ev.target;
        if (!(targ instanceof Node)) return;
        var el = targ.nodeType === Node.TEXT_NODE ? targ.parentElement : targ;
        if (!(el instanceof Element)) return;
        var ce = el.closest(
          '[contenteditable="true"], [contenteditable="plaintext-only"]'
        );
        if (!ce || !ce.isContentEditable) return;
        var stage = $("#deck-stage");
        var modal = $("#cell-modal");
        var inScope =
          (stage && stage.contains(ce)) ||
          (modal && !modal.hasAttribute("hidden") && modal.contains(ce));
        if (!inScope) return;
        var plain = "";
        try {
          plain = ev.clipboardData.getData("text/plain");
        } catch (e1) {}
        if (!plain) {
          try {
            var html = ev.clipboardData.getData("text/html");
            if (html) {
              var sandbox = document.createElement("div");
              sandbox.innerHTML = html;
              plain = sandbox.innerText || sandbox.textContent || "";
            }
          } catch (e2) {}
        }
        var cd = ev.clipboardData;
        var hasBin = !!cd && !!(cd.files && cd.files.length);
        if (hasBin && String(plain || "").trim() === "") return;
        ev.preventDefault();
        try {
          if (document.execCommand && document.execCommand("insertText", false, plain || ""))
            return;
        } catch (eExec) {}
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var rg = sel.getRangeAt(0);
        rg.deleteContents();
        rg.insertNode(document.createTextNode(plain || ""));
        rg.collapse(false);
        sel.removeAllRanges();
        sel.addRange(rg);
      },
      true
    );
  }

  /* ============================================================
   * 16. 编辑栏
   * ============================================================ */

  function enterDeckEditMode() {
    if (!deck) return;
    deckEditActive = true;
    deckEditBaselineJSON = JSON.stringify(deck);
    var s = $("#deck-edit-save");
    var x = $("#deck-edit-exit");
    var e = $("#deck-edit-enter");
    if (s) s.removeAttribute("disabled");
    if (x) x.removeAttribute("disabled");
    if (e) e.setAttribute("disabled", "disabled");
    applyEditableToDOM(true);
  }

  function exitDeckEditDiscard() {
    closeModal();
    if (deckEditBaselineJSON) {
      try {
        deck = JSON.parse(deckEditBaselineJSON);
      } catch (e1) {}
    }
    deckEditBaselineJSON = "";
    deckEditActive = false;
    var s = $("#deck-edit-save");
    var x = $("#deck-edit-exit");
    var e = $("#deck-edit-enter");
    if (s) s.setAttribute("disabled", "disabled");
    if (x) x.setAttribute("disabled", "disabled");
    if (e) e.removeAttribute("disabled");
    document.body.classList.remove("deck--editing");
    renderAllSlides();
  }

  function bindDeckEditToolbar() {
    var ent = $("#deck-edit-enter");
    var sav = $("#deck-edit-save");
    var ext = $("#deck-edit-exit");
    if (!ent) return;
    if (document.documentElement.dataset.deckToolbarBound === "1") return;
    document.documentElement.dataset.deckToolbarBound = "1";
    if (sav) sav.setAttribute("disabled", "disabled");
    if (ext) ext.setAttribute("disabled", "disabled");
    ent.addEventListener("click", function () {
      enterDeckEditMode();
    });
    if (sav)
      sav.addEventListener("click", function () {
        saveDeckPersistAll().then(function () {}).catch(Boolean);
      });
    if (ext) ext.addEventListener("click", exitDeckEditDiscard);
  }

  /* ============================================================
   * 17. Title hydration
   * ============================================================ */

  function hydrateTitle() {
    if (!deck) return;
    var cover = firstPageOfType("cover");
    if (!cover || !cover.data || !cover.data.title) return;
    var strip = String(cover.data.title).replace(/<[^>]*>/g, "").trim();
    if (strip) document.title = strip.slice(0, 80) || document.title;
  }

  /* ============================================================
   * 18. init
   * ============================================================ */

  function init() {
    var raw = parseDeck();
    if (!raw) return;
    deck = migrateDeckIfNeeded(raw);
    bindKeyboard();
    bindHashNav();
    bindModal();
    bindMatrixAxisLabelInputDelegation();
    bindCompareReportModal();
    bindDeckEditToolbar();
    bindDeckPortableTransfer();
    bindDeckTemplateSelect();
    bindDeckPastePlainOnly();
    bindPageToolbar();
    bindMatrixAxisPickMemory();
    bindMindmapDelegations();
    loadSnapshot()
      .then(function (snap) {
        if (snap && snap.v === 2 && Array.isArray(snap.pages)) {
          applySnapshot(snap);
        }
      })
      .catch(Boolean)
      .finally(function () {
        finalizeDeckPages(deck);
        syncDeckThemeFromHtml();
        renderAllSlides();
        bindCompareFab();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /** 控制台：__matrixDeckReload() 重新解析 deck-data 并渲染 */
  window.__matrixEnterEdit = enterDeckEditMode;
  window.__matrixDeckReload = function () {
    var raw = parseDeck();
    if (!raw) return;
    deck = migrateDeckIfNeeded(raw);
    finalizeDeckPages(deck);
    syncDeckThemeFromHtml();
    renderAllSlides();
    bindCompareFab();
  };
  /** 清除本域 IndexedDB 文稿快照并恢复为 HTML 内 deck-data（含思维导图页） */
  window.__matrixResetLocalDeck = function () {
    return clearDeckSnapshot().then(function () {
      var raw = parseDeck();
      if (!raw) return;
      deck = migrateDeckIfNeeded(raw);
      finalizeDeckPages(deck);
      syncDeckThemeFromHtml();
      renderAllSlides();
      bindCompareFab();
      return saveDeckPersistAll();
    });
  };
})();
