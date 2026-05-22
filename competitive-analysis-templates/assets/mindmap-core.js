/**
 * mindmap-core.js — 思维导图树数据、布局与 DOM 片段
 * 由 matrix-core.js 的 mindmap 模板调用；挂到 window.MindmapDeck
 */
(function () {
  "use strict";

  var LEVEL_GAP = 168;
  var SIBLING_GAP = 22;
  var PAD = 28;
  var NODE_MIN_W = 96;
  var NODE_MAX_W = 200;
  var LABEL_LINE_H = 22;
  var NOTE_MAX_W = 220;
  var NOTE_PAD = 8;

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

  function newNodeId() {
    return "n_" + String(Date.now()) + "_" + String(Math.floor(Math.random() * 1e4));
  }

  function defaultRoot() {
    return {
      id: "n_root",
      label: "中心主题",
      note: "",
      children: [
        {
          id: newNodeId(),
          label: "分支一",
          note: "",
          children: [],
        },
        {
          id: newNodeId(),
          label: "分支二",
          note: "可写引出说明",
          children: [],
        },
      ],
    };
  }

  function defaultPageData() {
    return {
      title: "思维导图",
      root: defaultRoot(),
    };
  }

  function normalizeTree(node) {
    if (!node || typeof node !== "object") {
      return defaultRoot();
    }
    if (!node.id) node.id = newNodeId();
    if (node.label == null) node.label = "节点";
    if (node.note == null) node.note = "";
    if (!Array.isArray(node.children)) node.children = [];
    node.children.forEach(normalizeTree);
    return node;
  }

  function findNode(root, id) {
    if (!root) return null;
    if (String(root.id) === String(id)) return root;
    var ch = root.children || [];
    for (var i = 0; i < ch.length; i++) {
      var hit = findNode(ch[i], id);
      if (hit) return hit;
    }
    return null;
  }

  function findParent(root, id, parent) {
    if (!root) return null;
    if (String(root.id) === String(id)) return parent;
    var ch = root.children || [];
    for (var i = 0; i < ch.length; i++) {
      var hit = findParent(ch[i], id, root);
      if (hit !== undefined && hit !== null) return hit;
    }
    return null;
  }

  function estimateLabelWidth(text) {
    var t = String(text || "").trim() || "节点";
    var len = 0;
    for (var i = 0; i < t.length; i++) {
      len += t.charCodeAt(i) > 255 ? 1.85 : 1;
    }
    return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.ceil(len * 11 + 28)));
  }

  function noteVisible(note) {
    return !!(note && String(note).replace(/\s/g, "").length);
  }

  function measureNode(node) {
    var w = estimateLabelWidth(node.label);
    var labelH = LABEL_LINE_H + 14;
    var noteH = 0;
    if (noteVisible(node.note)) {
      var lines = String(node.note).split(/\r?\n/).length;
      noteH = Math.max(36, lines * 18 + NOTE_PAD * 2);
    }
    return { w: w, labelH: labelH, noteH: noteH, h: labelH + noteH };
  }

  function nodeLayoutById(out, id) {
    for (var i = out.nodes.length - 1; i >= 0; i--) {
      if (String(out.nodes[i].id) === String(id)) return out.nodes[i];
    }
    return null;
  }

  /** 左→右树：返回子树占用总高度 */
  function layoutAssign(node, depth, y0, out) {
    var m = measureNode(node);
    var ch = node.children || [];
    if (!ch.length) {
      out.nodes.push({
        id: node.id,
        label: node.label,
        note: node.note,
        depth: depth,
        x: depth * LEVEL_GAP + PAD,
        y: y0,
        w: m.w,
        h: m.h,
        labelH: m.labelH,
        noteH: m.noteH,
        hasNote: noteVisible(node.note),
      });
      return m.h + SIBLING_GAP;
    }

    var y = y0;
    var centers = [];
    for (var i = 0; i < ch.length; i++) {
      var subH = layoutAssign(ch[i], depth + 1, y, out);
      var laid = nodeLayoutById(out, ch[i].id);
      if (laid) centers.push(laid.y + laid.h / 2);
      y += subH;
    }

    var midY =
      centers.length > 0
        ? (centers[0] + centers[centers.length - 1]) / 2
        : y0 + (y - y0 - SIBLING_GAP) / 2;
    var nx = depth * LEVEL_GAP + PAD;
    var ny = midY - m.h / 2;

    out.nodes.push({
      id: node.id,
      label: node.label,
      note: node.note,
      depth: depth,
      x: nx,
      y: ny,
      w: m.w,
      h: m.h,
      labelH: m.labelH,
      noteH: m.noteH,
      hasNote: noteVisible(node.note),
    });

    return Math.max(y - y0, m.h + SIBLING_GAP);
  }

  function buildEdges(root, nodesById, edges) {
    var ch = root.children || [];
    var parent = nodesById[root.id];
    if (!parent) return;
    for (var i = 0; i < ch.length; i++) {
      var child = nodesById[ch[i].id];
      if (child) {
        edges.push({
          x1: parent.x + parent.w,
          y1: parent.y + parent.h / 2,
          x2: child.x,
          y2: child.y + child.h / 2,
        });
      }
      buildEdges(ch[i], nodesById, edges);
    }
  }

  function computeLayout(root) {
    normalizeTree(root);
    var out = { nodes: [], edges: [] };
    layoutAssign(root, 0, PAD, out);
    var nodesById = {};
    var maxX = PAD;
    var maxY = PAD;
    out.nodes.forEach(function (n) {
      nodesById[n.id] = n;
      maxX = Math.max(maxX, n.x + n.w + PAD);
      maxY = Math.max(maxY, n.y + n.h + PAD);
    });
    buildEdges(root, nodesById, out.edges);
    out.width = Math.max(320, Math.ceil(maxX));
    out.height = Math.max(240, Math.ceil(maxY));
    return out;
  }

  function addChild(root, parentId) {
    normalizeTree(root);
    var parent = findNode(root, parentId) || root;
    if (!parent.children) parent.children = [];
    if (parent.children.length >= 24) return false;
    parent.children.push({
      id: newNodeId(),
      label: "新分支",
      note: "",
      children: [],
    });
    return true;
  }

  function removeChild(root, parentId, childId) {
    normalizeTree(root);
    var parent = findNode(root, parentId) || root;
    if (!parent.children || !parent.children.length) return false;
    if (String(parent.id) === "n_root" && parent.children.length <= 1) return false;
    var idx = -1;
    for (var i = 0; i < parent.children.length; i++) {
      if (String(parent.children[i].id) === String(childId)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      parent.children.pop();
      return true;
    }
    parent.children.splice(idx, 1);
    return true;
  }

  function renderEdgesSvg(edges) {
    var paths = "";
    edges.forEach(function (e) {
      var mx = (e.x1 + e.x2) / 2;
      paths +=
        '<path class="mindmap-edge" d="M' +
        e.x1 +
        " " +
        e.y1 +
        " C" +
        mx +
        " " +
        e.y1 +
        ", " +
        mx +
        " " +
        e.y2 +
        ", " +
        e.x2 +
        " " +
        e.y2 +
        '"/>';
    });
    return '<svg class="mindmap-edges" aria-hidden="true">' + paths + "</svg>";
  }

  function renderNodesHtml(nodes, selectedId) {
    var html = '<div class="mindmap-nodes" role="tree">';
    nodes.forEach(function (n) {
      var sel = selectedId && String(selectedId) === String(n.id) ? " is-selected" : "";
      var isRoot = String(n.id) === "n_root" ? " mindmap-node--root" : "";
      html +=
        '<div class="mindmap-node' +
        isRoot +
        sel +
        '" role="treeitem" data-node-id="' +
        escapeHtmlAttr(n.id) +
        '" style="left:' +
        n.x +
        "px;top:" +
        n.y +
        "px;width:" +
        n.w +
        'px" tabindex="0">' +
        '<div class="mindmap-node__label" data-field="label">' +
        escapeHtml(n.label || "") +
        "</div>";
      if (n.hasNote) {
        html +=
          '<div class="mindmap-node__note" data-field="note">' +
          escapeHtml(n.note) +
          "</div>";
      } else {
        html +=
          '<div class="mindmap-node__note mindmap-node__note--empty" data-field="note" hidden></div>';
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function fitCanvasToViewport(viewport, canvas) {
    if (!viewport || !canvas) return;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    if (vw < 40 || vh < 40) return;
    var cw = parseFloat(canvas.dataset.layoutWidth || "0") || canvas.offsetWidth;
    var ch = parseFloat(canvas.dataset.layoutHeight || "0") || canvas.offsetHeight;
    if (cw < 1 || ch < 1) return;
    var pad = 12;
    var scale = Math.min((vw - pad) / cw, (vh - pad) / ch, 1);
    scale = Math.max(0.35, scale);
    canvas.style.transform = "scale(" + scale + ")";
    canvas.style.transformOrigin = "0 0";
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }

  function bindFitOnResize(viewport, canvas) {
    if (!viewport || viewport.dataset.mindmapFitBound === "1") return;
    viewport.dataset.mindmapFitBound = "1";
    var run = function () {
      fitCanvasToViewport(viewport, canvas);
    };
    if (typeof ResizeObserver !== "undefined") {
      try {
        var ro = new ResizeObserver(run);
        ro.observe(viewport);
      } catch (e) {
        window.addEventListener("resize", run);
      }
    } else {
      window.addEventListener("resize", run);
    }
    run();
  }

  function collectTreeFromDom(section, root) {
    normalizeTree(root);
    var byId = {};
    function index(node) {
      byId[node.id] = node;
      (node.children || []).forEach(index);
    }
    index(root);

    $allNodes(section).forEach(function (el) {
      var id = el.getAttribute("data-node-id");
      if (!id || !byId[id]) return;
      var lab = el.querySelector('[data-field="label"]');
      var note = el.querySelector('[data-field="note"]');
      if (lab) byId[id].label = String(lab.innerText || "").trim() || "节点";
      if (note && !note.hasAttribute("hidden")) {
        byId[id].note = String(note.innerText || "").trim();
      } else if (note && note.hasAttribute("hidden")) {
        byId[id].note = "";
      }
    });
    return root;
  }

  function $allNodes(section) {
    return Array.prototype.slice.call(
      section.querySelectorAll(".mindmap-node[data-node-id]")
    );
  }

  function getSelectedId(section) {
    return section.getAttribute("data-mindmap-selected") || "n_root";
  }

  function setSelectedId(section, id) {
    section.setAttribute("data-mindmap-selected", id || "n_root");
    $allNodes(section).forEach(function (el) {
      var on = String(el.getAttribute("data-node-id")) === String(id);
      el.classList.toggle("is-selected", on);
    });
  }

  window.MindmapDeck = {
    defaultPageData: defaultPageData,
    normalizeTree: normalizeTree,
    computeLayout: computeLayout,
    findNode: findNode,
    findParent: findParent,
    addChild: addChild,
    removeChild: removeChild,
    renderEdgesSvg: renderEdgesSvg,
    renderNodesHtml: renderNodesHtml,
    fitCanvasToViewport: fitCanvasToViewport,
    bindFitOnResize: bindFitOnResize,
    collectTreeFromDom: collectTreeFromDom,
    getSelectedId: getSelectedId,
    setSelectedId: setSelectedId,
    newNodeId: newNodeId,
  };
})();
