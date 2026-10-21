/* Shared helpers. SECURITY: DOM is built only with createElement / textContent /
 * setAttribute. Nothing in this GUI ever assigns innerHTML with data. */
window.App = window.App || {};
(function (A) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";

  A.$ = (id) => document.getElementById(id);

  /** HTML element; `text` goes through textContent. */
  A.el = function (tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  /** SVG element with attributes (+ optional textContent). */
  A.svg = function (tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  /** Make GSAP scale/rotate an SVG group about its bbox centre (its default is the bbox top-left). */
  A.pivot = function (el) { gsap.set(el, { transformOrigin: "50% 50%" }); return el; };

  A.g = function (parent, attrs) {
    const n = A.svg("g", attrs);
    if (parent) parent.appendChild(n);
    return n;
  };

  A.fmt = function (n, d) {
    if (typeof n !== "number" || !isFinite(n)) return String(n);
    return String(+n.toFixed(d === undefined ? 1 : d));
  };
  A.pct = (x, d) => (x * 100).toFixed(d === undefined ? 0 : d) + "%";

  // ------------------------------------------------------------ colour tokens (mirror DESIGN.md 2.x)
  A.C = {
    ink: "#16202D", ink2: "#44505F", ink3: "#5F6B7A", line: "#D3D9E0", grid: "#E9EDF2",
    gate: "#334155", coin: "#F2B705", coinEdge: "#8A6100", pot: "#FFF8E1", potEdge: "#C99A12",
    shield: "#1D4ED8", shieldFill: "#DCE6FB", pass: "#17744F", block: "#5B34B8",
    token: "#D92D20", edge: "#8A94A3", edgeHot: "#B42318", website: "#2B2F36",
    barNone: "#B42318", barEqual: "#B45309", barRisk: "#17744F", wave: "#B42318",
    st: {
      idle:        { fill: "#EEF1F5", stroke: "#7A8594", word: "Idle" },
      active:      { fill: "#E0F3F7", stroke: "#0E7490", word: "Working" },
      clean:       { fill: "#E2F4EA", stroke: "#17744F", word: "Safe" },
      compromised: { fill: "#FBE4E4", stroke: "#B42318", word: "Compromised" },
      blocked:     { fill: "#EDE7FA", stroke: "#5B34B8", word: "Blocked" },
      entry:       { fill: "#FDEBDB", stroke: "#B45309", word: "Exposed" },
      critical:    { fill: "#FFF3C4", stroke: "#8A5A00", word: "Critical" },
      error:       { fill: "#FDEBDB", stroke: "#B45309", word: "Error" },
    },
    bags: ["#E8F1FB", "#EAF6EE", "#FFF4DE", "#F4EAF8", "#E3F4F2", "#FDEBE0", "#EEF0FA", "#F3F1E4"],
  };

  // ------------------------------------------------------------ text measuring
  const cv = document.createElement("canvas").getContext("2d");
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif';
  A.textW = function (str, size, weight, mono) {
    cv.font = (weight || 600) + " " + size + "px " + (mono ? "ui-monospace,Menlo,Consolas,'DejaVu Sans Mono',monospace" : FONT);
    return cv.measureText(String(str)).width;
  };
  /** Shrink font (never below `min`) so `str` fits `maxW`; compress glyphs as a last resort. */
  A.fitText = function (textEl, str, maxW, size, min, weight) {
    let fs = size;
    const w = A.textW(str, fs, weight);
    if (w > maxW) fs = Math.max(min, Math.floor(fs * maxW / w));
    textEl.setAttribute("font-size", fs);
    if (A.textW(str, fs, weight) > maxW) {
      textEl.setAttribute("textLength", maxW);
      textEl.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
  };

  // ------------------------------------------------------------ icons (24x24 grid, 2u strokes)
  const ST = { fill: "none", stroke: A.C.ink, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
  const ICONS = {
    recon: (g, s) => { g.append(A.svg("circle", { ...s, cx: 10, cy: 10, r: 6 }), A.svg("line", { ...s, x1: 15, y1: 15, x2: 21, y2: 21 })); },
    globe: (g, s) => { g.append(A.svg("circle", { ...s, cx: 12, cy: 12, r: 9 }), A.svg("ellipse", { ...s, cx: 12, cy: 12, rx: 4, ry: 9 }), A.svg("line", { ...s, x1: 3, y1: 12, x2: 21, y2: 12 })); },
    net: (g, s) => {
      g.append(A.svg("polyline", { ...s, points: "4,18 12,5 20,18 4,18" }));
      for (const [x, y] of [[4, 18], [12, 5], [20, 18]]) g.append(A.svg("circle", { ...s, fill: s.stroke, cx: x, cy: y, r: 2.2 }));
    },
    bars: (g, s) => { for (const [x, y, h] of [[3, 15, 6], [10, 9, 12], [17, 3, 18]]) g.append(A.svg("rect", { ...s, x, y, width: 4, height: h })); },
    bolt: (g, s) => { g.append(A.svg("polygon", { ...s, points: "13,2 5,13 11,13 9,22 19,9 13,9" })); },
    hub: (g, s) => {
      g.append(A.svg("circle", { ...s, cx: 12, cy: 12, r: 3 }));
      for (const [x, y] of [[4, 4], [20, 4], [4, 20], [20, 20]]) {
        g.append(A.svg("line", { ...s, x1: 12, y1: 12, x2: x, y2: y }), A.svg("circle", { ...s, fill: "#fff", cx: x, cy: y, r: 2 }));
      }
    },
    page: (g, s) => {
      g.append(A.svg("rect", { ...s, x: 5, y: 3, width: 14, height: 18, rx: 2 }));
      for (const [x2, y] of [[16, 9], [16, 13], [13, 17]]) g.append(A.svg("line", { ...s, x1: 8, y1: y, x2, y2: y }));
    },
    check: (g, s) => { g.append(A.svg("path", { ...s, d: "M5 12.5l4.5 4.5L19 7" })); },
    x: (g, s) => { g.append(A.svg("path", { ...s, d: "M6 6l12 12M18 6L6 18" })); },
    lock: (g, s) => { g.append(A.svg("rect", { ...s, x: 5, y: 11, width: 14, height: 10, rx: 2 }), A.svg("path", { ...s, d: "M8 11V7a4 4 0 0 1 7.5-2" })); },
    arrowIn: (g, s) => { g.append(A.svg("path", { ...s, d: "M3 12h13M11 6l6 6-6 6M20 4v16" })); },
    bug: (g, s) => { g.append(A.svg("ellipse", { ...s, cx: 12, cy: 14, rx: 5, ry: 6 }), A.svg("path", { ...s, d: "M9 8a3 3 0 0 1 6 0M4 12h3M17 12h3M5 19l3-2M19 19l-3-2M12 14v5" })); },
  };

  /** Icon `kind` centred at (cx,cy) with box `size`. `color` overrides the stroke. */
  A.icon = function (parent, kind, cx, cy, size, color) {
    const k = size / 24;
    const g = A.svg("g", { transform: `translate(${cx - size / 2},${cy - size / 2}) scale(${k})` });
    const s = { ...ST, "stroke-width": Math.max(2, 2 / k * 0.9), stroke: color || A.C.ink };
    (ICONS[kind] || ICONS.net)(g, s);
    if (parent) parent.appendChild(g);
    return g;
  };

  /** Pick a role icon: known pentest ids first, then capability heuristics. */
  A.roleIcon = function (n) {
    const id = n.id;
    const byId = { recon: "recon", scan_web: "globe", scan_net: "net", analysis: "bars", exploit: "bolt", orchestrator: "hub", reporter: "page" };
    if (byId[id]) return byId[id];
    const caps = n.caps || [];
    if (n.critical) return "hub";
    if (caps.includes("shell")) return "bolt";
    if (n.entry && /web|sandbox|browser|http/i.test(id)) return "globe";
    if (n.entry) return "recon";
    if (caps.includes("file_write") || /analy|aggreg|knowledge|repo/i.test(id)) return "bars";
    if (!caps.length) return "page";
    return "net";
  };

  A.SHIELD_D = "M0,-26 L22,-18 V4 C22,16 10,24 0,28 C-10,24 -22,16 -22,4 V-18 Z";
  A.STAR_PTS = (r) => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r;
      pts.push((Math.cos(a) * rr).toFixed(2) + "," + (Math.sin(a) * rr).toFixed(2));
    }
    return pts.join(" ");
  };

  /** Shared <defs>: hatch/dot patterns, arrowheads, token shadow-free. */
  A.buildDefs = function (svg) {
    const defs = A.svg("defs");
    const pat = (id, build, w) => {
      const p = A.svg("pattern", { id, patternUnits: "userSpaceOnUse", width: w || 6, height: w || 6, patternTransform: "rotate(45)" });
      build(p); defs.appendChild(p);
    };
    pat("hatch-red", (p) => p.appendChild(A.svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#B42318", "stroke-opacity": 0.3, "stroke-width": 1.5 })));
    pat("hatch-solid-red", (p) => p.appendChild(A.svg("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#fff", "stroke-opacity": 0.45, "stroke-width": 2 })));
    pat("dots-amber", (p) => p.appendChild(A.svg("circle", { cx: 3, cy: 3, r: 1.6, fill: "#fff", "fill-opacity": 0.6 })), 7);
    const mk = (id, color) => {
      const m = A.svg("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 10, markerHeight: 10, markerUnits: "userSpaceOnUse", orient: "auto" });
      m.appendChild(A.svg("path", { d: "M0,0 L10,5 L0,10 z", fill: color }));
      defs.appendChild(m);
    };
    mk("ah", A.C.edge); mk("ah-hot", A.C.edgeHot); mk("ah-entry", A.C.st.entry.stroke); mk("ah-cut", A.C.block); mk("ah-solid", A.C.ink);
    const grad = A.svg("linearGradient", { id: "wipe-grad", x1: 0, x2: 1, y1: 0, y2: 0 });
    for (const [o, a] of [[0, 0], [0.5, 0.95], [1, 0]]) grad.appendChild(A.svg("stop", { offset: o, "stop-color": "#fff", "stop-opacity": a }));
    defs.appendChild(grad);
    const cg = A.svg("radialGradient", { id: "coin-grad", cx: 0.35, cy: 0.3, r: 0.8 });
    for (const [o, c] of [[0, "#FFD84D"], [1, "#F2B705"]]) cg.appendChild(A.svg("stop", { offset: o, "stop-color": c }));
    defs.appendChild(cg);
    svg.appendChild(defs);
  };

  // ------------------------------------------------------------ reduced motion / durations
  A.rm = () => !!(A.state && A.state.rm);
  /** Scale a nominal duration for reduced motion (0.2s cross-fade). */
  A.dur = (d) => (A.rm() ? 0.2 : d);

  A.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
})(window.App);
