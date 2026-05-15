/**
 * matrix-core.js — 竞品矩阵五页幻灯 + 矩阵交互
 *
 * 数据：<script id="deck-data" type="application/json"> 单文件 JSON（见 README）
 * slide：0 封面 · 1 概述 · 2 竞品对比矩阵（客观）· 3 竞品对比矩阵（主观）· 4 结束页（`ending`）
 * 矩阵 thead 行为产品型号列；tbody 左侧 th 行为对比参数行
 * cells 键："对比项行id::产品列id" → summary / detailHtml（单格弹层大卡）
 * 矩阵表（可选）：与 HTML 同目录或 data-* 指定的 matrix-objective.xlsx / matrix-subjective.xlsx
 * 「详情」工作表（可选）：自上而下与每个对比项两行一组——首行格内为说明文字，次行同一列为图片相对路径或 URL；总行数 ≥ 表头后行数 ×2 时启用此规则，否则按旧版「整格一格」解析。
 * fetch 同上路径；无法用 fetch 时将 xlsx **拖入页面**或点底栏载入（见 mountLocalMatrixSyncBar）。**无任何本地快照时**才会在启动时自动 fetch 上述 xlsx（避免每次刷新用表格文件覆盖你已在页里改好的矩阵与 detailHtml 图片）；需要旧行为时在根元素加 `data-matrix-always-hydrate-xlsx="true"`（先 xlsx 再叠加快照）。
 * 文稿编辑：**IndexedDB `deckPatch` 快照**与本页遗留图片记录（仅存旧数据）；详情内图片现为 data URL 写入 `detailHtml`。清站点存储会删掉。
 * 跨设备：`deck-portable-export`/`import` 整份 deck JSON；xlsx：`MATRIX_FEATURE_XLSX_ENABLED`。
 */
