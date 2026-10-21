/* Scene construction + the agent network (nodes, edges, hostile website, legend, chip tray)
 * and shared animation helpers (A.tw, A.fx). The scene is rebuilt whenever the plan changes. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, fmt } = A;
  const VB_W = 1600, VB_H = 640;
  const NW = 168, NH = 76;                       // base node size (DESIGN 1)

  // Fixed layered positions for the pentest7 team (DESIGN 1).
  const FIXED = {
    recon: [360, 130], scan_web: [360, 320], scan_net: [360, 510], analysis: [700, 320],
    exploit: [1000, 320], orchestrator: [1280, 230], reporter: [1500, 430],
  };
  const WEB_POS = [110, 320];

  /** gsap.to / tl.to / gsap.set depending on duration; the one tween helper everything uses. */
  A.tw = function (tl, el, vars, dur, at, ease) {
    if (!dur) { gsap.set(el, vars); return; }
    const o = Object.assign({ duration: dur, ease: ease || "power1.inOut" }, vars);
    if (tl) tl.to(el, o, at); else gsap.to(el, o);
  };

  /** Run a non-tweenable change now, or at position `at` of timeline `tl` (keeps attribute flips in sync with tweens). */
  A.when = function (tl, at, fn) { if (tl) tl.call(fn, null, at); else fn(); };

  // ------------------------------------------------------------------ layout
  function layoutNodes(plan) {
    const ids = plan.nodes.map((n) => n.id);
    if (ids.length === Object.keys(FIXED).length && ids.every((i) => FIXED[i])) {
      const o = {}; for (const i of ids) o[i] = { x: FIXED[i][0], y: FIXED[i][1] };
      return { pos: o, web: { x: WEB_POS[0], y: WEB_POS[1] } };
    }
    // Layered left-to-right from graph distance to the nearest entry agent.
    const entries = plan.nodes.filter((n) => n.entry).map((n) => n.id);
    const depth = {};
    const queue = entries.length ? [...entries] : [ids[0]];
    for (const e of queue) depth[e] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const e of plan.edges) if (e.from === u && depth[e.to] === undefined) { depth[e.to] = depth[u] + 1; queue.push(e.to); }
    }
    let maxD = Math.max(0, ...Object.values(depth));
    for (const i of ids) if (depth[i] === undefined) depth[i] = ++maxD;
    const L = maxD + 1;
    const layers = Array.from({ length: L }, () => []);
    for (const i of ids) layers[depth[i]].push(i);
    const pos = {};
    const x0 = 380, x1 = 1420;
    layers.forEach((layer, k) => {
      const x = L === 1 ? 800 : x0 + k * (x1 - x0) / (L - 1);
      // order by barycentre of already placed predecessors to limit crossings
      if (k > 0) {
        const bc = (id) => {
          const ps = plan.edges.filter((e) => e.to === id && pos[e.from]).map((e) => pos[e.from].y);
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 320;
        };
        layer.sort((a, b) => bc(a) - bc(b));
      }
      const gap = Math.min(190, 420 / layer.length);
      layer.forEach((id, i) => { pos[id] = { x, y: 320 + (i - (layer.length - 1) / 2) * gap }; });
    });
    const ey = entries.length ? entries.reduce((a, id) => a + pos[id].y, 0) / entries.length : 320;
    return { pos, web: { x: 110, y: ey } };
  }

  // ------------------------------------------------------------------ edge geometry
  const bez = (p0, c0, c1, p1, t) => {
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1]];
  };
  const boxOf = (o) => ({ x: o.x, y: o.y, hw: o.hw, hh: o.hh });

  /** Compute path string + midpoint for an edge between two boxes {x,y,hw,hh}. */
  function edgePath(a, b, others, off) {
    const gap = 7;
    const dx = b.x - a.x;
    let p0, p1, c0, c1;
    if (dx > a.hw + b.hw * 0.3 + 24) {                    // forward
      p0 = [a.x + a.hw, a.y + off]; p1 = [b.x - b.hw - gap, b.y + off];
      const k = (p1[0] - p0[0]) / 2;
      c0 = [p0[0] + k, p0[1]]; c1 = [p1[0] - k, p1[1]];
      const clear = (cc0, cc1) => {
        for (let i = 1; i < 28; i++) {
          const [x, y] = bez(p0, cc0, cc1, p1, i / 28);
          for (const o of others) if (Math.abs(x - o.x) < o.hw + 8 && Math.abs(y - o.y) < o.hh + 8) return false;
        }
        return true;
      };
      if (!clear(c0, c1)) {
        const my = (p0[1] + p1[1]) / 2;
        const blockers = others.filter((o) => o.x > a.x + 10 && o.x < b.x - 10);
        const sgn0 = blockers.length && blockers[0].y > my ? -1 : 1;
        outer: for (const mag of [50, 90, 130, 170, 210]) {
          for (const s of [sgn0, -sgn0]) {
            const n0 = [c0[0], c0[1] + s * mag], n1 = [c1[0], c1[1] + s * mag];
            if (clear(n0, n1)) { c0 = n0; c1 = n1; break outer; }
          }
        }
      }
    } else if (Math.abs(dx) < 70) {                       // same column: vertical hop
      const down = b.y > a.y;
      p0 = [a.x + off, a.y + (down ? a.hh : -a.hh)]; p1 = [b.x + off, b.y + (down ? -b.hh - gap : b.hh + gap)];
      c0 = [p0[0], p0[1] + (p1[1] - p0[1]) / 3]; c1 = [p1[0], p1[1] - (p1[1] - p0[1]) / 3];
    } else {                                              // backward: arc over the top
      p0 = [a.x + off * 2, a.y - a.hh]; p1 = [b.x + off * 2, b.y - b.hh - gap];
      const top = Math.min(p0[1], p1[1]) - 80;
      c0 = [p0[0], top]; c1 = [p1[0], top];
    }
    const f = (n) => n.toFixed(1);
    return {
      d: `M${f(p0[0])},${f(p0[1])} C${f(c0[0])},${f(c0[1])} ${f(c1[0])},${f(c1[1])} ${f(p1[0])},${f(p1[1])}`,
      mid: bez(p0, c0, c1, p1, 0.5), p0, p1,
    };
  }

  // ------------------------------------------------------------------ node view
  function sizeScale(sc, w) {
    const { wmin, wmax } = sc;
    if (!(wmax > wmin)) return 1;
    return 0.8 + 0.45 * (w - wmin) / (wmax - wmin);       // DESIGN: 0.8 .. 1.25
  }

  function makeNode(sc, n, p) {
    const root = mkG(sc.L.nodes, { class: "agent", role: "img" });
    const nv = { id: n.id, n, x: p.x, y: p.y, sc: 1, g: root, state: "idle", weight: n.weight, shown: n.weight };
    // invisible symmetric rect: keeps the group's bbox centred on (0,0) so scaling pivots on the node centre
    root.appendChild(svg("rect", { x: -140, y: -100, width: 280, height: 200, fill: "none", "pointer-events": "none" }));
    mkG(root).appendChild(svg("rect", { x: -83, y: -36, width: NW, height: NH, rx: 12, fill: "rgba(22,32,45,.14)" }));
    nv.ring2 = svg("rect", { x: -97, y: -51, width: 194, height: 102, rx: 22, fill: "none", stroke: C.block, "stroke-width": 2.5, opacity: 0 });
    nv.ring = svg("rect", { x: -90, y: -44, width: 180, height: 88, rx: 16, fill: "none", stroke: C.st.idle.stroke, "stroke-width": 3, opacity: 0 });
    nv.entryRing = svg("rect", { x: -92, y: -46, width: 184, height: 92, rx: 18, fill: "none", stroke: C.st.entry.stroke, "stroke-width": 3, "stroke-dasharray": "9 6", opacity: 0 });
    root.append(nv.ring2, nv.ring, nv.entryRing);
    nv.body = svg("rect", { x: -84, y: -38, width: NW, height: NH, rx: 12, fill: C.st.idle.fill, stroke: C.st.idle.stroke, "stroke-width": 2.5 });
    nv.hatch = svg("rect", { x: -84, y: -38, width: NW, height: NH, rx: 12, fill: "url(#hatch-red)", opacity: 0 });
    root.append(nv.body, nv.hatch);
    // content in node-local top-left coordinates
    const c = mkG(root, { transform: "translate(-84,-38)" });
    A.icon(c, A.roleIcon(n), 152, 28, 20);
    nv.word = svg("text", { x: 12, y: 31, "font-size": 18, "font-weight": 600, class: "sec", fill: C.st.idle.stroke }, "Idle");
    nv.label = svg("text", { x: 84, y: 62, "text-anchor": "middle", "font-weight": 600, fill: C.ink }, n.id);
    c.append(nv.word, nv.label);
    A.fitText(nv.label, n.id, 148, 22, 18, 600);

    // score badge (top-right)
    nv.score = mkG(root, { }); gsap.set(nv.score, { x: 84, y: -38, autoAlpha: 0 });
    nv.score.append(svg("circle", { r: 17, fill: C.ink, stroke: "#fff", "stroke-width": 2 }));
    nv.scoreTxt = svg("text", { y: 7, "text-anchor": "middle", "font-size": 20, "font-weight": 700, fill: "#fff", style: "font-variant-numeric:tabular-nums" }, fmt(n.weight));
    nv.score.appendChild(nv.scoreTxt);
    // critical star (top-left)
    nv.star = mkG(root); gsap.set(nv.star, { x: -84, y: -38, autoAlpha: 0 });
    nv.star.appendChild(svg("polygon", { points: A.STAR_PTS(14), fill: C.st.critical.fill, stroke: "#8A5A00", "stroke-width": 2.5, "stroke-linejoin": "round" }));
    // state badge (bottom-right): one glyph per state
    nv.badge = mkG(root); gsap.set(nv.badge, { x: 82, y: 36, scale: 0, autoAlpha: 0 });
    nv.badgeC = svg("circle", { r: 12, fill: C.pass, stroke: "#fff", "stroke-width": 2 });
    nv.badge.appendChild(nv.badgeC);
    nv.glyph = {};
    for (const k of ["check", "bug", "x"]) {
      const gg = mkG(nv.badge); gg.setAttribute("visibility", "hidden");
      A.icon(gg, k, 0, 0, 16, "#fff"); nv.glyph[k] = gg;
    }
    // guard shield (bottom-left) with count
    nv.shield = mkG(root); gsap.set(nv.shield, { x: -92, y: 34, scale: 0.8, autoAlpha: 0 });
    nv.shield.appendChild(svg("path", { d: A.SHIELD_D, fill: C.shieldFill, stroke: C.shield, "stroke-width": 3, "stroke-linejoin": "round" }));
    nv.shieldTxt = svg("text", { y: 8, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.shield }, "");
    nv.shield.appendChild(nv.shieldTxt);
    // entry tag ("EXPOSED") above
    nv.tag = mkG(root); gsap.set(nv.tag, { y: -58, autoAlpha: 0 });
    const tw0 = A.textW("EXPOSED", 18, 700);
    A.icon(nv.tag, "arrowIn", -tw0 / 2 - 14, -6, 20, C.st.entry.stroke);
    nv.tag.appendChild(svg("text", { x: 6, y: 0, "text-anchor": "middle", "font-size": 18, "font-weight": 700, fill: C.st.entry.stroke }, "EXPOSED"));
    // "has the passwords" label (step 3)
    nv.holds = mkG(root); gsap.set(nv.holds, { y: -58, autoAlpha: 0 });
    nv.holds.appendChild(svg("text", { "text-anchor": "middle", "font-size": 18, "font-weight": 700, fill: "#8A5A00" }, "has the passwords"));
    for (const e of [root, nv.score, nv.star, nv.badge, nv.shield, nv.tag, nv.holds]) A.pivot(e);
    return nv;
  }

  // ------------------------------------------------------------------ edges
  function edgeBoxes(sc) {
    const o = {};
    for (const id of sc.ids) { const nv = sc.nodes[id]; o[id] = { id, x: nv.x, y: nv.y, hw: 84 * nv.sc, hh: 38 * nv.sc }; }
    return o;
  }

  /** Recompute every edge path from current node geometry (call after scale/position changes). */
  function redrawEdges(sc) {
    const bx = edgeBoxes(sc);
    const all = Object.values(bx);
    for (const e of sc.edges) {
      const rev = sc.edges.some((r) => r.from === e.to && r.to === e.from);
      const off = rev ? (e.from < e.to ? -9 : 9) : 0;
      const r = edgePath(bx[e.from], bx[e.to], all.filter((o) => o.id !== e.from && o.id !== e.to), off);
      e.d = r.d; e.mid = r.mid; e.el.setAttribute("d", r.d);
      if (e.cutMark) gsap.set(e.cutMark, { x: r.mid[0], y: r.mid[1] });
    }
    const w = sc.web;
    for (const we of sc.webEdges) {
      const to = bx[we.to];
      const r = edgePath({ x: w.x, y: w.y, hw: 75, hh: 55 }, to, all.filter((o) => o.id !== we.to), 0);
      we.d = r.d; we.mid = r.mid; we.el.setAttribute("d", r.d);
      if (we.cutMark) gsap.set(we.cutMark, { x: r.mid[0], y: r.mid[1] });
    }
  }

  const EDGE_STYLE = {
    default: { stroke: C.edge, w: 2.5, dash: "none", op: 1, mk: "ah" },
    hot:     { stroke: C.edgeHot, w: 4, dash: "none", op: 1, mk: "ah-hot" },
    dim:     { stroke: C.edge, w: 2.5, dash: "none", op: 0.25, mk: "ah" },
    cut:     { stroke: C.block, w: 3, dash: "6 6", op: 1, mk: "ah-cut" },
    entry:   { stroke: C.st.entry.stroke, w: 3, dash: "9 6", op: 1, mk: "ah-entry" },
  };
  function edgeStyle(e, style, dur, tl, at) {
    const s = EDGE_STYLE[style];
    e.style = style;
    A.when(dur ? tl : null, at, () => {
      e.el.setAttribute("marker-end", `url(#${s.mk})`);
      e.el.setAttribute("stroke-dasharray", s.dash);
    });
    A.tw(tl, e.el, { attr: { stroke: s.stroke, "stroke-width": s.w }, opacity: s.op }, dur, at);
    if (e.cutMark) A.tw(tl, e.cutMark, { autoAlpha: style === "cut" ? 1 : 0 }, dur, at);
  }

  // ------------------------------------------------------------------ build
  A.buildScene = function (plan) {
    const root = A.$("svg");
    root.replaceChildren();
    A.buildDefs(root);
    const L = {};
    const sc = { plan, root, L, ids: plan.nodes.map((n) => n.id), nodes: {}, edges: [], webEdges: [] };
    for (const k of ["title", "watermark", "lin", "legend", "tray"]) L[k] = mkG(root, { id: "L-" + k });
    L.live = mkG(root, { id: "L-live" });
    L.edges = mkG(L.live); L.web = mkG(L.live); L.nodes = mkG(L.live); L.over = mkG(L.live); L.tmp = mkG(L.live);
    L.budget = mkG(root, { id: "L-budget" }); L.results = mkG(root, { id: "L-results" }); L.fx = mkG(root, { id: "L-fx" });

    const ws = plan.nodes.map((n) => n.weight);
    sc.wmin = Math.min(...ws); sc.wmax = Math.max(...ws);
    const lay = layoutNodes(plan);
    sc.web = lay.web;
    sc.nodes = {};
    for (const n of plan.nodes) sc.nodes[n.id] = makeNode(sc, n, lay.pos[n.id]);
    sc.guarded = plan.nodes.filter((n) => (plan.node_guards[n.id] || 0) > 0).map((n) => n.id);

    // edges (drawn beneath nodes)
    for (const e of plan.edges) {
      const el = svg("path", { fill: "none", "stroke-linecap": "round", class: "edge" });
      L.edges.appendChild(el);
      sc.edges.push({ from: e.from, to: e.to, el, d: "", mid: [0, 0], style: "default" });
    }
    for (const n of plan.nodes.filter((x) => x.entry)) {
      const el = svg("path", { fill: "none", "stroke-linecap": "round", class: "edge web-edge" });
      L.web.appendChild(el);
      sc.webEdges.push({ to: n.id, el, d: "", mid: [0, 0], style: "entry" });
    }
    for (const e of [...sc.edges, ...sc.webEdges]) {
      e.cutMark = mkG(L.over); e.cutMark.append(svg("circle", { r: 14, fill: "#fff", stroke: C.block, "stroke-width": 2.5 }));
      A.icon(e.cutMark, "x", 0, 0, 16, C.block); gsap.set(e.cutMark, { autoAlpha: 0 });
    }

    // hostile website node
    const wg = mkG(L.web); sc.websiteG = wg; wg.setAttribute("role", "img"); wg.setAttribute("aria-label", "Hostile target website");
    wg.append(svg("rect", { x: -75, y: -55, width: 150, height: 110, rx: 10, fill: C.website }));
    wg.append(svg("rect", { x: -75, y: -55, width: 150, height: 20, rx: 10, fill: "#3E4452" }), svg("rect", { x: -75, y: -45, width: 150, height: 10, fill: "#3E4452" }));
    for (let i = 0; i < 3; i++) wg.append(svg("circle", { cx: -62 + i * 14, cy: -45, r: 3.5, fill: "#9AA3B2" }));
    A.icon(wg, "globe", -22, -4, 40, "#fff");
    wg.append(svg("polygon", { points: "22,-22 40,10 4,10", fill: "#F2B705", stroke: "#8A6100", "stroke-width": 2, "stroke-linejoin": "round", transform: "translate(8,2)" }));
    wg.append(svg("text", { x: 30, y: 9, "text-anchor": "middle", "font-size": 18, "font-weight": 800, fill: "#16202D" }, "!"));
    wg.append(svg("text", { x: 0, y: 44, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: "#fff" }, "hostile site"));
    sc.hidden = mkG(L.web);
    sc.hidden.append(svg("rect", { x: -75, y: 66, width: 150, height: 30, rx: 6, fill: "#fff", stroke: C.st.entry.stroke, "stroke-width": 2, "stroke-dasharray": "6 4" }),
      svg("text", { x: 0, y: 88, "text-anchor": "middle", "font-size": 18, class: "mono", fill: C.ink2, "font-weight": 600 }, "<!-- ... -->"));
    gsap.set(wg, { x: sc.web.x, y: sc.web.y }); gsap.set(sc.hidden, { x: sc.web.x, y: sc.web.y });

    buildLegend(sc);
    buildTray(sc);
    buildTitle(sc);
    A.sceneParts.forEach((fn) => fn(sc));          // linear / budget / results register here
    A.scene = sc;
    sc.reach = new Set(plan.nodes.filter((n) => n.entry).map((n) => n.id));
    for (let ch = true; ch;) {
      ch = false;
      for (const e of sc.edges) if (sc.reach.has(e.from) && !sc.reach.has(e.to)) { sc.reach.add(e.to); ch = true; }
    }
    redrawEdges(sc);
    return sc;
  };
  A.sceneParts = [];                                // filled by stage-linear/-budget

  // ------------------------------------------------------------------ title / legend / tray
  function buildTitle(sc) {
    const t = sc.L.title;
    const tx = (y, s, w, txt, fill) => t.appendChild(svg("text", { x: 800, y, "text-anchor": "middle", "font-size": s, "font-weight": w, fill: fill || C.ink, style: "letter-spacing:-0.01em" }, txt));
    tx(240, 64, 700, "Stopping a Prompt-Injection Worm");
    tx(318, 64, 700, "in AI Agent Teams");
    tx(404, 28, 500, "Trust-Aware Topological Linearization of multi-agent systems", C.ink2);
    tx(448, 28, 400, "B.Tech project  ·  IIIT Kottayam", C.ink2);
    // 7-node watermark network
    const wm = sc.L.watermark;
    for (const e of sc.plan.edges) {
      const a = sc.nodes[e.from], b = sc.nodes[e.to];
      wm.appendChild(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: C.ink, "stroke-width": 3 }));
    }
    for (const id of sc.ids) wm.appendChild(svg("rect", { x: sc.nodes[id].x - 60, y: sc.nodes[id].y - 26, width: 120, height: 52, rx: 10, fill: C.ink }));
    sc.watermarkLines = wm.querySelectorAll("line");
  }

  function buildLegend(sc) {
    const n = sc.ids.length, step = Math.min(210, 1360 / n), x0 = 800 - step * (n - 1) / 2;
    sc.legendItems = [];
    sc.ids.forEach((id, i) => {
      const gg = mkG(sc.L.legend);
      A.icon(gg, A.roleIcon(sc.nodes[id].n), x0 + i * step - 56, 600, 26);
      const lt = svg("text", { x: x0 + i * step - 36, y: 607, "font-size": 18, "font-weight": 600, class: "sec", fill: C.ink2 }, id);
      A.fitText(lt, id, step - 48, 18, 18, 600);
      gg.append(lt);
      sc.legendItems.push(gg);
    });
  }

  /** Distinct (capability, points) pairs, laid out as a chip tray. */
  function buildTray(sc) {
    const seen = new Map();
    for (const n of sc.plan.nodes) for (const cb of n.cap_breakdown || []) {
      const key = cb.cap + "|" + cb.points;
      if (!seen.has(key)) seen.set(key, { cap: cb.cap, points: cb.points });
    }
    const items = [...seen.values()];
    const widths = items.map((it) => A.textW(`${it.cap} +${fmt(it.points)}`, 18, 600) + 54);
    const gap = 18, total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, items.length - 1);
    let x = 800 - total / 2;
    sc.tray = {};
    items.forEach((it, i) => {
      const chip = A.fx.chipEl(`${it.cap} +${fmt(it.points)}`, widths[i], it.points);
      gsap.set(chip, { x: x + widths[i] / 2, y: 596 });
      sc.L.tray.appendChild(chip);
      sc.tray[it.cap + "|" + it.points] = { el: chip, x: x + widths[i] / 2, y: 596, w: widths[i] };
      x += widths[i] + gap;
    });
    sc.L.tray.appendChild(svg("text", { x: 40, y: 603, "font-size": 18, "font-weight": 700, fill: C.ink2, class: "sec" }, "Capabilities"));
  }

  // ------------------------------------------------------------------ node state
  A.G = {
    sizeScale, redrawEdges, edgeStyle, EDGE_STYLE,

    /** Switch node state; tweens when dur>0 (optionally on timeline `tl` at `at`). */
    setState(nv, st, dur, tl, at) {
      const c = C.st[st];
      const prev = nv.state; nv.state = st;
      A.tw(tl, nv.body, { attr: { fill: c.fill, stroke: c.stroke } }, dur, at);
      const ringOn = st === "active" || st === "clean" || st === "blocked";
      const glyph = st === "clean" ? "check" : st === "compromised" || st === "error" ? "bug" : st === "blocked" ? "x" : null;
      A.when(dur ? tl : null, at, () => {            // discrete changes happen when the tween starts
        nv.ring.setAttribute("stroke-dasharray", st === "active" ? "10 6" : "none");
        nv.ring.setAttribute("class", st === "active" ? "ring-spin" : "");
        nv.word.textContent = c.word; nv.word.setAttribute("fill", c.stroke);
        for (const k of Object.keys(nv.glyph)) nv.glyph[k].setAttribute("visibility", k === glyph ? "visible" : "hidden");
        if (glyph) nv.badgeC.setAttribute("fill", st === "compromised" ? C.st.compromised.stroke : st === "blocked" ? C.block : st === "error" ? C.st.error.stroke : C.pass);
      });
      A.tw(tl, nv.ring, { attr: { stroke: c.stroke }, opacity: ringOn ? 1 : 0 }, dur, at);
      A.tw(tl, nv.ring2, { opacity: st === "blocked" ? 1 : 0 }, dur, at);
      A.tw(tl, nv.hatch, { opacity: st === "compromised" ? 1 : 0 }, dur, at);
      if (!dur) gsap.set(nv.badge, { scale: glyph ? 1 : 0, autoAlpha: glyph ? 1 : 0 });
      else if (glyph && prev !== st) {
        (tl || gsap).fromTo(nv.badge, { scale: 0, autoAlpha: 1 }, { scale: 1, autoAlpha: 1, duration: 0.25, ease: "back.out(2)" }, tl ? at : undefined);
      } else if (!glyph) A.tw(tl, nv.badge, { scale: 0, autoAlpha: 0 }, 0.2, at);
      nv.g.setAttribute("aria-label", `Agent ${nv.id}: ${c.word.toLowerCase()}, risk ${fmt(nv.weight)}`);
    },

    setScale(nv, s) { nv.sc = s; gsap.set(nv.g, { scale: s }); },

    /** Snap the whole network layer to a view descriptor (see steps.js VIEW). */
    apply(v) {
      const sc = A.scene;
      for (const id of sc.ids) {
        const nv = sc.nodes[id];
        nv.sc = v.scaled ? sizeScale(sc, nv.weight) : 1;
        gsap.set(nv.g, { x: nv.x, y: nv.y, scale: nv.sc, autoAlpha: v.net ? 1 : 0 });
        const st = v.nodeState === "infected" ? (sc.reach.has(id) ? "compromised" : "idle") : (v.nodeState || "idle");
        G.setState(nv, st, 0);
        nv.shown = nv.weight; nv.scoreTxt.textContent = fmt(nv.weight);
        gsap.set(nv.score, { autoAlpha: v.scores ? 1 : 0, scale: 1 });
        gsap.set(nv.star, { autoAlpha: v.star && nv.n.critical ? 1 : 0, scale: 1 });
        gsap.set(nv.holds, { autoAlpha: v.holds && nv.n.critical ? 1 : 0 });
        const k = sc.plan.node_guards[id] || 0;
        nv.shieldTxt.textContent = String(k);
        gsap.set(nv.shield, { autoAlpha: v.nodeShields && k > 0 ? 1 : 0, scale: 0.85 });
        gsap.set(nv.entryRing, { autoAlpha: v.entry && nv.n.entry ? 1 : 0, scale: 1, transformOrigin: "50% 50%" });
        gsap.set(nv.tag, { autoAlpha: v.entry && nv.n.entry ? 1 : 0 });
      }
      redrawEdges(sc);
      for (const e of sc.edges) {
        gsap.set(e.el, { clearProps: "strokeDasharray,strokeDashoffset" });
        edgeStyle(e, v.hot && sc.reach.has(e.from) && sc.reach.has(e.to) ? "hot" : "default", 0);
        gsap.set(e.el, { autoAlpha: v.edges ? 1 : 0 });
        gsap.set(e.cutMark, { autoAlpha: 0 });
      }
      for (const e of sc.webEdges) {
        edgeStyle(e, v.hot ? "hot" : "entry", 0);
        gsap.set(e.el, { autoAlpha: v.website ? 1 : 0 });
        gsap.set(e.cutMark, { autoAlpha: 0 });
      }
      gsap.set([sc.websiteG, sc.hidden], { autoAlpha: v.website ? 1 : 0, x: sc.web.x, y: sc.web.y });
      gsap.set(sc.L.legend, { autoAlpha: v.legend ? 1 : 0 });
      gsap.set(sc.L.tray, { autoAlpha: v.tray ? 1 : 0 });
      gsap.set(sc.L.title, { autoAlpha: v.title ? 1 : 0 });
      gsap.set(sc.L.watermark, { autoAlpha: v.watermark ? 0.08 : 0 });
      if (sc.watermarkLines) gsap.set(sc.watermarkLines, { clearProps: "strokeDasharray,strokeDashoffset" });
      for (const k of Object.keys(sc.tray)) gsap.set(sc.tray[k].el, { autoAlpha: 1, scale: 1 });
    },

    /** Node ids in the order a poisoned input spreads: layers of the infection frontier. */
    infectionWaves() {
      const sc = A.scene;
      const entries = sc.plan.nodes.filter((n) => n.entry).map((n) => n.id);
      const depth = {}; const queue = [...entries]; for (const e of entries) depth[e] = 0;
      for (let qi = 0; qi < queue.length; qi++) {
        const u = queue[qi];
        for (const e of sc.edges) if (e.from === u && depth[e.to] === undefined) { depth[e.to] = depth[u] + 1; queue.push(e.to); }
      }
      // longest-path style: a node waits until its infected predecessors are done
      const waves = [];
      const done = new Set();
      let frontier = entries.slice();
      while (frontier.length) {
        waves.push(frontier);
        frontier.forEach((f) => done.add(f));
        const next = new Set();
        for (const e of sc.edges) if (done.has(e.from) && !done.has(e.to)) next.add(e.to);
        frontier = [...next].filter((id) => sc.edges.filter((e) => e.to === id && depth[e.from] !== undefined && !done.has(e.from) && depth[e.from] < depth[id]).length === 0);
        if (!frontier.length && next.size) frontier = [...next];
      }
      return waves;
    },

    /** Zoom the live layer so the network clears the log drawer. */
    compact(on, dur) {
      const sc = A.scene; if (!sc) return;
      let t = { x: 0, y: 0, scale: 1 };
      if (on) {
        const r = A.$("svg").getBoundingClientRect();
        const k = Math.min(r.width / VB_W, r.height / VB_H);
        const oy = (r.height - VB_H * k) / 2;
        const dr = A.$("drawer");
        let availPx = r.height;
        if (!dr.hidden && !dr.classList.contains("closing")) {
          // layout position (offsetTop ignores the slide-in transform, so this is valid mid-animation)
          const topPx = A.$("app").getBoundingClientRect().top + dr.offsetTop;
          availPx = Math.min(r.height, topPx - r.top);
        }
        const availU = (availPx - oy) / k;
        let y0 = Infinity, y1 = -Infinity;
        for (const id of sc.ids) { const nv = sc.nodes[id]; y0 = Math.min(y0, nv.y - 38 * nv.sc - 14); y1 = Math.max(y1, nv.y + 38 * nv.sc + 14); }
        const top = 64 / k + 8;
        const s = Math.max(0.55, Math.min(1, (availU - top - 8) / (y1 - y0)));
        t = s >= 0.995 ? t : { scale: s, x: 800 * (1 - s), y: top - y0 * s };
        if (s >= 0.995) t.y = 0;
      }
      A.tw(null, sc.L.live, Object.assign({ svgOrigin: "0 0" }, t), dur === undefined ? 0.4 : dur);
    },
  };
  const G = A.G;

  // ------------------------------------------------------------------ fx helpers (tokens, chips, banners)
  A.fx = {
    /** Capability chip: white pill, 2u ink-2 stroke, weight suffix coloured by size. */
    chipEl(text, w, pts) {
      const gg = svg("g", { class: "chip" });
      const heavy = pts >= 2;
      gg.append(svg("rect", { x: -w / 2, y: -15, width: w, height: 30, rx: 15, fill: "#fff", stroke: heavy ? C.st.critical.stroke : C.ink2, "stroke-width": 2 }));
      A.icon(gg, "bolt", -w / 2 + 19, 0, 14, heavy ? C.st.critical.stroke : C.ink2);
      gg.append(svg("text", { x: 8, y: 6, "text-anchor": "middle", "font-size": 18, "font-weight": 600 }, text));
      A.pivot(gg);
      return gg;
    },

    /** Attack token: red disc with "!" plus a short fading trail (kind "clean" = neutral packet). */
    token(parent, kind) {
      const bad = kind !== "clean", col = bad ? C.token : C.ink3;
      const all = [];
      for (let i = 3; i >= 1; i--) {                  // trail first so the head draws on top
        const t = svg("g"); t.appendChild(svg("circle", { r: 11 - i * 2, fill: col, opacity: 0.42 - i * 0.1 }));
        t.dataset.lag = String(i * 0.05); parent.appendChild(t); all.push(t);
      }
      const head = svg("g"); head.dataset.lag = "0";
      head.append(svg("circle", { r: 11, fill: col, stroke: "#fff", "stroke-width": 2 }));
      head.append(svg("text", { y: 6, "text-anchor": "middle", "font-size": 16, "font-weight": 800, fill: "#fff" }, bad ? "!" : "\u00B7"));
      parent.appendChild(head); all.push(head);
      all.forEach(A.pivot);
      gsap.set(all, { autoAlpha: 0 });
      return { all, head, remove() { all.forEach((n) => n.remove()); } };
    },

    /** Add a token journey along `edge` ({d, mid}) to timeline `tl` at `at`. Returns the end time. */
    travel(tl, tok, edge, at, dur, seq) {
      const m = /^M([-\d.]+),([-\d.]+)/.exec(edge.d);
      const x0 = parseFloat(m[1]), y0 = parseFloat(m[2]);
      if (A.rm()) {
        // reduced motion: a static numbered marker half-way along the edge
        tl.set(tok.head, { x: edge.mid[0], y: edge.mid[1], autoAlpha: 1 }, at);
        if (seq) {
          const tx = svg("text", { y: -18, "text-anchor": "middle", "font-size": 18, "font-weight": 800, fill: C.token }, String(seq));
          tok.head.appendChild(tx);
        }
        return at + 0.2;
      }
      for (const n of tok.all) {
        const lag = parseFloat(n.dataset.lag);
        tl.set(n, { x: x0, y: y0, autoAlpha: 1 }, at);
        tl.to(n, { motionPath: { path: edge.d, autoRotate: false }, duration: dur, ease: "power1.inOut" }, at + lag);
      }
      return at + dur + 0.15;
    },

    shatter(tl, x, y, at, parent) {
      if (A.rm()) return;
      const sc = A.scene;
      const shards = [];
      for (let i = 0; i < 10; i++) {
        const s = 6 + (i % 3) * 2, a = (i / 10) * Math.PI * 2;
        const p = svg("polygon", { points: `0,${-s} ${s},${s} ${-s},${s}`, fill: C.token });
        (parent || sc.L.tmp).appendChild(p);
        gsap.set(p, { x, y, autoAlpha: 0, rotation: i * 36 });
        shards.push(p);
        tl.to(p, { keyframes: [{ autoAlpha: 1, duration: 0.001 }, { x: x + Math.cos(a) * 60, y: y + Math.sin(a) * 60, rotation: i * 36 + (i % 2 ? 180 : -180), autoAlpha: 0, duration: 0.5, ease: "power3.out" }] }, at);
      }
      tl.call(() => shards.forEach((s) => s.remove()), null, at + 0.6);
    },
  };
})(window.App);
