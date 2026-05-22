/**
 * mindmap-core.js — 多总节点、自由定位、整体缩放的思维导图
 */
(function () {
  "use strict";

  var LEVEL_GAP = 168;
  var SIBLING_GAP = 22;
  var ROOT_GAP = 48;
  var PAD = 32;
  var NODE_MIN_W = 96;
  var NODE_MAX_W = 200;
  var LABEL_LINE_H = 22;
  var NOTE_PAD = 8;
  var ZOOM_MIN = 0.35;
  var ZOOM_MAX = 2.5;
  var DRAG_THRESHOLD = 4;

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

  function defaultHub(label) {
    return {
      id: newNodeId(),
      label: label || "总节点",
      note: "",
      fx: null,
      fy: null,
      children: [],
    };
  }

  function defaultPageData() {
    var a = defaultHub("中心主题");
    a.children = [
      { id: newNodeId(), label: "分支一", note: "", fx: null, fy: null, children: [] },
      { id: newNodeId(), label: "分支二", note: "可写引出说明", fx: null, fy: null, children: [] },
    ];
    return {
      title: "思维导图",
      zoom: 1,
      roots: [a],
    };
  }

  function noteVisible(note) {
    return !!(note && String(note).replace(/\s/g, "").length);
  }

  function normalizeNode(node) {
    if (!node || typeof node !== "object") return defaultHub("节点");
    if (!node.id) node.id = newNodeId();
    if (node.label == null) node.label = "节点";
    if (node.note == null) node.note = "";
    if (node.fx != null && node.fx !== "") node.fx = Number(node.fx);
    else node.fx = null;
    if (node.fy != null && node.fy !== "") node.fy = Number(node.fy);
    else node.fy = null;
    if (!Array.isArray(node.children)) node.children = [];
    node.children.forEach(normalizeNode);
    return node;
  }

  /** 兼容旧版单 root */
  function normalizePageData(data) {
    data = data || {};
    if (!Array.isArray(data.roots) || !data.roots.length) {
      if (data.root) {
        data.roots = [normalizeNode(data.root)];
        delete data.root;
      } else {
        var d = defaultPageData();
        data.roots = d.roots;
      }
    }
    data.roots = data.roots.map(function (r) {
      return normalizeNode(r);
    });
    if (data.zoom == null || isNaN(Number(data.zoom))) data.zoom = 1;
    data.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(data.zoom)));
    if (!data.title) data.title = "思维导图";
    return data;
  }

  function forEachNode(roots, fn) {
    function walk(n) {
      fn(n);
      (n.children || []).forEach(walk);
    }
    roots.forEach(walk);
  }

  function findNodeInForest(roots, id) {
    var hit = null;
    forEachNode(roots, function (n) {
      if (!hit && String(n.id) === String(id)) hit = n;
    });
    return hit;
  }

  function findParentInForest(roots, id) {
    var parent = null;
    function walk(n, p) {
      if (String(n.id) === String(id)) {
        parent = p;
        return;
      }
      (n.children || []).forEach(function (c) {
        if (!parent) walk(c, n);
      });
    }
    roots.forEach(function (r) {
      if (!parent) walk(r, null);
    });
    return parent;
  }

  function isHubNode(roots, id) {
    for (var i = 0; i < roots.length; i++) {
      if (String(roots[i].id) === String(id)) return true;
    }
    return false;
  }

  function estimateLabelWidth(text) {
    var t = String(text || "").trim() || "节点";
    var len = 0;
    for (var i = 0; i < t.length; i++) {
      len += t.charCodeAt(i) > 255 ? 1.85 : 1;
    }
    return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.ceil(len * 11 + 28)));
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

  function hasFixedPos(node) {
    return node.fx != null && node.fy != null && !isNaN(node.fx) && !isNaN(node.fy);
  }

  function nodeLayoutById(list, id) {
    for (var i = list.length - 1; i >= 0; i--) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function layoutAssign(node, depth, y0, out, originX) {
    var m = measureNode(node);
    var ch = node.children || [];
    var nx;
    var ny;
    var consumed = 0;

    if (hasFixedPos(node)) {
      nx = node.fx;
      ny = node.fy;
    } else if (!ch.length) {
      nx = originX + depth * LEVEL_GAP;
      ny = y0;
    } else {
      var y = y0;
      var centers = [];
      for (var i = 0; i < ch.length; i++) {
        var subH = layoutAssign(ch[i], depth + 1, y, out, originX);
        var laid = nodeLayoutById(out.nodes, ch[i].id);
        if (laid) centers.push(laid.y + laid.h / 2);
        y += subH;
        consumed = y - y0;
      }
      nx = originX + depth * LEVEL_GAP;
      ny =
        centers.length > 0
          ? (centers[0] + centers[centers.length - 1]) / 2 - m.h / 2
          : y0;
    }

    out.nodes.push({
      id: node.id,
      label: node.label,
      note: node.note,
      depth: depth,
      isHub: false,
      x: nx,
      y: ny,
      w: m.w,
      h: m.h,
      hasNote: noteVisible(node.note),
    });

    if (!ch.length) return m.h + SIBLING_GAP;

    if (hasFixedPos(node)) {
      var y2 = ny + m.h + SIBLING_GAP;
      for (var j = 0; j < ch.length; j++) {
        if (!hasFixedPos(ch[j])) {
          var subH2 = layoutAssign(ch[j], depth + 1, y2, out, originX);
          y2 += subH2;
        }
      }
      return Math.max(consumed, y2 - ny, m.h + SIBLING_GAP);
    }

    return Math.max(consumed, m.h + SIBLING_GAP);
  }

  function layoutHubSubtree(root, startY, out) {
    var consumed = layoutAssign(root, 0, startY, out, PAD);
    var laid = nodeLayoutById(out.nodes, root.id);
    if (laid) laid.isHub = true;
    var maxY = startY + consumed;
    out.nodes.forEach(function (n) {
      maxY = Math.max(maxY, n.y + n.h + PAD);
    });
    return maxY;
  }

  function buildEdgesFromTree(node, nodesById, edges) {
    var parent = nodesById[node.id];
    if (!parent) return;
    (node.children || []).forEach(function (ch) {
      var child = nodesById[ch.id];
      if (child) {
        edges.push({
          x1: parent.x + parent.w,
          y1: parent.y + parent.h / 2,
          x2: child.x,
          y2: child.y + child.h / 2,
        });
      }
      buildEdgesFromTree(ch, nodesById, edges);
    });
  }

  function computeLayout(pageData) {
    var data = normalizePageData(pageData);
    var out = { nodes: [], edges: [], nodeCount: 0 };
    var y = PAD;
    data.roots.forEach(function (root, idx) {
      if (idx > 0 && !hasFixedPos(root)) y += ROOT_GAP;
      y = layoutHubSubtree(root, y, out);
    });
    var nodesById = {};
    var maxX = PAD;
    var maxY = PAD;
    out.nodes.forEach(function (n) {
      nodesById[n.id] = n;
      maxX = Math.max(maxX, n.x + n.w + PAD);
      maxY = Math.max(maxY, n.y + n.h + PAD);
      out.nodeCount++;
    });
    data.roots.forEach(function (r) {
      buildEdgesFromTree(r, nodesById, out.edges);
    });
    out.width = Math.max(280, Math.ceil(maxX));
    out.height = Math.max(200, Math.ceil(maxY));
    return out;
  }

  function addHub(pageData) {
    var data = normalizePageData(pageData);
    if (data.roots.length >= 8) return false;
    var hub = defaultHub("总节点 " + (data.roots.length + 1));
    var last = data.roots[data.roots.length - 1];
    hub.fy = last && last.fy != null ? last.fy + 120 : PAD + data.roots.length * 100;
    hub.fx = PAD;
    data.roots.push(hub);
    return true;
  }

  function removeHub(pageData, hubId) {
    var data = normalizePageData(pageData);
    if (data.roots.length <= 1) return false;
    var idx = -1;
    for (var i = 0; i < data.roots.length; i++) {
      if (String(data.roots[i].id) === String(hubId)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;
    data.roots.splice(idx, 1);
    return true;
  }

  function addChild(pageData, parentId) {
    var data = normalizePageData(pageData);
    var parent = findNodeInForest(data.roots, parentId);
    if (!parent) return false;
    if (!parent.children) parent.children = [];
    if (parent.children.length >= 24) return false;
    parent.children.push({
      id: newNodeId(),
      label: "新分支",
      note: "",
      fx: null,
      fy: null,
      children: [],
    });
    return true;
  }

  function removeChild(pageData, parentId, childId) {
    var data = normalizePageData(pageData);
    if (isHubNode(data.roots, childId)) return removeHub(pageData, childId);
    var parent = findNodeInForest(data.roots, parentId);
    if (!parent || !parent.children || !parent.children.length) return false;
    var idx = -1;
    for (var i = 0; i < parent.children.length; i++) {
      if (String(parent.children[i].id) === String(childId)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) parent.children.pop();
    else parent.children.splice(idx, 1);
    return true;
  }

  function setNodePosition(pageData, nodeId, x, y) {
    var n = findNodeInForest(normalizePageData(pageData).roots, nodeId);
    if (!n) return false;
    n.fx = Math.round(x);
    n.fy = Math.round(y);
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
      var hub = n.isHub ? " mindmap-node--hub" : "";
      html +=
        '<div class="mindmap-node' +
        hub +
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
        '<span class="mindmap-node__grip" aria-hidden="true" title="拖拽移动"></span>' +
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

  function applyViewportTransform(viewport, stage, layout, zoom) {
    if (!viewport || !stage) return;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    if (vw < 40 || vh < 40) return;
    var cw = layout.width;
    var ch = layout.height;
    var pad = 16;
    var fit = Math.min((vw - pad) / cw, (vh - pad) / ch);
    if (layout.nodeCount <= 5) {
      fit = Math.min(Math.max(fit, 0.85), 1.75);
    } else if (layout.nodeCount <= 9) {
      fit = Math.min(Math.max(fit, 0.7), 1.35);
    } else {
      fit = Math.min(fit, 1.15);
    }
    var z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || 1));
    var total = fit * z;
    stage.dataset.fitScale = String(fit);
    stage.dataset.userZoom = String(z);
    stage.style.width = cw + "px";
    stage.style.height = ch + "px";
    stage.style.transform = "scale(" + total + ")";
    var offsetX = Math.max(0, (vw - cw * total) / 2);
    var offsetY = Math.max(0, (vh - ch * total) / 2);
    stage.style.marginLeft = offsetX + "px";
    stage.style.marginTop = offsetY + "px";
  }

  function $allNodesIn(root) {
    return Array.prototype.slice.call(
      root.querySelectorAll(".mindmap-node[data-node-id]")
    );
  }

  function pointerScaleForElement(el) {
    var scale = 1;
    var node = el;
    while (node && node !== document.documentElement) {
      var tr = window.getComputedStyle(node).transform;
      if (tr && tr !== "none") {
        var m = tr.match(/matrix\(([^)]+)\)/);
        if (m) {
          var parts = m[1].split(",").map(function (v) {
            return parseFloat(String(v).trim());
          });
          if (parts[0] && !isNaN(parts[0])) scale *= parts[0];
        }
      }
      node = node.parentElement;
    }
    return scale > 0 ? scale : 1;
  }

  function repaintEdgesFromDom(section, pageData) {
    var canvas = section.querySelector("[data-mindmap-canvas]");
    if (!canvas) return;
    var data = normalizePageData(pageData);
    var nodesById = {};
    $allNodesIn(section).forEach(function (el) {
      var id = el.getAttribute("data-node-id");
      if (!id) return;
      nodesById[id] = {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
    });
    var edges = [];
    function walk(node) {
      var p = nodesById[node.id];
      if (!p) return;
      (node.children || []).forEach(function (ch) {
        var c = nodesById[ch.id];
        if (c) {
          edges.push({
            x1: p.x + p.w,
            y1: p.y + p.h / 2,
            x2: c.x,
            y2: c.y + c.h / 2,
          });
        }
        walk(ch);
      });
    }
    data.roots.forEach(walk);
    var svg = canvas.querySelector(".mindmap-edges");
    if (svg) svg.outerHTML = renderEdgesSvg(edges);
  }

  function collectPageFromDom(section, pageData) {
    var data = normalizePageData(pageData);
    var byId = {};
    forEachNode(data.roots, function (n) {
      byId[n.id] = n;
    });

    $allNodesIn(section).forEach(function (el) {
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
      byId[id].fx = parseFloat(el.style.left) || 0;
      byId[id].fy = parseFloat(el.style.top) || 0;
    });

    var zr = section.querySelector("[data-mindmap-zoom-range]");
    if (zr) data.zoom = Number(zr.value) / 100;

    delete data.root;
    return data;
  }

  function getSelectedId(section) {
    var data = section.getAttribute("data-mindmap-selected");
    if (data) return data;
    var first = section.querySelector(".mindmap-node[data-node-id]");
    return first ? first.getAttribute("data-node-id") : "";
  }

  function setSelectedId(section, id) {
    section.setAttribute("data-mindmap-selected", id || "");
    $allNodesIn(section).forEach(function (el) {
      el.classList.toggle("is-selected", String(el.getAttribute("data-node-id")) === String(id));
    });
  }

  function bindViewportFit(viewport, stage, getLayoutAndZoom) {
    if (!viewport || viewport.dataset.mindmapFitBound === "1") return;
    viewport.dataset.mindmapFitBound = "1";
    var run = function () {
      var o = getLayoutAndZoom();
      if (o) applyViewportTransform(viewport, stage, o.layout, o.zoom);
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

  function bindNodeDrag(section, pageData, onMoved) {
    if (section.dataset.mindmapDragBound === "1") return;
    section.dataset.mindmapDragBound = "1";

    var drag = {
      active: false,
      nodeId: null,
      el: null,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      moved: false,
    };

    function editOn() {
      return document.body.classList.contains("deck--editing");
    }

    section.addEventListener("pointerdown", function (ev) {
      if (!editOn()) return;
      var t = ev.target;
      if (!(t instanceof Element)) return;
      var nodeEl = t.closest(".mindmap-node[data-node-id]");
      if (!nodeEl || !section.contains(nodeEl)) return;
      if (!t.closest(".mindmap-node__grip")) {
        if (t.closest('[data-field="label"], [data-field="note"]')) return;
      }
      drag.active = true;
      drag.nodeId = nodeEl.getAttribute("data-node-id");
      drag.el = nodeEl;
      drag.startX = ev.clientX;
      drag.startY = ev.clientY;
      drag.originX = parseFloat(nodeEl.style.left) || 0;
      drag.originY = parseFloat(nodeEl.style.top) || 0;
      drag.moved = false;
      nodeEl.classList.add("is-dragging");
      setSelectedId(section, drag.nodeId);
      if (nodeEl.setPointerCapture) nodeEl.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });

    section.addEventListener("pointermove", function (ev) {
      if (!drag.active || !drag.el) return;
      var dx = ev.clientX - drag.startX;
      var dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      var scale = pointerScaleForElement(drag.el);
      drag.el.style.left = drag.originX + dx / scale + "px";
      drag.el.style.top = drag.originY + dy / scale + "px";
      repaintEdgesFromDom(section, pageData);
      ev.preventDefault();
    });

    function endDrag(ev) {
      if (!drag.active) return;
      var el = drag.el;
      if (el) {
        el.classList.remove("is-dragging");
        if (drag.moved) {
          setNodePosition(
            pageData,
            drag.nodeId,
            parseFloat(el.style.left) || 0,
            parseFloat(el.style.top) || 0
          );
          if (typeof onMoved === "function") onMoved();
        }
        if (ev && ev.pointerId != null && el.releasePointerCapture) {
          try {
            el.releasePointerCapture(ev.pointerId);
          } catch (e2) {}
        }
      }
      drag.active = false;
      drag.el = null;
    }

    section.addEventListener("pointerup", endDrag);
    section.addEventListener("pointercancel", endDrag);
  }

  function renderZoomControls(pageId, zoom) {
    var pct = Math.round((Number(zoom) || 1) * 100);
    return (
      '<div class="mindmap-zoom" aria-label="整体缩放">' +
      '<button type="button" class="btn btn--ghost mindmap-zoom__btn" data-mindmap-page="' +
      escapeHtmlAttr(pageId) +
      '" data-mindmap-action="zoom-out" title="缩小">−</button>' +
      '<input type="range" class="mindmap-zoom__range" min="35" max="250" value="' +
      pct +
      '" data-mindmap-zoom-range aria-label="缩放比例" />' +
      '<span class="mindmap-zoom__pct" data-mindmap-zoom-label>' +
      pct +
      "%</span>" +
      '<button type="button" class="btn btn--ghost mindmap-zoom__btn" data-mindmap-page="' +
      escapeHtmlAttr(pageId) +
      '" data-mindmap-action="zoom-in" title="放大">+</button>' +
      '<button type="button" class="btn btn--ghost mindmap-zoom__btn" data-mindmap-action="zoom-reset" data-mindmap-page="' +
      escapeHtmlAttr(pageId) +
      '" title="重置缩放">100%</button>' +
      "</div>"
    );
  }

  window.MindmapDeck = {
    defaultPageData: defaultPageData,
    normalizePageData: normalizePageData,
    computeLayout: computeLayout,
    findNodeInForest: findNodeInForest,
    findParentInForest: findParentInForest,
    isHubNode: isHubNode,
    addHub: addHub,
    removeHub: removeHub,
    addChild: addChild,
    removeChild: removeChild,
    setNodePosition: setNodePosition,
    renderEdgesSvg: renderEdgesSvg,
    renderNodesHtml: renderNodesHtml,
    applyViewportTransform: applyViewportTransform,
    collectPageFromDom: collectPageFromDom,
    getSelectedId: getSelectedId,
    setSelectedId: setSelectedId,
    bindViewportFit: bindViewportFit,
    bindNodeDrag: bindNodeDrag,
    repaintEdgesFromDom: repaintEdgesFromDom,
    pointerScaleForElement: pointerScaleForElement,
    renderZoomControls: renderZoomControls,
    newNodeId: newNodeId,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
  };
})();