(function () {
  "use strict";

  var deck = null;
  var slideIndexNav = 0;
  var comparePick = { active: false, rows: {}, cols: {} };
  /** false：关闭启动 xlsx fetch、底部载入条与整页拖入；改为 true 可恢复 */
  var MATRIX_FEATURE_XLSX_ENABLED = false;

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

  function deepCloneMatrix(m) {
    return JSON.parse(JSON.stringify(m));
  }

  /** 主观矩阵：与 objective 独立；异步加载 xlsx 后始终为矩阵深拷贝 */
  function subjectiveMatrixResolved() {
    if (!deck) return null;
    return deck.matrixSubjective ? deck.matrixSubjective : deck.matrix;
  }

  function activeMatrixForComparePick() {
    if (!deck || !deck.matrix) return null;
    return slideIndexNav === 3 ? subjectiveMatrixResolved() : deck.matrix;
  }

  function compareSlideRoot() {
    return $('[data-slide-index="' + String(slideIndexNav) + '"]');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeHtmlAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function plainDetailToHtml(s) {
    var t = String(s || "").trim();
    if (!t) return "<p>—</p>";
    if (/^\s*</.test(t)) return t;
    var paras = escapeHtml(String(s)).split(/\r?\n\s*\r?\n/).filter(Boolean);
    if (!paras.length) return "<p>—</p>";
    var parts = paras.map(function (p) {
      return "<p>" + p.replace(/\r?\n/g, "<br>") + "</p>";
    });
    return parts.join("");
  }

  /** 将 Excel / Windows 习惯的路径转为浏览器可用的 img src */
  function normalizeImageSrc(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";

    var a = s.charAt(0);
    var b = s.charAt(s.length - 1);
    if (
      (a === '"' && b === '"') ||
      (a === "'" && b === "'") ||
      (a === "\u201c" && b === "\u201d")
    ) {
      s = s.slice(1, -1).trim();
      if (!s) return "";
    }

    s = s.replace(/\\/g, "/");

    if (/^(https?:|data:|blob:)/i.test(s)) {
      try {
        return encodeURI(s);
      } catch (err) {
        return s;
      }
    }

    if (/^file:\/\//i.test(s)) {
      try {
        return encodeURI(s);
      } catch (err2) {
        return s;
      }
    }

    /* Windows 盘符绝对路径：C:/... 或 C:path → file:///… */
    if (/^[a-zA-Z]:/i.test(s)) {
      if (s.charAt(2) !== "/") s = s.slice(0, 2) + "/" + s.slice(2).replace(/^\/*/g, "");
      return "file:///" + encodeURI(s).replace(/#/g, "%23");
    }

    /* UNC //machine/share；//domain.com/… 视作协议相对网址 */
    if (/^\/\/[^/]+/.test(s)) {
      var host = /^\/\/([^/]+)/.exec(s)[1];
      var isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
      var hasDot = host.indexOf(".") >= 0;
      if (hasDot && !isIp) {
        try {
          return encodeURI(s).replace(/#/g, "%23");
        } catch (err4) {
          return s;
        }
      }
      return "file:" + encodeURI(s).replace(/#/g, "%23");
    }

    try {
      return encodeURI(s).replace(/#/g, "%23");
    } catch (err3) {
      return s;
    }
  }

  /** 「详情」表：并排两行（上文 + 下图路径）；路径写相对页面或可被浏览器解析为资源的地址 */
  function composeDetailHtmlFromTextAndImgPath(textRaw, imgPathRaw) {
    var txt = trimCell(textRaw);
    var path = normalizeImageSrc(imgPathRaw);
    if (!txt && !path) return "<p>—</p>";
    var chunks = "";
    if (txt) chunks += /^\s*</.test(txt) ? txt : plainDetailToHtml(txt);
    if (path)
      chunks +=
        '<figure class="detail-figure"><img src="' +
        escapeHtmlAttr(path) +
        '" alt=""></figure>';
    return chunks;
  }

  function parseBool(v) {
    if (typeof v === "boolean") return v;
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  }

  function normSheetRow(o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      var nk = String(k || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      out[nk] = o[k];
    });
    return out;
  }

  function sheetByName(book, want) {
    var w = String(want || "").toLowerCase();
    for (var i = 0; i < book.SheetNames.length; i++) {
      var nm = book.SheetNames[i];
      if (String(nm).toLowerCase() === w) return book.Sheets[nm];
    }
    return null;
  }

  function sheetToAoA(sheet) {
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  }

  function trimCell(x) {
    return String(x == null ? "" : x).trim();
  }

  function looksLikeIdToken(s) {
    s = trimCell(s);
    return s.length > 0 && s.length <= 64 && /^[a-zA-Z][a-zA-Z0-9_\-]*$/.test(s);
  }

  /** 左上角 + 表格列与浏览器一致优先读此表 */
  function findGridMatrixSheet(book) {
    var names = [
      "网页矩阵",
      "竞品矩阵",
      "矩阵预览",
      "矩阵",
      "Matrix",
    ];
    for (var ni = 0; ni < names.length; ni++) {
      var sh = sheetByName(book, names[ni]);
      if (sh) return sh;
    }
    return null;
  }

  function parseWebStyleMatrixBook(book) {
    if (!book || typeof XLSX === "undefined") return null;
    var gs = findGridMatrixSheet(book);
    if (!gs) return null;
    var aoa = sheetToAoA(gs);
    if (!aoa.length || !aoa[0] || !trimCell(aoa[0][0])) return null;
    var header = aoa[0] || [];
    var prodLabels = [];
    for (var hj = 1; hj < 200; hj++) {
      var lb = hj < header.length ? trimCell(header[hj]) : "";
      if (!lb) break;
      prodLabels.push(lb);
    }
    var nProd = prodLabels.length;
    if (!nProd) return null;

    var hasIdRow = false;
    if (aoa.length > 1) {
      var r1 = aoa[1] || [];
      if (!trimCell(r1[0])) {
        var allOk = true;
        for (var u = 1; u <= nProd; u++) {
          var vx = u < r1.length ? trimCell(r1[u]) : "";
          if (!looksLikeIdToken(vx)) allOk = false;
        }
        hasIdRow = allOk;
      }
    }

    var dataStart = hasIdRow ? 2 : 1;
    var detWs = sheetByName(book, "详情");
    var detAoa = detWs ? sheetToAoA(detWs) : null;

    var cmpCountForDet = 0;
    for (var rDc = dataStart; rDc < aoa.length; rDc++) {
      var lx = trimCell((aoa[rDc] || [])[0]);
      if (!lx || lx.indexOf("//") === 0) continue;
      cmpCountForDet += 1;
    }

    var useDetailPairs =
      !!(
        detAoa &&
        cmpCountForDet > 0 &&
        detAoa.length >= dataStart + cmpCountForDet * 2
      );

    var columns = [];
    for (var jc = 0; jc < nProd; jc++) {
      var plab = prodLabels[jc];
      var colIdxExcel = jc + 1;
      var cid = "";
      if (hasIdRow && aoa[1] && colIdxExcel < aoa[1].length) {
        cid = trimCell(aoa[1][colIdxExcel]);
      }
      if (!cid || !looksLikeIdToken(cid)) cid = "p" + String(jc + 1);
      columns.push({ id: cid, label: plab || cid, hidden: false });
    }

    var rows = [];
    var cells = {};
    var rowOrd = 0;

    for (var r = dataStart; r < aoa.length; r++) {
      var rowLine = aoa[r] || [];
      var rl = trimCell(rowLine[0]);
      if (!rl || rl.indexOf("//") === 0) continue;

      rowOrd += 1;
      var rowId = "row_" + ("0000" + String(rowOrd)).slice(-4);
      rows.push({ id: rowId, label: rl, hidden: false });

      var pairIdx = rowOrd - 1;

      for (var jc2 = 0; jc2 < nProd; jc2++) {
        var coli = jc2 + 1;
        var colObj = columns[jc2];
        var summary = coli < rowLine.length ? trimCell(rowLine[coli]) : "";
        var detailHtml = "<p>—</p>";

        if (useDetailPairs) {
          var tR = dataStart + pairIdx * 2;
          var iR = tR + 1;
          var textRaw =
            detAoa[tR] && coli < detAoa[tR].length
              ? trimCell(detAoa[tR][coli])
              : "";
          var imgRaw =
            detAoa[iR] && coli < detAoa[iR].length
              ? trimCell(detAoa[iR][coli])
              : "";
          detailHtml = composeDetailHtmlFromTextAndImgPath(textRaw, imgRaw);
        } else {
          var detRaw =
            detAoa && detAoa[r] && coli < detAoa[r].length
              ? trimCell(detAoa[r][coli])
              : "";
          detailHtml = plainDetailToHtml(detRaw);
        }

        cells[cellKey(rowId, colObj.id)] = {
          summary: summary,
          detailHtml: detailHtml,
        };
      }
    }

    if (!rows.length) return null;

    var cornerLabel = trimCell(header[0]) || "对比项 \\ 型号";
    return { cornerLabel: cornerLabel, rows: rows, columns: columns, cells: cells };
  }

  /** 优先级：新版「网页矩阵」布局 → 旧版 Rows/Columns/Cells */
  function parseUnifiedMatrixWorkbook(book) {
    try {
      var u = parseWebStyleMatrixBook(book);
      if (u) return u;
    } catch (err) {
      console.warn("[matrix-core] 解析网页矩阵失败：", err);
    }
    return parseLegacyMatrixSheetsFromBook(book);
  }

  function parseLegacyMatrixSheetsFromBook(book) {
    if (!book || typeof XLSX === "undefined") return null;
    var mrows = sheetByName(book, "Rows");
    var mcols = sheetByName(book, "Columns");
    var mcells = sheetByName(book, "Cells");
    if (!mrows || !mcols || !mcells) return null;
    var jr = XLSX.utils.sheet_to_json(mrows, { defval: "", raw: false }).map(normSheetRow);
    var jc = XLSX.utils.sheet_to_json(mcols, { defval: "", raw: false }).map(normSheetRow);
    var jcells = XLSX.utils.sheet_to_json(mcells, { defval: "", raw: false }).map(normSheetRow);
    var meta = {};
    var mmeta = sheetByName(book, "Meta");
    if (mmeta) {
      XLSX.utils.sheet_to_json(mmeta, { defval: "", raw: false })
        .map(normSheetRow)
        .forEach(function (row) {
          var k =
            row.key || row.meta_key || row.name || "";
          var v =
            row.value ||
            row.val ||
            "";
          if (String(k).trim()) meta[String(k).trim().toLowerCase()] = v;
        });
    }

    var rows = [];
    for (var ri = 0; ri < jr.length; ri++) {
      var r = jr[ri];
      var id = String(r.row_id || r.rowid || "").trim();
      if (!id || id.toLowerCase() === "row_id") continue;
      rows.push({
        id: id,
        label: String(r.label == null ? "" : r.label).trim() || id,
        hidden: parseBool(r.hidden),
      });
    }
    var columns = [];
    for (var ci = 0; ci < jc.length; ci++) {
      var c = jc[ci];
      var cid = String(c.col_id || c.colid || c.column_id || "").trim();
      if (!cid || cid.toLowerCase() === "col_id") continue;
      columns.push({
        id: cid,
        label: String(c.label == null ? "" : c.label).trim() || cid,
        hidden: parseBool(c.hidden),
      });
    }
    var cornerLabel =
      meta.corner_label || meta.cornerlabel || meta["corner_label"];
    cornerLabel =
      cornerLabel != null ? String(cornerLabel) : "对比项 \\ 型号";

    var cells = {};
    for (var x = 0; x < jcells.length; x++) {
      var row = jcells[x];
      var rid = String(row.row_id || "").trim();
      var colid = String(
        row.col_id || row.column_id || row.colid || ""
      ).trim();
      if (
        !rid ||
        rid.toLowerCase() === "row_id" ||
        !colid ||
        colid.toLowerCase() === "col_id"
      )
        continue;
      var summary = String(row.summary == null ? "" : row.summary);
      var det =
        row.detail_html ||
        row.detailhtml ||
        row.detail ||
        row.body ||
        "";
      det =
        typeof det === "string"
          ? det
          : det != null
            ? String(det)
            : "";
      cells[cellKey(rid, colid)] = {
        summary: summary.trim(),
        detailHtml: plainDetailToHtml(det),
      };
    }
    if (!rows.length || !columns.length) return null;
    return { cornerLabel: cornerLabel, rows: rows, columns: columns, cells: cells };
  }

  function applyParsedMatrixOnto(dest, parsed) {
    if (!dest || !parsed) return;
    dest.cornerLabel = parsed.cornerLabel;
    dest.rows = parsed.rows;
    dest.columns = parsed.columns;
    dest.cells = parsed.cells;
  }

  function datasetXlsxUrl(dataKeyCamel, defaultPath) {
    var ds = document.documentElement.dataset[dataKeyCamel];
    if (ds === "") return null;
    if (ds == null || String(ds).trim() === "") return defaultPath || null;
    return String(ds).trim();
  }

  function fetchSheetArrayBuffer(url) {
    if (!url || typeof fetch !== "function") return Promise.reject();
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.arrayBuffer();
    });
  }

  function roleFromFilename(name) {
    var s = String(name || "").toLowerCase();
    if (
      s.indexOf("matrix-subjective") >= 0 ||
      s.indexOf("subjective") >= 0 ||
      s.indexOf("主观") >= 0
    )
      return "sub";
    if (
      s.indexOf("matrix-objective") >= 0 ||
      s.indexOf("objective") >= 0 ||
      s.indexOf("客观") >= 0
    )
      return "obj";
    return "unknown";
  }

  function readFileAsWorkbook(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.onload = function () {
        try {
          resolve(XLSX.read(reader.result, { type: "array" }));
        } catch (e) {
          reject(e);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 任选/拖入本地的 .xlsx，覆盖当前 deck.matrix / deck.matrixSubjective */
  function ingestLocalMatrixXlsxFiles(fileList) {
    if (!MATRIX_FEATURE_XLSX_ENABLED) return Promise.resolve();
    if (!deck || !deck.matrix || typeof XLSX === "undefined")
      return Promise.resolve();

    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return f && /\.xlsx$/i.test(f.name || "");
    });
    if (!files.length) return Promise.resolve();

    return Promise.all(
      files.map(function (f) {
        return readFileAsWorkbook(f).then(function (wb) {
          return { name: String(f.name || ""), wb: wb };
        });
      })
    )
      .then(function (entries) {
        var objectiveBook = null;
        var subjectiveBook = null;
        var unknown = [];

        entries.forEach(function (e) {
          var rr = roleFromFilename(e.name);
          if (rr === "obj") objectiveBook = e.wb;
          else if (rr === "sub") subjectiveBook = e.wb;
          else unknown.push(e.wb);
        });

        if (!objectiveBook && unknown.length) objectiveBook = unknown.shift();
        if (!subjectiveBook && unknown.length) subjectiveBook = unknown.shift();

        if (objectiveBook) {
          var po = parseUnifiedMatrixWorkbook(objectiveBook);
          if (po) applyParsedMatrixOnto(deck.matrix, po);
        }
        deck.matrixSubjective = deepCloneMatrix(deck.matrix);

        if (subjectiveBook) {
          var ps = parseUnifiedMatrixWorkbook(subjectiveBook);
          if (ps) applyParsedMatrixOnto(deck.matrixSubjective, ps);
        }

        renderMatrix();
        hydrateTitle();
      })
      .catch(function (err) {
        console.warn("[matrix-core] 本地矩阵表读取失败", err);
      });
  }

  function mountLocalMatrixSyncBar() {
    if (!MATRIX_FEATURE_XLSX_ENABLED) return;
    if (typeof XLSX === "undefined") return;
    if (document.documentElement.dataset.matrixSyncBarMounted === "1") return;
    document.documentElement.dataset.matrixSyncBarMounted = "1";

    var bar = document.createElement("div");
    bar.className = "matrix-sync-bar";
    bar.innerHTML =
      '<p class="matrix-sync-bar__line"><strong>载入表格</strong>：把两份 xlsx 拖进<strong>浏览器窗口</strong>任意位置即可同步；或点此按钮选取文件（文件名中含 <span class=\"matrix-sync-bar__mono\">matrix-objective</span> / <span class=\"matrix-sync-bar__mono\">matrix-subjective</span> 最好）。</p>' +
      '<div class="matrix-sync-bar__actions">' +
      '<button type="button" class="btn btn--ghost matrix-sync-bar__btn">载入 xlsx</button>' +
      '<input id="matrix-sync-file-input" type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" /></div>';

    document.body.appendChild(bar);

    var inp = $("#matrix-sync-file-input", bar);
    var btn = $(".matrix-sync-bar__btn", bar);

    if (inp) {
      inp.setAttribute(
        "style",
        "position:absolute;width:1px;height:1px;padding:0;border:0;overflow:hidden;clip:rect(0,0,0,0)"
      );

      inp.addEventListener("change", function () {
        if (!inp.files || !inp.files.length) return;
        ingestLocalMatrixXlsxFiles(inp.files).finally(function () {
          inp.value = "";
        });
      });
    }

    if (btn && inp) {
      btn.addEventListener("click", function () {
        inp.click();
      });
    }

    function block(ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    ["dragenter", "dragover"].forEach(function (evNm) {
      document.addEventListener(evNm, block, false);
    });
    document.addEventListener(
      "drop",
      function (ev) {
        block(ev);
        var dt = ev.dataTransfer;
        if (!dt || !dt.files || !dt.files.length) return;
        ingestLocalMatrixXlsxFiles(dt.files);
      },
      false
    );
  }

  /**
   * 启动数据：先读本地快照时，默认不再用 fetch 的 xlsx 整表覆盖 deck（否则你的格子与 detailHtml 大图会在每次刷新被冲掉）。
   * 需要旧行为时在 <html data-matrix-always-hydrate-xlsx="true"> 上开启：先 xlsx 再叠加快照。
   */
  function bootLoadDeckState() {
    var forceXlsxHydrateFirst =
      document.documentElement.dataset.matrixAlwaysHydrateXlsx === "true";
    if (forceXlsxHydrateFirst) {
      return hydrateMatricesFromXlsx()
        .then(function () {
          return loadDeckPatchSnapshot();
        })
        .then(function (patch) {
          if (patch && patch.v === 1) applyDeckPatchSnapshot(patch);
        })
        .finally(function () {
          mountLocalMatrixSyncBar();
        });
    }
    return loadDeckPatchSnapshot()
      .then(function (patch) {
        if (patch && patch.v === 1) {
          applyDeckPatchSnapshot(patch);
          return Promise.resolve();
        }
        return hydrateMatricesFromXlsx();
      })
      .finally(function () {
        mountLocalMatrixSyncBar();
      });
  }

  function hydrateMatricesFromXlsx() {
    if (!MATRIX_FEATURE_XLSX_ENABLED) return Promise.resolve();
    if (!deck || !deck.matrix) return Promise.resolve();

    function syncSubjectiveCloneFromObjective() {
      deck.matrixSubjective = deepCloneMatrix(deck.matrix);
    }

    var objectiveUrl =
      datasetXlsxUrl("matrixObjectiveXlsx", "data/matrix-objective.xlsx") ||
      null;
    var subjectiveUrl =
      datasetXlsxUrl("matrixSubjectiveXlsx", "data/matrix-subjective.xlsx") ||
      null;

    function tryOne(url, applyFn) {
      if (!url || typeof XLSX === "undefined") return Promise.resolve();
      return fetchSheetArrayBuffer(url)
        .then(function (buf) {
          var book = XLSX.read(buf, { type: "array" });
          var parsed = parseUnifiedMatrixWorkbook(book);
          if (parsed) applyFn(parsed);
          else
            console.warn(
              "[matrix-core] xlsx 无法解析（需「网页矩阵」或 Rows/Columns/Cells）:",
              url
            );
        })
        .catch(function (e) {
          console.warn("[matrix-core] 跳过 xlsx（可能未开本地服务或文件不存在）", url, e && e.message);
        });
    }

    return tryOne(objectiveUrl, function (p) {
      applyParsedMatrixOnto(deck.matrix, p);
    })
      .then(function () {
        syncSubjectiveCloneFromObjective();
        return tryOne(subjectiveUrl, function (p) {
          applyParsedMatrixOnto(deck.matrixSubjective, p);
        });
      })
      .finally(function () {
        mountLocalMatrixSyncBar();
      });
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
    var prevSlide = slideIndexNav;
    if (idx !== 2 && idx !== 3) exitComparePickQuiet();
    else if (
      prevSlide !== idx &&
      (prevSlide === 2 || prevSlide === 3) &&
      (idx === 2 || idx === 3)
    ) {
      exitComparePickQuiet();
    }

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

  /** 纯前端持久化：IndexedDB（不可用时回退内存，仅当前标签页） */
  var UPLOAD_IDB_NAME = "matrix-cell-detail-uploads";
  var UPLOAD_IDB_STORE = "byKey";
  var DECK_PATCH_STORE = "deckPatch";
  var UPLOAD_IDB_VER = 2;
  var MEM_UPLOAD_FALLBACK = {};
  var uploadStoreIdbOk = true;

  function uploadPersistKeyForCell(isSubjective, rowId, colId) {
    return (
      "v1|" +
      (isSubjective ? "sub" : "obj") +
      "|" +
      String(rowId) +
      "|" +
      String(colId)
    );
  }

  function uploadIdbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("no indexedDB"));
        return;
      }
      var req = indexedDB.open(UPLOAD_IDB_NAME, UPLOAD_IDB_VER);
      req.onerror = function () {
        reject(req.error || new Error("idb open"));
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(UPLOAD_IDB_STORE))
          db.createObjectStore(UPLOAD_IDB_STORE);
        if (!db.objectStoreNames.contains(DECK_PATCH_STORE))
          db.createObjectStore(DECK_PATCH_STORE);
      };
    });
  }

  function uploadIdbGet(key) {
    return uploadIdbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(UPLOAD_IDB_STORE, "readonly");
        var rq = tx.objectStore(UPLOAD_IDB_STORE).get(key);
        rq.onsuccess = function () {
          resolve(rq.result);
        };
        rq.onerror = function () {
          reject(rq.error || new Error("idb get"));
        };
        tx.oncomplete = function () {
          db.close();
        };
      });
    });
  }

  function uploadIdbPut(key, val) {
    return uploadIdbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(UPLOAD_IDB_STORE, "readwrite");
        tx.objectStore(UPLOAD_IDB_STORE).put(val, key);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error || new Error("idb put"));
        };
      });
    });
  }

  function getUploadRecord(key) {
    if (!key) return Promise.resolve(null);
    function mem() {
      return MEM_UPLOAD_FALLBACK[key] || null;
    }
    if (!uploadStoreIdbOk) return Promise.resolve(mem());
    return uploadIdbGet(key)
      .then(function (rec) {
        if (rec != null) return rec;
        return mem();
      })
      .catch(function () {
        uploadStoreIdbOk = false;
        return mem();
      });
  }

  function setUploadRecord(key, rec) {
    if (!key) return Promise.resolve();
    MEM_UPLOAD_FALLBACK[key] = rec;
    if (!uploadStoreIdbOk) return Promise.resolve();
    return uploadIdbPut(key, rec).catch(function () {
      uploadStoreIdbOk = false;
    });
  }

  /* ----- 整场演示文稿快照（封面 / 概述 / 结束 / 双矩阵文案） ----- */
  var MEM_DECK_PATCH_FULL = null;
  var deckPatchDbOk = true;
  var DECK_PATCH_RECORD_KEY = "snapshot";

  function deckPatchDbGet() {
    if (!deckPatchDbOk) return Promise.resolve(MEM_DECK_PATCH_FULL);
    return uploadIdbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        if (!db.objectStoreNames.contains(DECK_PATCH_STORE)) {
          resolve(null);
          db.close();
          return;
        }
        var tx = db.transaction(DECK_PATCH_STORE, "readonly");
        var rq = tx.objectStore(DECK_PATCH_STORE).get(DECK_PATCH_RECORD_KEY);
        rq.onsuccess = function () {
          resolve(rq.result);
        };
        rq.onerror = function () {
          reject(rq.error || new Error("deck patch get"));
        };
        tx.oncomplete = function () {
          db.close();
        };
      });
    });
  }

  function deckPatchDbPut(val) {
    MEM_DECK_PATCH_FULL = val;
    if (!deckPatchDbOk) return Promise.resolve();
    return uploadIdbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        if (!db.objectStoreNames.contains(DECK_PATCH_STORE)) {
          db.close();
          resolve();
          return;
        }
        var tx = db.transaction(DECK_PATCH_STORE, "readwrite");
        tx.objectStore(DECK_PATCH_STORE).put(val, DECK_PATCH_RECORD_KEY);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error || new Error("deck patch put"));
        };
      });
    }).catch(function () {
      deckPatchDbOk = false;
    });
  }

  function loadDeckPatchSnapshot() {
    function mem() {
      return MEM_DECK_PATCH_FULL || null;
    }
    if (!deckPatchDbOk) return Promise.resolve(mem());
    return deckPatchDbGet()
      .then(function (rec) {
        if (rec != null) return rec;
        return mem();
      })
      .catch(function () {
        deckPatchDbOk = false;
        return mem();
      });
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
        resolve({
          mime: m[1] || "image/png",
          dataB64: m[2],
        });
      };
      r.onerror = function () {
        reject(r.error || new Error("FileReader"));
      };
      r.readAsDataURL(file);
    });
  }

  /** 嵌入 data URL（与 JSON/XLS 内嵌图同属 detailHtml，保存时一整块写入单元格） */
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

  function restorePersistedUploadsToBody(persistKey) {
    if (!persistKey) return;
    var body = $("#modal-body");
    if (!body) return;
    getUploadRecord(persistKey)
      .then(function (rec) {
        var modal = $("#cell-modal");
        if (!modal || modal.dataset.uploadPersistKey !== persistKey) return;
        if (!rec || !rec.items || !rec.items.length) return;
        rec.items.forEach(function (it) {
          appendDataItemFigure(body, it);
        });
        refreshFigureRemoveButtonsInModalBody();
      })
      .catch(function (err) {
        console.warn("[matrix-core] 读取已存图片失败", err);
      });
  }

  /** 矩阵整表重建前：把表格域已从 DOM 改动的文案写回 deck（避免 renderMatrix 清空节点后丢失） */
  function syncDeckFromEditableDomBeforeMatrixRebuild() {
    if (deckEditActive && deck) collectDOMIntoDeck();
  }

  /** 增减行、列并完成 renderMatrix 后：新建的 th/td 没有 contenteditable，需按当前编辑态补上 */
  function afterMatrixStructureRender() {
    renderMatrix();
    applyFilters();
    if (!deckEditActive) return;
    applyMatrixTableContentEditable(bestPlainCe());
    refreshFigureRemoveButtonsInModalBody();
  }

  /** 矩阵表头与单元格的 contenteditable（供进入编辑态与矩阵刷新后复用） */
  function applyMatrixTableContentEditable(plc) {
    $all("thead .matrix-corner").forEach(function (th) {
      th.contentEditable = plc;
    });
    $all("thead th:not(.matrix-corner)").forEach(function (thx) {
      thx.contentEditable = plc;
    });
    $all(".matrix-row-head").forEach(function (rh) {
      rh.contentEditable = plc;
    });
    $all(".matrix-cell").forEach(function (tdx) {
      tdx.contentEditable = plc;
    });
  }

  /** 主观矩阵若与客观共用引用，先做深拷贝后再改行/列结构 */
  function matrixForStructureEdit(isSubjective) {
    if (!deck || !deck.matrix) return null;
    if (!isSubjective) return deck.matrix;
    if (!deck.matrixSubjective) {
      deck.matrixSubjective = deepCloneMatrix(deck.matrix);
    }
    return deck.matrixSubjective;
  }

  function mutateMatrixEnsureCells(m) {
    m.cells = m.cells || {};
  }

  function addMatrixRow(isSubjective) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = matrixForStructureEdit(isSubjective);
    if (!m || !m.rows || !m.columns) return;
    if (m.rows.length >= 80 || m.columns.length >= 40) return;
    mutateMatrixEnsureCells(m);
    var newId = "row_e_" + String(Date.now());
    m.rows.push({ id: newId, label: "新参数", hidden: false });
    m.columns.forEach(function (col) {
      m.cells[cellKey(newId, col.id)] = {
        summary: "",
        detailHtml: "<p>—</p>",
      };
    });
    afterMatrixStructureRender();
  }

  function removeLastMatrixRow(isSubjective) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = matrixForStructureEdit(isSubjective);
    if (!m || !m.rows || !m.columns || m.rows.length <= 1) return;
    mutateMatrixEnsureCells(m);
    var row = m.rows.pop();
    if (!row) return;
    m.columns.forEach(function (col) {
      delete m.cells[cellKey(row.id, col.id)];
    });
    afterMatrixStructureRender();
  }

  function addMatrixColumn(isSubjective) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = matrixForStructureEdit(isSubjective);
    if (!m || !m.rows || !m.columns) return;
    if (m.rows.length >= 80 || m.columns.length >= 40) return;
    mutateMatrixEnsureCells(m);
    var newId = "col_e_" + String(Date.now());
    m.columns.push({ id: newId, label: "新型号", hidden: false });
    m.rows.forEach(function (row) {
      m.cells[cellKey(row.id, newId)] = {
        summary: "",
        detailHtml: "<p>—</p>",
      };
    });
    afterMatrixStructureRender();
  }

  function removeLastMatrixColumn(isSubjective) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = matrixForStructureEdit(isSubjective);
    if (!m || !m.rows || !m.columns || m.columns.length <= 1) return;
    mutateMatrixEnsureCells(m);
    var col = m.columns.pop();
    if (!col) return;
    m.rows.forEach(function (row) {
      delete m.cells[cellKey(row.id, col.id)];
    });
    afterMatrixStructureRender();
  }

  /** 编辑态下列/行换位：点小工具会先 blur 表头，无法用 activeElement，故 focusin 记录最近轴格 */
  var lastMatrixAxisPick = {
    obj: { colId: null, rowId: null },
    sub: { colId: null, rowId: null },
  };

  function bindMatrixAxisPickMemory() {
    if (document.documentElement.dataset.matrixAxisPickBound === "1") return;
    document.documentElement.dataset.matrixAxisPickBound = "1";
    document.addEventListener(
      "focusin",
      function (ev) {
        if (!deckEditActive) return;
        var t = ev.target;
        if (!(t instanceof Element)) return;
        var tblSub = t.closest("#comparison-table-sub");
        var tblObj = t.closest("#comparison-table");
        var slot = tblSub
          ? lastMatrixAxisPick.sub
          : tblObj
            ? lastMatrixAxisPick.obj
            : null;
        if (!slot) return;
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

  function matrixScopeTableSelector(isSubjective) {
    return isSubjective ? "#comparison-table-sub" : "#comparison-table";
  }

  function getFocusedMatrixColumnIdForScope(isSubjective) {
    var ae = document.activeElement;
    if (!ae || !(ae instanceof Element)) return null;
    var tbl = $(matrixScopeTableSelector(isSubjective));
    if (!tbl || !tbl.contains(ae)) return null;
    var th = ae.closest("thead th[data-col-id]");
    if (!th || !tbl.contains(th)) return null;
    var cid = th.dataset.colId;
    return cid != null && String(cid) !== "" ? String(cid) : null;
  }

  function getFocusedMatrixRowIdForScope(isSubjective) {
    var ae = document.activeElement;
    if (!ae || !(ae instanceof Element)) return null;
    var tbl = $(matrixScopeTableSelector(isSubjective));
    if (!tbl || !tbl.contains(ae)) return null;
    var rh = ae.closest("tbody th.matrix-row-head");
    if (!rh || !tbl.contains(rh)) return null;
    var rid = rh.dataset.rowId;
    return rid != null && String(rid) !== "" ? String(rid) : null;
  }

  function getColumnMoveTargetColId(isSub) {
    var slot = isSub ? lastMatrixAxisPick.sub : lastMatrixAxisPick.obj;
    if (slot && String(slot.colId || "").trim() !== "")
      return String(slot.colId);
    return getFocusedMatrixColumnIdForScope(isSub);
  }

  function getRowMoveTargetRowId(isSub) {
    var slot = isSub ? lastMatrixAxisPick.sub : lastMatrixAxisPick.obj;
    if (slot && String(slot.rowId || "").trim() !== "")
      return String(slot.rowId);
    return getFocusedMatrixRowIdForScope(isSub);
  }

  function swapMatrixColumnWithNeighbor(isSubjective, colId, delta) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = matrixForStructureEdit(isSubjective);
    if (!m || !m.columns || !m.columns.length || !colId) return false;
    var j = -1;
    for (var ix = 0; ix < m.columns.length; ix++) {
      if (String(m.columns[ix].id) === String(colId)) {
        j = ix;
        break;
      }
    }
    if (j < 0) return false;
    var k = j + delta;
    if (k < 0 || k >= m.columns.length) return false;
    var cols = m.columns;
    var tmp = cols[j];
    cols[j] = cols[k];
    cols[k] = tmp;
    var tableSel = matrixScopeTableSelector(isSubjective);
    afterMatrixStructureRender();
    requestAnimationFrame(function () {
      var tab = $(tableSel);
      if (!tab) return;
      var thPick = null;
      $all("thead th[data-col-id]", tab).forEach(function (h) {
        if (String(h.dataset.colId) === String(colId)) thPick = h;
      });
      if (thPick) thPick.focus();
    });
    return true;
  }

  function swapMatrixRowWithNeighbor(isSubjective, rowId, delta) {
    syncDeckFromEditableDomBeforeMatrixRebuild();
    var m = matrixForStructureEdit(isSubjective);
    if (!m || !m.rows || !m.rows.length || !rowId) return false;
    var j = -1;
    for (var ix = 0; ix < m.rows.length; ix++) {
      if (String(m.rows[ix].id) === String(rowId)) {
        j = ix;
        break;
      }
    }
    if (j < 0) return false;
    var k = j + delta;
    if (k < 0 || k >= m.rows.length) return false;
    var rows = m.rows;
    var tmp = rows[j];
    rows[j] = rows[k];
    rows[k] = tmp;
    var tableSel = matrixScopeTableSelector(isSubjective);
    afterMatrixStructureRender();
    requestAnimationFrame(function () {
      var tab = $(tableSel);
      if (!tab) return;
      var thPick = null;
      $all("tbody th.matrix-row-head", tab).forEach(function (h) {
        if (String(h.dataset.rowId) === String(rowId)) thPick = h;
      });
      if (thPick) thPick.focus();
    });
    return true;
  }

  function bindMatrixStructureToolbar() {
    if (document.documentElement.dataset.matrixStructureToolbarBound === "1")
      return;
    document.documentElement.dataset.matrixStructureToolbarBound = "1";
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!(t instanceof Element)) return;
      var btn = t.closest("[data-matrix-action]");
      if (!btn) return;
      if (!deckEditActive) return;
      var structure = btn.getAttribute("data-matrix-structure");
      var action = btn.getAttribute("data-matrix-action");
      if (!action) return;
      var isSub = structure === "sub";
      if (action === "add-row") addMatrixRow(isSub);
      else if (action === "remove-row") removeLastMatrixRow(isSub);
      else if (action === "add-col") addMatrixColumn(isSub);
      else if (action === "remove-col") removeLastMatrixColumn(isSub);
      else if (action === "col-move-left") {
        var cidL = getColumnMoveTargetColId(isSub);
        if (cidL) swapMatrixColumnWithNeighbor(isSub, cidL, -1);
      } else if (action === "col-move-right") {
        var cidR = getColumnMoveTargetColId(isSub);
        if (cidR) swapMatrixColumnWithNeighbor(isSub, cidR, 1);
      } else if (action === "row-move-up") {
        var ridU = getRowMoveTargetRowId(isSub);
        if (ridU) swapMatrixRowWithNeighbor(isSub, ridU, -1);
      } else if (action === "row-move-down") {
        var ridD = getRowMoveTargetRowId(isSub);
        if (ridD) swapMatrixRowWithNeighbor(isSub, ridD, 1);
      }
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  function renderMatrix() {
    if (!deck || !deck.matrix) return;
    var setups = [
      {
        tsuf: "",
        matrix: deck.matrix,
        rf: "row-filter-",
        cf: "col-filter-",
      },
      {
        tsuf: "-sub",
        matrix: subjectiveMatrixResolved(),
        rf: "row-filter-sub-",
        cf: "col-filter-sub-",
      },
    ];

    setups.forEach(function (cfg) {
      var m = cfg.matrix;
      if (!m || !Array.isArray(m.rows) || !Array.isArray(m.columns)) return;
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

          function cellDetailHtmlNow() {
            var co = m.cells[ck];
            return co && co.detailHtml != null
              ? co.detailHtml
              : "<p>—</p>";
          }
          function cellUploadKey() {
            return uploadPersistKeyForCell(
              cfg.tsuf === "-sub",
              row.id,
              col.id
            );
          }

          td.addEventListener("click", function (ev) {
            if (comparePick.active) {
              ev.preventDefault();
              ev.stopPropagation();
              flashCompareNope(td);
              return;
            }
            if (deckEditActive) return;
            openModal(
              row.label,
              col.label,
              cellDetailHtmlNow(),
              cellUploadKey()
            );
          });
          td.addEventListener("dblclick", function (ev) {
            if (comparePick.active) return;
            if (!deckEditActive) return;
            ev.preventDefault();
            openModal(
              row.label,
              col.label,
              cellDetailHtmlNow(),
              cellUploadKey()
            );
          });
          td.addEventListener("keydown", function (ev) {
            if (comparePick.active) {
              if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
              return;
            }
            if (deckEditActive) return;
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              openModal(
                row.label,
                col.label,
                cellDetailHtmlNow(),
                cellUploadKey()
              );
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
    if (!deck || !deck.matrix) return;
    var inSubjective = !!(t.closest && t.closest("#filter-deck-sub"));
    var targetMx = inSubjective
      ? subjectiveMatrixResolved()
      : deck.matrix;
    if (!targetMx) return;
    var id = t.dataset.axisId;
    if (t.dataset.axis === "row") {
      var row = targetMx.rows.find(function (r) {
        return r.id === id;
      });
      if (row) row.hidden = !t.checked;
    } else if (t.dataset.axis === "column") {
      var col = targetMx.columns.find(function (c) {
        return c.id === id;
      });
      if (col) col.hidden = !t.checked;
    }
    applyFilters();
  }

  function applyFilters() {
    if (!deck || !deck.matrix) return;
    applyFiltersForTable(deck.matrix, "#matrix-tbody", "#matrix-thead");
    var sub = subjectiveMatrixResolved();
    if (sub && sub !== deck.matrix) {
      applyFiltersForTable(sub, "#matrix-tbody-sub", "#matrix-thead-sub");
    }
    if (comparePick.active) syncComparePickUI();
  }

  function applyFiltersForTable(m, tbodySel, theadSel) {
    if (!m) return;
    $all(tbodySel + " tr").forEach(function (tr) {
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

    var thead = $(theadSel);
    if (thead) {
      var ths = $all("th", thead);
      m.columns.forEach(function (col, j) {
        var th = ths[j + 1];
        if (th) th.hidden = !!col.hidden;
      });
    }

    $all(tbodySel + " .matrix-cell").forEach(function (td) {
      var cid = td.dataset.colId;
      td.hidden = !!hideCol[cid];
      td.setAttribute("aria-hidden", hideCol[cid] ? "true" : "false");
    });
  }

  function appendUploadedDetailFigures(fileList) {
    var modal = $("#cell-modal");
    var body = $("#modal-body");
    if (!deckEditActive || !modal || !body || !fileList || !fileList.length)
      return;
    if (modal.hasAttribute("hidden")) return;

    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return f && f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) return;

    Promise.all(files.map(readFileAsDataItem))
      .then(function (newItems) {
        var mNow = $("#cell-modal");
        var bNow = $("#modal-body");
        if (!deckEditActive || !mNow || mNow.hasAttribute("hidden") || !bNow)
          return;
        newItems.forEach(function (it) {
          appendDataItemFigure(bNow, it);
        });
        refreshFigureRemoveButtonsInModalBody();
      })
      .catch(function (err) {
        console.warn("[matrix-core] 添加图片失败", err);
      });
  }

  function openModal(rowLabel, colLabel, html, persistKey) {
    var modal = $("#cell-modal");
    if (!modal) return;
    var meta = $("#modal-meta");
    var body = $("#modal-body");
    var shell = $("#modal-shell");
    var inp = $("#modal-image-input");
    if (meta) meta.textContent = rowLabel + " × " + colLabel;
    modal.dataset.uploadPersistKey = persistKey ? String(persistKey) : "";
    if (body) body.innerHTML = html;
    if (inp) inp.value = "";
    modal.removeAttribute("hidden");
    modal.setAttribute("aria-hidden", "false");
    restorePersistedUploadsToBody(modal.dataset.uploadPersistKey);
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
    delete modal.dataset.uploadPersistKey;
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
    var mx = activeMatrixForComparePick();
    if (!mx || !mx.rows) return true;
    var row = mx.rows.find(function (r) {
      return r.id === rowId;
    });
    return !row || !!row.hidden;
  }

  function isColAxisHidden(colId) {
    var mx = activeMatrixForComparePick();
    if (!mx || !mx.columns) return true;
    var col = mx.columns.find(function (c) {
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
    var prefix = slideIndexNav === 3 ? "#matrix-tbody-sub" : "#matrix-tbody";
    var tr = document.querySelector(
      prefix +
        ' tr[data-row-id="' +
        cssEscapeSel(rowId) +
        '"]'
    );
    return !tr || tr.hidden;
  }

  function colThHiddenDom(colId) {
    var prefix = slideIndexNav === 3 ? "#matrix-thead-sub" : "#matrix-thead";
    var th = document.querySelector(
      prefix +
        ' th[data-col-id="' +
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
    ["#comparison-table", "#comparison-table-sub"].forEach(function (tid) {
      var tbl = $(tid);
      if (!tbl) return;
      var activeHere =
        (slideIndexNav === 2 && tid === "#comparison-table") ||
        (slideIndexNav === 3 && tid === "#comparison-table-sub");
      tbl.classList.toggle("compare-picking", comparePick.active && !!activeHere);
      tbl.classList.toggle(
        "compare-pick-cols-live",
        comparePick.active && countCompareRowsSel() >= 1 && !!activeHere
      );
    });

    var sc = compareSlideRoot() || document.body;

    $all(".matrix-row-head", sc).forEach(function (th) {
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

    $all("thead th", sc).forEach(function (th) {
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

    $all("tbody .matrix-cell", sc).forEach(function (td) {
      td.classList.toggle("is-cp-muted", comparePick.active);
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

  function compareReportHeavyMedia(mx, rowIdsOrdered, colIdsOrdered) {
    var m = mx;
    if (!m || !m.cells) return false;
    var heavy = false;
    rowIdsOrdered.forEach(function (rowId) {
      colIdsOrdered.forEach(function (colId) {
        if (heavy) return;
        var ck = cellKey(rowId, colId);
        var cell = m.cells[ck];
        var d =
          cell && cell.detailHtml != null ? String(cell.detailHtml) : "";
        if (/<img\b/i.test(d) || /detail-figure/.test(d)) heavy = true;
      });
    });
    return heavy;
  }

  /** 列少则列宽大、填满屏宽；列多或大图则单列下限略高更早触发横向滚动 */
  function compareReportCellMinPx(nc, heavy) {
    var n = Math.max(1, nc);
    var spread = Math.round(980 / n);
    var lo = heavy ? 228 : 198;
    var hi = heavy ? 400 : 360;
    return Math.min(hi, Math.max(lo, spread));
  }

  function buildCompareReportHTML(mx, rowIdsOrdered, colIdsOrdered) {
    var m = mx || deck.matrix;
    var nr = rowIdsOrdered.length;
    var nc = colIdsOrdered.length;
    var heavyMedia = compareReportHeavyMedia(mx, rowIdsOrdered, colIdsOrdered);
    var cellMinPx = compareReportCellMinPx(nc, heavyMedia);
    var rootStyle =
      "--cr-cols:" +
      nc +
      ";--cr-cell-min:" +
      cellMinPx +
      "px;--cr-gap:0.65rem;";
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
      body += '<div class="cr-model-grid-scroll">';
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

      body += "</div></div></section>";
    });

    return (
      '<div class="cr-report-root" style="' +
      rootStyle +
      '" data-cr-cols="' +
      nc +
      '" data-cr-heavy="' +
      (heavyMedia ? "1" : "0") +
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
    var mx = activeMatrixForComparePick();
    if (!mx) return;

    var orderR = mx.rows.map(function (r) {
      return r.id;
    }).filter(function (id) {
      return !!comparePick.rows[id] && !isRowAxisHidden(id);
    });

    var orderC = mx.columns.map(function (c) {
      return c.id;
    }).filter(function (id) {
      return !!comparePick.cols[id] && !isColAxisHidden(id);
    });

    if (!orderR.length || !orderC.length) return;

    var html = buildCompareReportHTML(mx, orderR, orderC);
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

  var deckEditActive = false;
  var deckEditBaselineJSON = "";

  function parsePersistUploadKey(pk) {
    var p = String(pk || "").split("|");
    if (p.length < 4 || p[0] !== "v1") return null;
    return {
      subjective: p[1] === "sub",
      rowId: p[2],
      colId: p[3],
    };
  }

  function bestPlainCe() {
    try {
      var probe = document.createElement("div");
      probe.contentEditable = "plaintext-only";
      return probe.contentEditable === "plaintext-only"
        ? "plaintext-only"
        : "true";
    } catch (e) {
      return "true";
    }
  }

  function serializeMatrixForPatch(m) {
    if (!m) return null;
    var cells = {};
    Object.keys(m.cells || {}).forEach(function (k) {
      var c = m.cells[k];
      cells[k] = {
        summary: c && c.summary != null ? String(c.summary) : "",
        detailHtml:
          c && c.detailHtml != null ? String(c.detailHtml) : "<p>—</p>",
      };
    });
    return {
      cornerLabel: m.cornerLabel != null ? String(m.cornerLabel) : "",
      rows: (m.rows || []).map(function (r) {
        return {
          id: String(r.id),
          label: r.label != null ? String(r.label) : "",
          hidden: !!r.hidden,
        };
      }),
      columns: (m.columns || []).map(function (col) {
        return {
          id: String(col.id),
          label: col.label != null ? String(col.label) : "",
          hidden: !!col.hidden,
        };
      }),
      cells: cells,
    };
  }

  function applyMatrixPatchSnap(m, snap) {
    if (!m || !snap) return;
    if (snap.cornerLabel != null) m.cornerLabel = String(snap.cornerLabel);

    if (Array.isArray(snap.rows)) {
      m.rows = snap.rows
        .map(function (pr) {
          return {
            id: String(pr.id != null ? pr.id : ""),
            label: pr.label != null ? String(pr.label) : "",
            hidden: !!pr.hidden,
          };
        })
        .filter(function (r) {
          return r.id !== "";
        });
    }

    if (Array.isArray(snap.columns)) {
      m.columns = snap.columns
        .map(function (pc) {
          return {
            id: String(pc.id != null ? pc.id : ""),
            label: pc.label != null ? String(pc.label) : "",
            hidden: !!pc.hidden,
          };
        })
        .filter(function (c) {
          return c.id !== "";
        });
    }

    if (snap.cells != null && typeof snap.cells === "object") {
      var nextCells = {};
      Object.keys(snap.cells).forEach(function (k) {
        var src = snap.cells[k];
        nextCells[k] = {
          summary: src && src.summary != null ? String(src.summary) : "",
          detailHtml:
            src && src.detailHtml != null ? String(src.detailHtml) : "<p>—</p>",
        };
      });
      m.cells = nextCells;
    }
  }

  function applyDeckPatchSnapshot(patch) {
    if (!patch || patch.v !== 1 || !deck) return;
    try {
      if (patch.cover)
        deck.cover = Object.assign({}, deck.cover || {}, patch.cover);
      if (patch.overview)
        deck.overview = JSON.parse(JSON.stringify(patch.overview));
      if (patch.ending)
        deck.ending = Object.assign({}, deck.ending || {}, patch.ending);
      if (patch.matrixObjective)
        applyMatrixPatchSnap(deck.matrix, patch.matrixObjective);
      if (patch.matrixSubjective) {
        if (!deck.matrixSubjective) {
          deck.matrixSubjective = {
            cornerLabel:
              deck.matrix && deck.matrix.cornerLabel != null
                ? String(deck.matrix.cornerLabel)
                : "",
            rows: [],
            columns: [],
            cells: {},
          };
        }
        applyMatrixPatchSnap(deck.matrixSubjective, patch.matrixSubjective);
      }
      applySlideTitlesFromStored(patch.slideTitles);
    } catch (err2) {
      console.warn("[matrix-core] 合并本地快照失败：", err2);
    }
  }

  function buildDeckPatchSnapshot() {
    if (!deck) return null;
    return {
      v: 1,
      slideTitles: gatherSlideTitlesFromDom(),
      cover: JSON.parse(JSON.stringify(deck.cover || {})),
      overview: JSON.parse(JSON.stringify(deck.overview || {})),
      ending: JSON.parse(JSON.stringify(deck.ending || {})),
      matrixObjective: serializeMatrixForPatch(deck.matrix),
      matrixSubjective: serializeMatrixForPatch(deck.matrixSubjective),
    };
  }

  function gatherSlideTitlesFromDom() {
    var ao = $("section[data-slide-index='2'] .slide-matrix-title");
    var as = $("section[data-slide-index='3'] .slide-matrix-title");
    return {
      objective: ao ? String(ao.innerText || ao.textContent || "").trim() : "",
      subjective: as ? String(as.innerText || as.textContent || "").trim() : "",
    };
  }

  function applySlideTitlesFromStored(st) {
    if (!st) return;
    var ao = $("section[data-slide-index='2'] .slide-matrix-title");
    var bs = $("section[data-slide-index='3'] .slide-matrix-title");
    if (ao && st.objective != null && st.objective !== "")
      ao.textContent = st.objective;
    if (bs && st.subjective != null && st.subjective !== "")
      bs.textContent = st.subjective;
  }

  function normalizeMatrixTdSummary(td) {
    var t = String(td.innerText != null ? td.innerText : td.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\u2014|\u2212|\uff0d/g, "-")
      .trim();
    return t.replace(/^[\-\u2014\u2212]+$/, "").trim();
  }

  function collectMatrixFromTable(tableSel, m) {
    var table = $(tableSel);
    if (!table || !m) return;
    var cr = $("thead .matrix-corner", table);
    if (cr) m.cornerLabel = String(cr.innerText || "").trim();
    var ths = $all("thead th", table);
    for (var ii = 1; ii < ths.length; ii++) {
      var th = ths[ii];
      var cid = th.dataset.colId;
      if (!cid) continue;
      var col = (m.columns || []).find(function (x) {
        return String(x.id) === String(cid);
      });
      if (col) col.label = String(th.innerText || "").trim();
    }
    $all("tbody tr", table).forEach(function (tr) {
      var rid = tr.dataset.rowId;
      if (!rid) return;
      var rth = $(".matrix-row-head", tr);
      if (rth) {
        var row = (m.rows || []).find(function (x) {
          return String(x.id) === String(rid);
        });
        if (row) row.label = String(rth.innerText || "").trim();
      }
      $all(".matrix-cell", tr).forEach(function (td1) {
        var cid2 = td1.dataset.colId;
        if (!cid2) return;
        var ck = cellKey(rid, cid2);
        var cellObj =
          m.cells[ck] || { summary: "", detailHtml: "<p>—</p>" };
        cellObj.summary = normalizeMatrixTdSummary(td1);
        m.cells[ck] = cellObj;
      });
    });
  }

  function collectOverviewSectionsFromDom() {
    var root = $("#overview-sections");
    if (!root) return [];
    return $all("article.nested-block", root).map(function (art) {
      var hh = $(".nested-heading", art);
      var bd = $(".nested-body", art);
      return {
        heading: hh ? String(hh.innerHTML || "").trim() : "",
        bodyHtml: bd ? String(bd.innerHTML || "").trim() : "",
      };
    });
  }

  function collectDOMIntoDeck() {
    if (!deck) return;
    deck.cover = deck.cover || {};
    deck.overview = deck.overview || {};
    var eb1 = $("#cover-eyebrow");
    var ct1 = $("#cover-title");
    var cs1 = $("#cover-subtitle");
    if (eb1) deck.cover.eyebrow = String(eb1.innerText || "").trim();
    if (ct1) deck.cover.title = String(ct1.innerHTML || "").trim();
    if (cs1) deck.cover.subtitle = String(cs1.innerHTML || "").trim();
    var ot2 = $("#overview-title");
    if (ot2 && !ot2.hasAttribute("hidden"))
      deck.overview.title = String(ot2.innerText || "").trim();
    var secs = collectOverviewSectionsFromDom();
    if (secs.length) deck.overview.sections = secs;
    var eey = $("#ending-eyebrow");
    var et = $("#ending-title");
    var ebod = $("#ending-body");
    deck.ending = deck.ending || {};
    if (eey) deck.ending.eyebrow = String(eey.innerText || "").trim();
    if (et) deck.ending.title = String(et.innerHTML || "").trim();
    if (ebod) deck.ending.bodyHtml = String(ebod.innerHTML || "").trim();
    collectMatrixFromTable("#comparison-table", deck.matrix);
    collectMatrixFromTable(
      "#comparison-table-sub",
      subjectiveMatrixResolved()
    );
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
    var pk = modal.dataset.uploadPersistKey;
    var body = $("#modal-body");
    if (!pk || !body) return;
    var p = parsePersistUploadKey(pk);
    if (!p) return;
    var mx = p.subjective ? subjectiveMatrixResolved() : deck.matrix;
    if (!mx || !mx.cells) return;
    var ck = cellKey(p.rowId, p.colId);
    var co = mx.cells[ck] || { summary: "", detailHtml: "<p>—</p>" };
    var stripped = cloneBodyStripFigureRemoveUi(body);
    co.detailHtml = stripped !== "" ? stripped : "<p>—</p>";
    mx.cells[ck] = co;
    return setUploadRecord(pk, { items: [] });
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

  function setDeckContentEditable(enabled) {
    deckEditActive = !!enabled;
    document.body.classList.toggle("deck--editing", !!enabled);
    var plc = enabled ? bestPlainCe() : "inherit";
    var ee;
    var eti;
    var ebodd;
    if (enabled) {
      ee = $("#ending-eyebrow");
      eti = $("#ending-title");
      ebodd = $("#ending-body");
    }
    if (enabled) {
      var eb = $("#cover-eyebrow");
      var ct = $("#cover-title");
      var cs = $("#cover-subtitle");
      var ot = $("#overview-title");
      var h2o = $("section[data-slide-index='2'] .slide-matrix-title");
      var h2s = $("section[data-slide-index='3'] .slide-matrix-title");
      if (eb) eb.contentEditable = plc;
      if (ct) ct.contentEditable = "true";
      if (cs) cs.contentEditable = "true";
      if (ot && !ot.hasAttribute("hidden")) ot.contentEditable = plc;
      if (h2o) h2o.contentEditable = plc;
      if (h2s) h2s.contentEditable = plc;
      $all("#overview-sections .nested-heading").forEach(function (h) {
        h.contentEditable = "true";
      });
      $all("#overview-sections .nested-body").forEach(function (b) {
        b.contentEditable = "true";
      });
      if (ee) ee.contentEditable = plc;
      if (eti) eti.contentEditable = "true";
      if (ebodd) ebodd.contentEditable = "true";
      applyMatrixTableContentEditable(plc);
      var mbody = $("#modal-body");
      var cmod = $("#cell-modal");
      if (mbody && cmod && !cmod.hasAttribute("hidden")) {
        mbody.contentEditable = "true";
      }
    } else {
      [
        $("#cover-eyebrow"),
        $("#cover-title"),
        $("#cover-subtitle"),
        $("#overview-title"),
        $("section[data-slide-index='2'] .slide-matrix-title"),
        $("section[data-slide-index='3'] .slide-matrix-title"),
        $("#ending-eyebrow"),
        $("#ending-title"),
        $("#ending-body"),
        $("#modal-body"),
      ].forEach(function (elz) {
        if (elz) elz.removeAttribute("contenteditable");
      });
      $all("#overview-sections .nested-heading, #overview-sections .nested-body").forEach(
        function (n) {
          n.removeAttribute("contenteditable");
        }
      );
      $all(
        ".matrix-corner, thead th, .matrix-row-head, .matrix-cell"
      ).forEach(function (n2) {
        n2.removeAttribute("contenteditable");
      });
      $all("#modal-body .detail-upload-remove").forEach(function (b3) {
        if (b3.parentNode) b3.parentNode.removeChild(b3);
      });
      lastMatrixAxisPick.obj.colId = lastMatrixAxisPick.obj.rowId = null;
      lastMatrixAxisPick.sub.colId = lastMatrixAxisPick.sub.rowId = null;
    }
    if (enabled) {
      refreshFigureRemoveButtonsInModalBody();
    }
  }

  function enterDeckEditMode() {
    if (!deck) return;
    deckEditBaselineJSON = JSON.stringify(deck);
    var saveBtn = $("#deck-edit-save");
    var exitBtn = $("#deck-edit-exit");
    var entBtn = $("#deck-edit-enter");
    if (saveBtn) saveBtn.removeAttribute("disabled");
    if (exitBtn) exitBtn.removeAttribute("disabled");
    if (entBtn) entBtn.setAttribute("disabled", "disabled");
    setDeckContentEditable(true);
    var cmod = $("#cell-modal");
    var mb = $("#modal-body");
    if (deckEditActive && cmod && !cmod.hasAttribute("hidden") && mb) {
      mb.contentEditable = "true";
      refreshFigureRemoveButtonsInModalBody();
    }
  }

  function exitDeckEditDiscard() {
    closeModal();
    if (deckEditBaselineJSON && deckEditBaselineJSON.length) {
      try {
        deck = JSON.parse(deckEditBaselineJSON);
      } catch (eParse2) {}
    }
    deckEditBaselineJSON = "";
    setDeckContentEditable(false);
    var saveBtn2 = $("#deck-edit-save");
    var exitBtn2 = $("#deck-edit-exit");
    var entBtn2 = $("#deck-edit-enter");
    if (saveBtn2) saveBtn2.setAttribute("disabled", "disabled");
    if (exitBtn2) exitBtn2.setAttribute("disabled", "disabled");
    if (entBtn2) entBtn2.removeAttribute("disabled");
    renderCover();
    renderOverview();
    renderEnding();
    renderMatrix();
    hydrateTitle();
  }

  function saveDeckPersistAll() {
    if (!deck) return Promise.resolve();
    collectDOMIntoDeck();
    return Promise.resolve(flushModalDetailIntoDeckWhenOpen()).then(function () {
      try {
        var snap = buildDeckPatchSnapshot();
        return deckPatchDbPut(JSON.parse(JSON.stringify(snap))).then(
          function () {
            deckEditBaselineJSON = JSON.stringify(deck);
          }
        );
      } catch (eSav) {
        console.warn("[matrix-core] 保存快照失败：", eSav);
      }
    });
  }

  function clipboardPlainForPaste(ev) {
    var t = "";
    try {
      t = ev.clipboardData.getData("text/plain");
    } catch (e1) {}
    if (t != null && String(t).trim() !== "") return String(t);
    try {
      var html = ev.clipboardData.getData("text/html");
      if (html && String(html).trim() !== "") {
        var sandbox = document.createElement("div");
        sandbox.innerHTML = html;
        return String(
          sandbox.innerText != null && sandbox.innerText !== ""
            ? sandbox.innerText
            : sandbox.textContent || ""
        );
      }
    } catch (e2) {}
    return "";
  }

  function insertPlainAtSelection(text) {
    var s = text != null ? String(text) : "";
    try {
      if (document.execCommand && document.execCommand("insertText", false, s))
        return;
    } catch (eExec) {}
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var rg = sel.getRangeAt(0);
    rg.deleteContents();
    rg.insertNode(document.createTextNode(s));
    rg.collapse(false);
    sel.removeAllRanges();
    sel.addRange(rg);
  }

  function bindDeckPastePlainOnly() {
    if (document.documentElement.dataset.deckPastePlainBound === "1") return;
    document.documentElement.dataset.deckPastePlainBound = "1";
    document.addEventListener(
      "paste",
      function (ev) {
        if (!deckEditActive) return;
        var targ = ev.target;
        if (!(targ instanceof Node)) return;
        var el =
          targ.nodeType === Node.TEXT_NODE ? targ.parentElement : targ;
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
        var plain = clipboardPlainForPaste(ev);
        var cd = ev.clipboardData;
        var hasBin =
          !!cd && !!(cd.files && cd.files.length);
        if (hasBin && String(plain || "").trim() === "") return;
        ev.preventDefault();
        insertPlainAtSelection(plain || "");
      },
      true
    );
  }

  function normalizePortableDeckImport(raw) {
    if (!raw || typeof raw !== "object") return null;
    var m = raw.matrix;
    if (
      !m ||
      typeof m !== "object" ||
      !Array.isArray(m.rows) ||
      !Array.isArray(m.columns)
    )
      return null;
    m.cells = m.cells != null && typeof m.cells === "object" ? m.cells : {};
    raw.cover =
      raw.cover != null && typeof raw.cover === "object" ? raw.cover : {};
    raw.overview =
      raw.overview != null && typeof raw.overview === "object"
        ? raw.overview
        : { sections: [] };
    if (!Array.isArray(raw.overview.sections)) raw.overview.sections = [];
    raw.ending =
      raw.ending != null && typeof raw.ending === "object"
        ? raw.ending
        : {};
    return raw;
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
    } catch (eEx) {
      console.warn("[matrix-core] 导出 JSON 失败", eEx);
    }
  }

  function applyPortableDeckImported(nextDeck) {
    var wasEditing = deckEditActive;
    if (wasEditing) setDeckContentEditable(false);
    closeModal();
    exitComparePickQuiet();
    deckEditBaselineJSON = "";
    deck = nextDeck;
    renderCover();
    renderOverview();
    renderEnding();
    renderMatrix();
    hydrateTitle();
    if (deck.theme != null && String(deck.theme).trim() !== "") {
      document.documentElement.dataset.deckTheme = String(deck.theme).trim();
    } else {
      try {
        delete document.documentElement.dataset.deckTheme;
      } catch (eDm) {}
    }
    return saveDeckPersistAll().then(function () {
      if (wasEditing) enterDeckEditMode();
    });
  }

  function bindDeckPortableTransfer() {
    var exBtn = $("#deck-portable-export");
    var trig = $("#deck-portable-import-trigger");
    var inp = $("#deck-portable-import-file");
    if (!exBtn || !trig || !inp) return;
    if (document.documentElement.dataset.deckPortableTransferBound === "1")
      return;
    document.documentElement.dataset.deckPortableTransferBound = "1";
    exBtn.addEventListener("click", function () {
      exportDeckPortableDownload();
    });
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
            console.warn("[matrix-core] 导入失败：无效 JSON（需含 matrix.rows/columns）");
            return;
          }
          applyPortableDeckImported(norm).catch(Boolean);
        } catch (eImp) {
          console.warn("[matrix-core] 导入失败：", eImp);
        }
      };
      reader.onerror = function () {
        inp.value = "";
        console.warn("[matrix-core] 读取文件失败");
      };
      reader.readAsText(f);
    });
  }

  function bindDeckEditToolbar() {
    var ent = $("#deck-edit-enter");
    var sav = $("#deck-edit-save");
    var ext = $("#deck-edit-exit");
    if (!ent || document.documentElement.dataset.deckToolbarBound === "1") return;
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
    if (ext)
      ext.addEventListener("click", function () {
        exitDeckEditDiscard();
      });
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
    bindModal();
    bindEscapeStack();
    bindMatrixAxisPickMemory();
    bindMatrixStructureToolbar();
    bindDeckEditToolbar();
    bindDeckPortableTransfer();
    bindDeckPastePlainOnly();
    bootLoadDeckState()
      .catch(function () {})
      .finally(function () {
        renderCover();
        renderOverview();
        renderEnding();
        renderMatrix();
        bindCompareFab();
        bindCompareReportModal();
        hydrateTitle();
        bindSlideNav();
        if (deck.theme != null && String(deck.theme).trim() !== "") {
          document.documentElement.dataset.deckTheme =
            String(deck.theme).trim();
        } else {
          try {
            delete document.documentElement.dataset.deckTheme;
          } catch (eTb) {}
        }
      });
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
    bootLoadDeckState()
      .catch(function () {})
      .finally(function () {
        renderCover();
        renderOverview();
        renderEnding();
        renderMatrix();
        repositionCompareFabHost(slideIndexNav);
        bindCompareFab();
        bindCompareReportModal();
        hydrateTitle();
      });
  };
})();
