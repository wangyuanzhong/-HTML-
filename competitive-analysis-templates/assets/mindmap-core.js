/**
 * mindmap-core.js — 树节点、小节点、箭头连线、视口内缩放
 */
(function () {
  "use strict";

  var LEVEL_GAP = 96;
  var SIBLING_GAP = 18;
  var ROOT_GAP = 36;
  var PAD = 16;
  var NODE_MIN_W = 96;
  var NODE_MAX_W = 188;
  var SMALL_W = 76;
  var SMALL_H = 38;
  var LABEL_LINE_H = 24;
  var FIT_CAP = 0.92;
  var FIT_BOOST_SMALL = 0.92;
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 1.6;
  var ZOOM_DEFAULT = 1;
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

  function newLinkId() {
    return "l_" + String(Date.now()) + "_" + String(Math.floor(Math.random() * 1e4));
  }

  function defaultHub(label) {
    return {
      id: newNodeId(),
      label: label || "总节点",
      fx: null,
      fy: null,
      children: [],
    };
  }

  function defaultPageData() {
    var a = defaultHub("中心主题");
    a.children = [
      { id: newNodeId(), label: "分支一", fx: null, fy: null, children: [] },
      { id: newNodeId(), label: "分支二", fx: null, fy: null, children: [] },
    ];
    return {
      title: "思维导图",
      zoom: ZOOM_DEFAULT,
      roots: [a],
      smallNodes: [],
      links: [],
    };
  }

  function normalizeNode(node) {
    if (!node || typeof node !== "object") return defaultHub("节点");
    if (!node.id) node.id = newNodeId();
    if (node.label == null) node.label = "节点";
    delete node.note;
    if (node.fx != null && node.fx !== "") node.fx = Number(node.fx);
    else node.fx = null;
    if (node.fy != null && node.fy !== "") node.fy = Number(node.fy);
    else node.fy = null;
    if (!Array.isArray(node.children)) node.children = [];
    node.children.forEach(normalizeNode);
    return node;
  }

  function normalizeSmallNode(s) {
    if (!s || typeof s !== "object") return null;
    if (!s.id) s.id = newNodeId();
    if (s.label == null) s.label = "小节点";
    if (s.fx != null && s.fx !== "") s.fx = Number(s.fx);
    else s.fx = null;
    if (s.fy != null && s.fy !== "") s.fy = Number(s.fy);
    else s.fy = null;
    return s;
  }

  function normalizeLink(l) {
    if (!l || typeof l !== "object") return null;
    if (!l.id) l.id = newLinkId();
    if (!l.from || !l.to || String(l.from) === String(l.to)) return null;
    return { id: l.id, from: String(l.from), to: String(l.to) };
  }

  function normalizePageData(data) {
    data = data || {};
    if (!Array.isArray(data.roots) || !data.roots.length) {
      if (data.root) {
        data.roots = [normalizeNode(data.root)];
        delete data.root;
      } else {
        var d = defaultPageData();
        data.roots = d.roots;
        data.smallNodes = d.smallNodes;
        data.links = d.links;
      }
    }
    data.roots = data.roots.map(function (r) {
      return normalizeNode(r);
    });
    if (!Array.isArray(data.smallNodes)) data.smallNodes = [];
    data.smallNodes = data.smallNodes.map(normalizeSmallNode).filter(Boolean);
    if (!Array.isArray(data.links)) data.links = [];
    delete data.callouts;
    var ids = {};
    collectAllIds(data, ids);
    data.links = data.links.map(normalizeLink).filter(function (l) {
      return l && ids[l.from] && ids[l.to];
    });
    if (data.zoom == null || isNaN(Number(data.zoom))) data.zoom = ZOOM_DEFAULT;
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

  function collectAllIds(data, out) {
    forEachNode(data.roots, function (n) {
      out[n.id] = true;
    });
    (data.smallNodes || []).forEach(function (s) {
      out[s.id] = true;
    });
  }

  function findNodeInForest(roots, id) {
    var hit = null;
    forEachNode(roots, function (n) {
      if (!hit && String(n.id) === String(id)) hit = n;
    });
    return hit;
  }

  function findSmallNode(data, id) {
    for (var i = 0; i < (data.smallNodes || []).length; i++) {
      if (String(data.smallNodes[i].id) === String(id)) return data.smallNodes[i];
    }
    return null;
  }

  function isSmallNodeId(data, id) {
    return !!findSmallNode(data, id);
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

  function pruneLinksForNode(data, nodeId) {
    var sid = String(nodeId);
    data.links = (data.links || []).filter(function (l) {
      return String(l.from) !== sid && String(l.to) !== sid;
    });
  }

  function estimateLabelWidth(text, compact) {
    var t = String(text || "").trim() || "节点";
    var len = 0;
    for (var i = 0; i < t.length; i++) {
      len += t.charCodeAt(i) > 255 ? 1.7 : 1;
    }
    var minW = compact ? SMALL_W : NODE_MIN_W;
    var maxW = compact ? SMALL_W + 8 : NODE_MAX_W;
    return Math.min(maxW, Math.max(minW, Math.ceil(len * (compact ? 7 : 9) + (compact ? 14 : 22))));
  }

  function measureNode(node, compact) {
    var w = estimateLabelWidth(node.label, compact);
    var h = (compact ? SMALL_H : LABEL_LINE_H + 12);
    return { w: w, h: h };
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
    var m = measureNode(node, false);
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
      kind: "tree",
      depth: depth,
      isHub: false,
      x: nx,
      y: ny,
      w: m.w,
      h: m.h,
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

  function buildTreeEdgesFromTree(node, nodesById, edges) {
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
          kind: "tree",
        });
      }
      buildTreeEdgesFromTree(ch, nodesById, edges);
    });
  }

  function boxCenter(b) {
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  /** 从节点框朝向目标取边界锚点 */
  function anchorOnBox(box, toward) {
    var cx = box.x + box.w / 2;
    var cy = box.y + box.h / 2;
    var tx = toward.x;
    var ty = toward.y;
    var dx = tx - cx;
    var dy = ty - cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: dx > 0 ? box.x + box.w : box.x, y: cy };
    }
    return { x: cx, y: dy > 0 ? box.y + box.h : box.y };
  }

  /** 正交折线 + 圆角感贝塞尔，箭头指向 to */
  function optimizedLinkPath(fromBox, toBox) {
    var tc = boxCenter(toBox);
    var fc = boxCenter(fromBox);
    var p1 = anchorOnBox(fromBox, tc);
    var p2 = anchorOnBox(toBox, fc);
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      return "M" + p1.x + " " + p1.y + " L" + p2.x + " " + p2.y;
    }
    if (Math.abs(dx) >= Math.abs(dy)) {
      var mx = p1.x + dx * 0.5;
      return (
        "M" +
        p1.x +
        " " +
        p1.y +
        " C" +
        mx +
        " " +
        p1.y +
        ", " +
        mx +
        " " +
        p2.y +
        ", " +
        p2.x +
        " " +
        p2.y
      );
    }
    var my = p1.y + dy * 0.5;
    return (
      "M" +
      p1.x +
      " " +
      p1.y +
      " C" +
      p1.x +
      " " +
      my +
      ", " +
      p2.x +
      " " +
      my +
      ", " +
      p2.x +
      " " +
      p2.y
    );
  }

  function computeLayout(pageData) {
    var data = normalizePageData(pageData);
    var out = { nodes: [], treeEdges: [], linkEdges: [], nodeCount: 0 };
    var y = PAD;
    data.roots.forEach(function (root, idx) {
      if (idx > 0 && !hasFixedPos(root)) y += ROOT_GAP;
      y = layoutHubSubtree(root, y, out);
    });

    (data.smallNodes || []).forEach(function (sn, idx) {
      var m = measureNode(sn, true);
      var lx = sn.fx != null && !isNaN(sn.fx) ? sn.fx : PAD + LEVEL_GAP * 2 + 40 + idx * 12;
      var ly = sn.fy != null && !isNaN(sn.fy) ? sn.fy : PAD + 80 + idx * (SMALL_H + 10);
      out.nodes.push({
        id: sn.id,
        label: sn.label,
        kind: "small",
        isHub: false,
        x: lx,
        y: ly,
        w: m.w,
        h: m.h,
      });
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
      buildTreeEdgesFromTree(r, nodesById, out.treeEdges);
    });

    (data.links || []).forEach(function (lnk) {
      var a = nodesById[lnk.from];
      var b = nodesById[lnk.to];
      if (!a || !b) return;
      out.linkEdges.push({
        d: optimizedLinkPath(a, b),
        from: lnk.from,
        to: lnk.to,
      });
    });

    out.width = Math.max(200, Math.ceil(maxX));
    out.height = Math.max(160, Math.ceil(maxY));
    return out;
  }

  function addHub(pageData) {
    var data = normalizePageData(pageData);
    if (data.roots.length >= 8) return false;
    var hub = defaultHub("总节点 " + (data.roots.length + 1));
    var last = data.roots[data.roots.length - 1];
    hub.fy = last && last.fy != null ? last.fy + 72 : PAD + data.roots.length * 56;
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
    pruneLinksForNode(data, hubId);
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
    pruneLinksForNode(data, childId);
    return true;
  }

  function addSmallNode(pageData, nearId) {
    var data = normalizePageData(pageData);
    if (data.smallNodes.length >= 48) return false;
    var layout = computeLayout(data);
    var nodesById = {};
    layout.nodes.forEach(function (n) {
      nodesById[n.id] = n;
    });
    var near = nearId ? nodesById[nearId] : null;
    var fx = near ? near.x + near.w + 20 : PAD + LEVEL_GAP + 20;
    var fy = near ? near.y + near.h + 8 : PAD + 60;
    data.smallNodes.push({
      id: newNodeId(),
      label: "小节点",
      fx: fx,
      fy: fy,
    });
    return true;
  }

  function removeSmallNode(pageData, smallId) {
    var data = normalizePageData(pageData);
    var idx = -1;
    for (var i = 0; i < data.smallNodes.length; i++) {
      if (String(data.smallNodes[i].id) === String(smallId)) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;
    pruneLinksForNode(data, smallId);
    data.smallNodes.splice(idx, 1);
    return true;
  }

  function addLink(pageData, fromId, toId) {
    var data = normalizePageData(pageData);
    if (!fromId || !toId || String(fromId) === String(toId)) return false;
    for (var i = 0; i < data.links.length; i++) {
      var l = data.links[i];
      if (
        (String(l.from) === String(fromId) && String(l.to) === String(toId)) ||
        (String(l.from) === String(toId) && String(l.to) === String(fromId))
      ) {
        return false;
      }
    }
    data.links.push({ id: newLinkId(), from: String(fromId), to: String(toId) });
    return true;
  }

  function removeLink(pageData, linkIdOrFrom, toId) {
    var data = normalizePageData(pageData);
    if (toId != null) {
      data.links = data.links.filter(function (l) {
        return !(
          (String(l.from) === String(linkIdOrFrom) && String(l.to) === String(toId)) ||
          (String(l.from) === String(toId) && String(l.to) === String(linkIdOrFrom))
        );
      });
      return true;
    }
    var before = data.links.length;
    data.links = data.links.filter(function (l) {
      return String(l.id) !== String(linkIdOrFrom);
    });
    return data.links.length < before;
  }

  function removeLinkForSelection(pageData, sel) {
    var data = normalizePageData(pageData);
    for (var i = data.links.length - 1; i >= 0; i--) {
      var l = data.links[i];
      if (String(l.from) === String(sel) || String(l.to) === String(sel)) {
        data.links.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /** 删除当前选中项：小节点 / 总节点 / 分支 / 与选中相关的连线 */
  function removeSelection(pageData, selId) {
    var data = normalizePageData(pageData);
    var sel = selId == null ? "" : String(selId);
    if (!sel) return false;

    if (isSmallNodeId(data, sel)) {
      return removeSmallNode(data, sel);
    }

    if (isHubNode(data.roots, sel)) {
      if (data.roots.length <= 1) return false;
      return removeHub(data, sel);
    }

    var selNode = findNodeInForest(data.roots, sel);
    if (selNode) {
      var par = findParentInForest(data.roots, sel);
      if (par) return removeChild(data, par.id, sel);
      return false;
    }

    return removeLinkForSelection(data, sel);
  }

  function setNodePosition(pageData, nodeId, x, y, kind) {
    var data = normalizePageData(pageData);
    if (kind === "small" || isSmallNodeId(data, nodeId)) {
      var s = findSmallNode(data, nodeId);
      if (!s) return false;
      s.fx = Math.round(x);
      s.fy = Math.round(y);
      return true;
    }
    var n = findNodeInForest(data.roots, nodeId);
    if (!n) return false;
    n.fx = Math.round(x);
    n.fy = Math.round(y);
    return true;
  }

  function renderEdgesSvg(treeEdges, linkEdges) {
    var paths = "";
    (treeEdges || []).forEach(function (e) {
      var mx = (e.x1 + e.x2) / 2;
      var d =
        "M" +
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
        e.y2;
      paths += '<path class="mindmap-edge mindmap-edge--tree" d="' + d + '"/>';
    });
    (linkEdges || []).forEach(function (e) {
      paths +=
        '<path class="mindmap-edge mindmap-edge--link" marker-end="url(#mindmap-arrowhead)" d="' +
        e.d +
        '"/>';
    });
    return (
      '<svg class="mindmap-edges" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><marker id="mindmap-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
      '<path d="M0,0 L10,5 L0,10 Z" fill="context-stroke"/></marker></defs>' +
      paths +
      "</svg>"
    );
  }

  function renderNodesHtml(nodes, selectedId) {
    var html = '<div class="mindmap-nodes" role="tree">';
    nodes.forEach(function (n) {
      var sel = selectedId && String(selectedId) === String(n.id) ? " is-selected" : "";
      var hub = n.isHub ? " mindmap-node--hub" : "";
      var small = n.kind === "small" ? " mindmap-node--small" : "";
      html +=
        '<div class="mindmap-node' +
        hub +
        small +
        sel +
        '" role="treeitem" data-node-id="' +
        escapeHtmlAttr(n.id) +
        '" data-node-kind="' +
        escapeHtmlAttr(n.kind || "tree") +
        '" style="left:' +
        n.x +
        "px;top:" +
        n.y +
        "px;width:" +
        n.w +
        "px" +
        (n.kind === "small" ? ";height:" + n.h + "px" : "") +
        '" tabindex="0">' +
        '<span class="mindmap-node__grip" aria-hidden="true" title="拖拽移动"></span>' +
        '<div class="mindmap-node__label" data-field="label">' +
        escapeHtml(n.label || "") +
        "</div></div>";
    });
    html += "</div>";
    return html;
  }

  function applyViewportTransform(viewport, scaler, stage, layout, zoom) {
    if (!viewport || !scaler || !stage) return;
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    if (vw < 40 || vh < 40) return;
    var cw = layout.width;
    var ch = layout.height;
    var fit = Math.min((vw - 16) / cw, (vh - 16) / ch);
    if (layout.nodeCount <= 8) {
      fit = Math.min(fit, FIT_BOOST_SMALL);
    } else {
      fit = Math.min(fit, FIT_CAP);
    }
    var z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || ZOOM_DEFAULT));
    var total = fit * z;
    scaler.dataset.fitScale = String(fit);
    scaler.dataset.userZoom = String(z);
    stage.style.width = cw + "px";
    stage.style.height = ch + "px";
    scaler.style.width = cw + "px";
    scaler.style.height = ch + "px";
    scaler.style.position = "absolute";
    scaler.style.left = "50%";
    scaler.style.top = "50%";
    scaler.style.margin = "0";
    scaler.style.transform = "translate(-50%, -50%) scale(" + total + ")";
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

  function domBoxesById(section) {
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
    return nodesById;
  }

  function repaintEdgesFromDom(section, pageData) {
    var canvas = section.querySelector("[data-mindmap-canvas]");
    if (!canvas) return;
    var data = normalizePageData(pageData);
    var nodesById = domBoxesById(section);
    var treeEdges = [];
    function walk(node) {
      var p = nodesById[node.id];
      if (!p) return;
      (node.children || []).forEach(function (ch) {
        var c = nodesById[ch.id];
        if (c) {
          treeEdges.push({
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
    var linkEdges = [];
    (data.links || []).forEach(function (lnk) {
      var a = nodesById[lnk.from];
      var b = nodesById[lnk.to];
      if (!a || !b) return;
      linkEdges.push({ d: optimizedLinkPath(a, b) });
    });
    var svg = canvas.querySelector(".mindmap-edges");
    if (svg) svg.outerHTML = renderEdgesSvg(treeEdges, linkEdges);
  }

  function collectPageFromDom(section, pageData) {
    var data = normalizePageData(pageData);
    var byId = {};
    forEachNode(data.roots, function (n) {
      byId[n.id] = n;
    });
    var smallById = {};
    (data.smallNodes || []).forEach(function (s) {
      smallById[s.id] = s;
    });

    $allNodesIn(section).forEach(function (el) {
      var id = el.getAttribute("data-node-id");
      var kind = el.getAttribute("data-node-kind") || "tree";
      var lab = el.querySelector('[data-field="label"]');
      var label = lab ? String(lab.innerText || "").trim() : "";
      if (kind === "small" && smallById[id]) {
        if (lab) smallById[id].label = label || "小节点";
        smallById[id].fx = parseFloat(el.style.left) || 0;
        smallById[id].fy = parseFloat(el.style.top) || 0;
      } else if (byId[id]) {
        if (lab) byId[id].label = label || "节点";
        byId[id].fx = parseFloat(el.style.left) || 0;
        byId[id].fy = parseFloat(el.style.top) || 0;
      }
    });

    var zr = section.querySelector("[data-mindmap-zoom-range]");
    if (zr) data.zoom = Number(zr.value) / 100;

    delete data.root;
    delete data.callouts;
    return data;
  }

  function getSelectedId(section) {
    return section.getAttribute("data-mindmap-selected") || "";
  }

  function setSelectedId(section, id) {
    section.setAttribute("data-mindmap-selected", id || "");
    $allNodesIn(section).forEach(function (el) {
      el.classList.toggle("is-selected", String(el.getAttribute("data-node-id")) === String(id));
    });
  }

  function getLinkPickFrom(section) {
    return section.getAttribute("data-mindmap-link-from") || "";
  }

  function setLinkPickFrom(section, id) {
    if (id) section.setAttribute("data-mindmap-link-from", id);
    else section.removeAttribute("data-mindmap-link-from");
    section.classList.toggle("mindmap--link-pick", !!id);
  }

  function bindViewportFit(viewport, scaler, stage, getLayoutAndZoom) {
    if (!viewport || viewport.dataset.mindmapFitBound === "1") return;
    viewport.dataset.mindmapFitBound = "1";
    var run = function () {
      var o = getLayoutAndZoom();
      if (o) applyViewportTransform(viewport, scaler, stage, o.layout, o.zoom);
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

  function bindNodeSelectionAndLink(section, pageData, onChanged) {
    if (section.dataset.mindmapSelectBound === "1") return;
    section.dataset.mindmapSelectBound = "1";
    section.addEventListener(
      "click",
      function (ev) {
        if (!document.body.classList.contains("deck--editing")) return;
        var t = ev.target;
        if (!(t instanceof Element)) return;
        if (t.closest("[data-mindmap-action], .mindmap-zoom")) return;
        var nodeEl = t.closest(".mindmap-node[data-node-id]");
        if (!nodeEl || !section.contains(nodeEl)) return;
        var nid = nodeEl.getAttribute("data-node-id");
        var pickFrom = getLinkPickFrom(section);
        if (pickFrom && pickFrom !== nid) {
          if (addLink(pageData, pickFrom, nid)) {
            setLinkPickFrom(section, "");
            setSelectedId(section, nid);
            if (typeof onChanged === "function") onChanged();
          }
          ev.stopPropagation();
          return;
        }
        setSelectedId(section, nid);
      },
      true
    );
  }

  function bindNodeDrag(section, pageData, onMoved) {
    if (section.dataset.mindmapDragBound === "1") return;
    section.dataset.mindmapDragBound = "1";

    var drag = {
      active: false,
      nodeId: null,
      kind: "tree",
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
      if (!t.closest(".mindmap-node__grip") && t.closest('[data-field="label"]')) return;
      drag.active = true;
      drag.nodeId = nodeEl.getAttribute("data-node-id");
      drag.kind = nodeEl.getAttribute("data-node-kind") || "tree";
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
            parseFloat(el.style.top) || 0,
            drag.kind
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

  function setZoomControlsEnabled(section, enabled) {
    var zr = section.querySelector("[data-mindmap-zoom-range]");
    if (zr) zr.disabled = !enabled;
    var root = section;
    Array.prototype.slice
      .call(
        root.querySelectorAll(
          '[data-mindmap-action="zoom-in"], [data-mindmap-action="zoom-out"], [data-mindmap-action="zoom-reset"]'
        )
      )
      .forEach(function (btn) {
        btn.disabled = !enabled;
      });
  }

  function renderZoomControls(pageId, zoom) {
    var pct = Math.round((Number(zoom) || ZOOM_DEFAULT) * 100);
    var minPct = Math.round(ZOOM_MIN * 100);
    var maxPct = Math.round(ZOOM_MAX * 100);
    return (
      '<div class="mindmap-zoom" aria-label="画布缩放" data-mindmap-zoom-bar>' +
      '<button type="button" class="btn btn--ghost mindmap-zoom__btn" data-mindmap-page="' +
      escapeHtmlAttr(pageId) +
      '" data-mindmap-action="zoom-out" title="缩小">−</button>' +
      '<input type="range" class="mindmap-zoom__range" min="' +
      minPct +
      '" max="' +
      maxPct +
      '" value="' +
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
      '" title="重置缩放">适配</button>' +
      "</div>"
    );
  }

  window.MindmapDeck = {
    defaultPageData: defaultPageData,
    normalizePageData: normalizePageData,
    computeLayout: computeLayout,
    findNodeInForest: findNodeInForest,
    findParentInForest: findParentInForest,
    findSmallNode: findSmallNode,
    isSmallNodeId: isSmallNodeId,
    isHubNode: isHubNode,
    addHub: addHub,
    removeHub: removeHub,
    addChild: addChild,
    removeChild: removeChild,
    addSmallNode: addSmallNode,
    removeSmallNode: removeSmallNode,
    addLink: addLink,
    removeLink: removeLink,
    removeLinkForSelection: removeLinkForSelection,
    removeSelection: removeSelection,
    setNodePosition: setNodePosition,
    renderEdgesSvg: renderEdgesSvg,
    renderNodesHtml: renderNodesHtml,
    applyViewportTransform: applyViewportTransform,
    collectPageFromDom: collectPageFromDom,
    getSelectedId: getSelectedId,
    setSelectedId: setSelectedId,
    getLinkPickFrom: getLinkPickFrom,
    setLinkPickFrom: setLinkPickFrom,
    bindViewportFit: bindViewportFit,
    bindNodeDrag: bindNodeDrag,
    bindNodeSelectionAndLink: bindNodeSelectionAndLink,
    repaintEdgesFromDom: repaintEdgesFromDom,
    pointerScaleForElement: pointerScaleForElement,
    renderZoomControls: renderZoomControls,
    setZoomControlsEnabled: setZoomControlsEnabled,
    newNodeId: newNodeId,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    ZOOM_DEFAULT: ZOOM_DEFAULT,
  };
})();
