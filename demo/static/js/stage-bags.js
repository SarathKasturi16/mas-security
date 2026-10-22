/* Bags and checkpoints, told in three drawings that share one data model (plan.bags / plan.boundaries):
 *   step 5  soft blobs around each bag's agents on the real network,
 *   step 6  the blobs unfold into a row of cards (one chip per agent; bridge agents joined by a short line),
 *   step 7  a gate between every pair of adjacent cards, plus S0 at the far left.
 * Everything is derived from the plan, so any manifest works. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, fmt } = A;
  const NS = 72;                                   // outline samples used for the blob <-> card morph
  const TH = Array.from({ length: NS }, (_, j) => (j / NS) * Math.PI * 2);
  const COS = TH.map(Math.cos), SIN = TH.map(Math.sin);
  const hue = (i) => C.bagHue[i % C.bagHue.length];
  const pastel = (i) => C.bags[i % C.bags.length];
  const LEFT = 150, RIGHT = 1570, S0X = 78;

  // ------------------------------------------------------------------ geometry helpers
  /** Distance from c to the boundary of convex polygon `poly` along angle index j. */
  function ray(poly, c, j) {
    const dx = COS[j], dy = SIN[j];
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ex = q[0] - p[0], ey = q[1] - p[1], wx = p[0] - c[0], wy = p[1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
    }
    return best;
  }
  const radii = (poly, c) => TH.map((_, j) => ray(poly, c, j));

  function roundedRectPoly(x, y, w, h, r) {
    const pts = [], k = 7;
    const corner = (cx, cy, a0) => { for (let i = 0; i <= k; i++) { const a = a0 + (i / k) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
    corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0);
    corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
    return pts;
  }

  const smooth = () => d3.line().curve(d3.curveCatmullRomClosed.alpha(0.8));

  /** Outline of a morph between blob and card at fraction f (0 = blob, 1 = card). */
  function morphD(b, f) {
    const cx = b.c[0] + (b.cc[0] - b.c[0]) * f, cy = b.c[1] + (b.cc[1] - b.c[1]) * f;
    const pts = TH.map((_, j) => {
      const r = b.r[j] + (b.rr[j] - b.r[j]) * f;
      return [cx + r * COS[j], cy + r * SIN[j]];
    });
    return smooth()(pts);
  }

  /** Give every agent one row index shared by all bags it appears in, so bridge lines come out horizontal. */
  function assignRows(plan) {
    const inBags = {};
    plan.bags.forEach((b, i) => b.forEach((id) => { (inBags[id] = inBags[id] || []).push(i); }));
    const ids = Object.keys(inBags).sort((a, b) =>
      (inBags[b].length - inBags[a].length) || (inBags[a][0] - inBags[b][0]) || (a < b ? -1 : 1));
    const used = plan.bags.map(() => new Set());
    const row = {};
    for (const id of ids) {
      let r = 0;
      while (inBags[id].some((i) => used[i].has(r))) r++;
      row[id] = r; inBags[id].forEach((i) => used[i].add(r));
    }
    return { row, inBags, rows: Math.max(1, ...Object.values(row).map((r) => r + 1)) };
  }

  // ------------------------------------------------------------------ chips
  const CHIP = {
    normal: { fill: "#FFFFFF", stroke: C.ink2, w: 2 },
    hot: { fill: "#E2E8F0", stroke: C.gate, w: 3.5 },
  };
  function chipEl(nv, w, h) {
    const g = mkG(null, { role: "img", "aria-label": `Agent ${nv.id}, risk ${fmt(nv.weight)}` });
    const bg = svg("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 13, fill: CHIP.normal.fill, stroke: CHIP.normal.stroke, "stroke-width": CHIP.normal.w });
    g.appendChild(bg);
    A.icon(g, A.roleIcon(nv.n), -w / 2 + 22, 0, 22);
    const t = svg("text", { x: -w / 2 + 40, y: 6, "font-weight": 600, fill: C.ink }, nv.id);
    A.fitText(t, nv.id, w - 40 - 44, 18, 14, 600);
    g.appendChild(t);
    const bd = mkG(g); gsap.set(bd, { x: w / 2 - 22, y: 0 });
    bd.append(svg("circle", { r: 15, fill: C.ink, stroke: "#fff", "stroke-width": 2 }),
      svg("text", { y: 6, "text-anchor": "middle", "font-size": 15, "font-weight": 700, fill: "#fff", style: "font-variant-numeric:tabular-nums" }, fmt(nv.weight)));
    A.pivot(g);
    return { g, bg };
  }

  // ------------------------------------------------------------------ build
  function build(sc) {
    const plan = sc.plan, nb = plan.bags.length;
    const bv = sc.bagv = { nb, blobs: [], cards: [], bridges: [], gates: [], brackets: [], s0: null };

    // ---- card layout
    const rw = assignRows(plan);
    const R = rw.rows;
    const avail = RIGHT - LEFT, gap0 = 70;
    const cardW = nb > 1 ? Math.min(268, (avail - (nb - 1) * gap0) / nb) : 268;
    const gap = nb > 1 ? Math.min(140, (avail - nb * cardW) / (nb - 1)) : 0;
    const x0 = LEFT + (avail - (nb * cardW + (nb - 1) * gap)) / 2;
    const rowH = Math.max(40, Math.min(58, Math.floor(290 / R))), chipH = rowH - 12;
    const headH = 54, cardH = headH + R * rowH + 10;
    const cardTop = Math.round(Math.max(150, 330 - cardH / 2 - 24));
    const cardBot = cardTop + cardH;
    const tabCy = cardTop - 38, gateTop = tabCy + 16, gateBot = cardBot + 14;
    const labelY = cardBot + 34, busY = cardBot + 74, noteY = Math.min(626, busY + 50);
    Object.assign(bv, { cardW, gap, cardTop, cardBot, tabCy, gateTop, gateBot, labelY, busY, rows: rw });
    const pitch = cardW + gap;

    // ---- blobs (network view)
    const boxes = plan.nodes.map((n) => { const nv = sc.nodes[n.id], s = A.G.sizeScale(sc, n.weight); return { id: n.id, x: nv.x, y: nv.y, hw: 84 * s, hh: 38 * s }; });
    const boxOf = (id) => boxes.find((b) => b.id === id);
    bv.boxes = boxes;
    plan.bags.forEach((bag, i) => {
      const pad = 30, pts = [];
      for (const id of bag) {
        const b = boxOf(id);
        for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; pts.push([b.x + Math.cos(a) * (b.hw + pad), b.y + Math.sin(a) * (b.hh + pad)]); }
      }
      const hull = d3.polygonHull(pts);
      const c = d3.polygonCentroid(hull);
      const r = radii(hull, c);
      const cx = x0 + i * pitch, cc = [cx + cardW / 2, cardTop + cardH / 2];
      const rr = radii(roundedRectPoly(cx, cardTop, cardW, cardH, 18), cc);
      const b = { i, bag, c, r, cc, rr, card: { x: cx, y: cardTop, w: cardW, h: cardH } };
      b.cp = [cx + 38, cardTop + 28];

      b.g = mkG(sc.L.blobs, { "aria-hidden": "true" });
      b.path = svg("path", { d: morphD(b, 0), fill: hue(i), "fill-opacity": 0.16, stroke: hue(i), "stroke-opacity": 0.9, "stroke-width": 3, "stroke-linejoin": "round" });
      b.g.appendChild(b.path);
      b.lab = bagLabel(sc.L.blobLab, i);
      b.lp = [b.c[0], b.c[1]];
      bv.blobs.push(b);
    });

    // ---- cards
    const cardsG = bv.cardsG = mkG(sc.L.cards);
    plan.bags.forEach((bag, i) => {
      const x = x0 + i * pitch;
      const cd = { i, x, g: mkG(cardsG), chips: {}, list: [] };
      cd.bg = svg("rect", { x, y: cardTop, width: cardW, height: cardH, rx: 18, fill: pastel(i), stroke: hue(i), "stroke-width": 3 });
      cd.g.appendChild(cd.bg);
      cd.lab = bagLabel(cd.g, i, true);
      gsap.set(cd.lab, { x: x + 38, y: cardTop + 28 });
      cd.cnt = svg("text", { x: x + cardW - 16, y: cardTop + 35, "text-anchor": "end", "font-size": 16, "font-weight": 600, fill: C.ink2, class: "sec" }, `${bag.length} agent${bag.length === 1 ? "" : "s"}`);
      cd.g.appendChild(cd.cnt);
      for (const id of bag) {
        const ch = chipEl(sc.nodes[id], cardW - 24, chipH);
        const cy = cardTop + headH + rw.row[id] * rowH + rowH / 2 - 1;
        cd.g.appendChild(ch.g);
        gsap.set(ch.g, { x: x + cardW / 2, y: cy });
        const o = { id, g: ch.g, bg: ch.bg, x: x + cardW / 2, y: cy, w: cardW - 24, h: chipH, hot: rw.inBags[id].length > 1 };
        cd.chips[id] = o; cd.list.push(o);
      }
      bv.cards.push(cd);
    });
    bv.note = svg("text", { x: x0 + (nb * cardW + (nb - 1) * gap) / 2, y: noteY, "text-anchor": "middle", "font-size": 18, "font-weight": 500, fill: C.ink2 },
      "Left-to-right is just the order the bags were built in (Min-Fill), not the order the agents run.");
    sc.L.cards.appendChild(bv.note);

    // ---- bridges: one short line per shared agent between neighbouring cards
    bv.bridgesG = mkG(sc.L.cards);
    (plan.boundaries || []).forEach((bd) => {
      const a = bv.cards[bd.between[0]], b = bv.cards[bd.between[1]];
      const lines = [];
      for (const id of bd.nodes) {
        const ca = a.chips[id], cb = b.chips[id];
        if (!ca || !cb) continue;
        const ln = svg("line", { x1: ca.x + ca.w / 2, y1: ca.y, x2: cb.x - cb.w / 2, y2: cb.y, stroke: C.gate, "stroke-width": 6, "stroke-linecap": "round" });
        bv.bridgesG.appendChild(ln); lines.push(ln);
      }
      bv.bridges.push({ bd, lines });
    });

    // ---- S0: the entry checkpoint, with dashed pointers to the entry agents' chips
    const s0cp = plan.checkpoints.find((c) => c.boundary < 0);
    if (s0cp) {
      const s0 = bv.s0 = { cp: s0cp, g: mkG(sc.L.cards, { role: "img", "aria-label": "Checkpoint S0: entry checkpoint" }), ptr: [] };
      s0.bar = svg("rect", { x: S0X - 5, y: gateTop, width: 10, height: busY - gateTop + 5, rx: 5, fill: C.gate });
      s0.g.appendChild(s0.bar);
      s0.tab = mkG(s0.g); gsap.set(s0.tab, { x: S0X, y: tabCy });
      s0.tab.append(svg("rect", { x: -33, y: -16, width: 66, height: 32, rx: 9, fill: "#fff", stroke: C.gate, "stroke-width": 2.5 }));
      A.icon(s0.tab, "arrowIn", -16, 0, 15, C.gate);
      s0.tab.appendChild(svg("text", { x: 9, y: 7, "text-anchor": "middle", "font-size": 20, "font-weight": 700, fill: C.ink }, s0cp.id));
      A.pivot(s0.tab);
      s0.sign = mkG(s0.g);
      s0.sign.append(svg("rect", { x: S0X - 60, y: cardTop + 60, width: 120, height: 92, rx: 10, fill: "#fff", stroke: C.gate, "stroke-width": 2 }));
      ["entry", "checkpoint"].forEach((t, i) => s0.sign.append(svg("text", { x: S0X, y: cardTop + 92 + i * 22, "text-anchor": "middle", "font-size": 16, "font-weight": 600, fill: C.ink }, t)));
      const entries = s0cp.nodes.map((id) => {
        const bi = (rw.inBags[id] || [])[0];
        return bi === undefined ? null : { ch: bv.cards[bi].chips[id], cd: bv.cards[bi] };
      }).filter(Boolean);
      // one dashed "bus" under the cards; each entry chip hangs off it. A chip on its card's bottom row is
      // reached from below; otherwise the pointer climbs the gap left of its card and enters from the side.
      const reach = (e) => {
        const bottom = Math.max(...e.cd.list.map((c) => c.y)) === e.ch.y;
        return bottom ? { x: e.ch.x, d: `M${e.ch.x},${busY} V${e.ch.y + e.ch.h / 2 + 4}` }
          : { x: Math.max(S0X + 20, e.cd.x - 16), d: `M${Math.max(S0X + 20, e.cd.x - 16)},${busY} V${e.ch.y} H${e.ch.x - e.ch.w / 2 - 4}` };
      };
      const paths = entries.map(reach);
      const farX = Math.max(S0X, ...paths.map((p) => p.x));
      s0.bus = svg("path", { d: `M${S0X},${busY} H${farX}`, fill: "none", stroke: C.gate, "stroke-width": 3, "stroke-dasharray": "9 7", "stroke-linecap": "round", opacity: 0.85 });
      s0.g.appendChild(s0.bus);
      for (const pt of paths) {
        const p = svg("path", { d: pt.d, fill: "none", stroke: C.gate, "stroke-width": 3, "stroke-dasharray": "9 7", "stroke-linecap": "round", "stroke-linejoin": "round", "marker-end": "url(#ah-gate)", opacity: 0.9 });
        s0.g.appendChild(p); s0.ptr.push(p);
      }
    }
    // ---- gates between every pair of adjacent cards
    bv.gatesG = mkG(sc.L.cards);
    (plan.boundaries || []).forEach((bd, k) => {
      const gx = x0 + (bd.between[0] + 1) * pitch - gap / 2;
      const id = bd.checkpoint || "S?";
      const gt = { k, bd, id, x: gx, g: mkG(bv.gatesG, { role: "img", "aria-label": `Checkpoint ${id} between bags B${bd.between[0] + 1} and B${bd.between[1] + 1}: ${bd.nodes.join(", ")}` }) };
      gsap.set(gt.g, { x: gx });
      gt.bar = svg("rect", { x: -5, y: gateTop, width: 10, height: gateBot - gateTop, rx: 5, fill: C.gate });
      gt.tab = mkG(gt.g); gsap.set(gt.tab, { y: tabCy });
      gt.tab.append(svg("rect", { x: -33, y: -16, width: 66, height: 32, rx: 9, fill: "#fff", stroke: C.gate, "stroke-width": 2.5 }));
      A.icon(gt.tab, "lock", -16, 0, 15, C.gate);
      gt.tab.appendChild(svg("text", { x: 9, y: 7, "text-anchor": "middle", "font-size": 20, "font-weight": 700, fill: C.ink }, id));
      A.pivot(gt.tab);
      gt.g.insertBefore(gt.bar, gt.tab);
      const txt = bd.nodes.join(" + ") || "(no shared agent)";
      gt.lbl = svg("text", { y: labelY, "text-anchor": "middle", "font-weight": 600, fill: C.gate, stroke: "#fff", "stroke-width": 6, "paint-order": "stroke" }, txt);
      A.fitText(gt.lbl, txt, Math.max(80, pitch - 56), 17, 13, 600);
      gt.g.appendChild(gt.lbl);
      bv.gates.push(gt);
    });
    // faint bracket + note joining gates that carry the same checkpoint id
    const byId = {};
    bv.gates.forEach((gt) => { (byId[gt.id] = byId[gt.id] || []).push(gt); });
    for (const id of Object.keys(byId)) {
      const grp = byId[id]; if (grp.length < 2) continue;
      const xa = grp[0].x, xb = grp[grp.length - 1].x, yB = tabCy - 38;
      const g = mkG(bv.gatesG);
      g.append(svg("path", { d: `M${xa},${tabCy - 20} V${yB} H${xb} V${tabCy - 20}`, fill: "none", stroke: C.gate, "stroke-width": 2.5, "stroke-dasharray": "6 5", "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.6 }));
      const note = svg("text", { x: (xa + xb) / 2, y: yB - 9, "text-anchor": "middle", "font-size": 17, "font-weight": 600, fill: C.ink2 }, `${id}: same agents → same checkpoint, same guards`);
      A.fitText(note, note.textContent, Math.max(200, (xb - xa) + pitch * 0.8), 17, 13, 600);
      g.appendChild(note);
      bv.brackets.push({ id, g });
    }
  }
  A.sceneParts.push(build);

  /** "B1" pill. Blob labels are centred on their anchor; card labels the same (positioned by the caller). */
  function bagLabel(parent, i) {
    const g = mkG(parent);
    const w = 52;
    g.append(svg("rect", { x: -w / 2, y: -16, width: w, height: 32, rx: 16, fill: "#fff", stroke: hue(i), "stroke-width": 3 }),
      svg("text", { y: 7, "text-anchor": "middle", "font-size": 20, "font-weight": 800, fill: C.ink }, "B" + (i + 1)));
    A.pivot(g);
    return g;
  }

  /** Put each "B1" label on its blob's outline, at the spot farthest from every agent, arrow and earlier label.
   *  Uses the arrows' current geometry, so it runs when the blobs are shown, not at build time. */
  function placeLabels(sc) {
    const bv = sc.bagv, placed = [], samples = [];
    for (const e of sc.edges) {
      let len = 0; try { len = e.el.getTotalLength(); } catch (_) { continue; }
      for (let k = 0; k <= 30; k++) { const p = e.el.getPointAtLength(len * k / 30); samples.push([p.x, p.y]); }
    }
    for (const b of bv.blobs) {
      let best = null, bestScore = -Infinity;
      for (let j = 0; j < NS; j++) {
        const p = [b.c[0] + b.r[j] * COS[j], b.c[1] + b.r[j] * SIN[j]];
        let sco = Infinity;
        for (const bx of bv.boxes) sco = Math.min(sco, Math.hypot(Math.max(Math.abs(p[0] - bx.x) - bx.hw, 0), Math.max(Math.abs(p[1] - bx.y) - bx.hh, 0)) + (b.bag.includes(bx.id) ? 24 : 0));
        for (const q of samples) sco = Math.min(sco, Math.hypot(p[0] - q[0], p[1] - q[1]) * 1.2);
        for (const q of placed) sco = Math.min(sco, Math.hypot(p[0] - q[0], p[1] - q[1]) * 0.7);
        if (p[0] < 50 || p[0] > 1550 || p[1] < 36 || p[1] > 604) sco -= 80;
        sco -= p[1] * 0.01;
        if (sco > bestScore) { bestScore = sco; best = p; }
      }
      b.lp = [Math.max(50, Math.min(1550, best[0])), Math.max(36, Math.min(604, best[1]))];
      gsap.set(b.lab, { x: b.lp[0], y: b.lp[1] });
      placed.push(b.lp);
    }
  }

  // ------------------------------------------------------------------ public API
  A.K = {
    morphD, placeLabels,

    /** Snap every bag/card/gate element to a view descriptor (see steps.js VIEW). */
    apply(v) {
      const sc = A.scene, bv = sc.bagv, L = sc.L;
      gsap.set([L.blobs, L.blobLab], { autoAlpha: v.blobs ? 1 : 0 });
      if (v.blobs) placeLabels(sc);
      for (const b of bv.blobs) {
        gsap.set(b.g, { autoAlpha: 1 });
        gsap.set(b.path, { scale: 1, autoAlpha: 1 });
        b.path.setAttribute("d", morphD(b, 0)); b.path.setAttribute("fill-opacity", 0.16);
        gsap.set(b.lab, { x: b.lp[0], y: b.lp[1], scale: 1, autoAlpha: 1 });
      }
      gsap.set(L.cards, { autoAlpha: v.cards ? 1 : 0 });
      gsap.set(bv.cardsG, { autoAlpha: 1 });
      gsap.set(bv.note, { autoAlpha: v.cards ? 1 : 0 });
      for (const cd of bv.cards) {
        gsap.set(cd.g, { autoAlpha: 1 }); gsap.set(cd.bg, { opacity: 1 }); gsap.set(cd.lab, { autoAlpha: 1, scale: 1, x: cd.x + 38 }); gsap.set(cd.cnt, { autoAlpha: 1 });
        for (const ch of cd.list) {
          gsap.set(ch.g, { autoAlpha: 1, scale: 1 });
          const st = v.bridges && ch.hot ? CHIP.hot : CHIP.normal;
          ch.bg.setAttribute("fill", st.fill); ch.bg.setAttribute("stroke", st.stroke); ch.bg.setAttribute("stroke-width", st.w);
        }
      }
      gsap.set(bv.bridgesG, { autoAlpha: v.bridges ? 1 : 0 });
      for (const br of bv.bridges) for (const ln of br.lines) gsap.set(ln, { clearProps: "strokeDasharray,strokeDashoffset" });
      gsap.set(bv.gatesG, { autoAlpha: v.gates ? 1 : 0 });
      for (const gt of bv.gates) {
        gsap.set(gt.g, { autoAlpha: 1, x: gt.x });
        gt.bar.setAttribute("height", bv.gateBot - bv.gateTop);
        gsap.set(gt.tab, { scale: 1, y: bv.tabCy }); gsap.set(gt.lbl, { opacity: 1 });
      }
      for (const b of bv.brackets) gsap.set(b.g, { autoAlpha: 1 });
      if (bv.s0) {
        gsap.set(bv.s0.g, { autoAlpha: v.s0 ? 1 : 0 });
        gsap.set(bv.s0.tab, { scale: 1 });
        bv.s0.bar.setAttribute("height", bv.busY - bv.gateTop + 5);
        gsap.set([bv.s0.bus, ...bv.s0.ptr, bv.s0.sign], { autoAlpha: 1 });
      }
    },

    /** Timeline pieces ------------------------------------------------- */
    /** Step 5: blobs arrive one bag at a time; bridge agents get their tag + pulse ring as they gain a bag. */
    playBlobs(tl, at) {
      const sc = A.scene, bv = sc.bagv, cnt = {};
      let t = at;
      placeLabels(sc);
      tl.set([sc.L.blobs, sc.L.blobLab], { autoAlpha: 1 }, at - 0.1);
      bv.blobs.forEach((b, i) => {
        const dur = A.dur(0.7);
        tl.set(b.g, { autoAlpha: 1 }, t);
        tl.fromTo(b.path, { scale: 0.55, autoAlpha: 0, svgOrigin: `${b.c[0]} ${b.c[1]}` }, { scale: 1, autoAlpha: 1, duration: dur, ease: "back.out(1.4)" }, t);
        tl.fromTo(b.path, { attr: { "fill-opacity": 0.36 } }, { attr: { "fill-opacity": 0.16 }, duration: 0.9, ease: "power1.out" }, t + dur * 0.6);
        tl.fromTo(b.lab, { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(2.4)" }, t + dur * 0.5);
        for (const id of b.bag) {
          cnt[id] = (cnt[id] || 0) + 1;
          if (cnt[id] < 2) continue;
          const nv = sc.nodes[id], n = cnt[id];
          tl.call(() => A.G.bagTagText(nv, n), null, t + dur * 0.7);
          tl.fromTo(nv.bagTag, { scale: n === 2 ? 0.4 : 0.85 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(2.2)" }, t + dur * 0.7);
          tl.to(nv.bagPulse, { autoAlpha: 1, duration: 0.3 }, t + dur * 0.7);
        }
        t += A.dur(1.05);
      });
      return t;
    },

    /** Step 6: blobs fly into the cards, chips appear, bridges join the shared ones. Returns end time. */
    playUnfold(tl, at) {
      const sc = A.scene, bv = sc.bagv;
      const dur = A.dur(1.4);
      // the network behind steps aside
      const nodeGs = sc.ids.map((id) => sc.nodes[id].g);
      tl.to(nodeGs, { autoAlpha: 0, duration: 0.5 }, at);
      tl.to(sc.edges.map((e) => e.el), { autoAlpha: 0, duration: 0.4 }, at);
      sc.ids.forEach((id) => { const nv = sc.nodes[id]; tl.to([nv.bagTag, nv.bagPulse], { autoAlpha: 0, duration: 0.3 }, at); });
      tl.set(sc.L.cards, { autoAlpha: 1 }, at);
      tl.set([bv.note, bv.bridgesG], { autoAlpha: 0 }, at);
      for (const cd of bv.cards) {
        tl.set(cd.bg, { opacity: 0 }, at);
        tl.set([cd.lab, cd.cnt], { autoAlpha: 0 }, at);
        for (const ch of cd.list) tl.set(ch.g, { autoAlpha: 0 }, at);
      }
      const px = { f: 0 };
      tl.to(px, { f: 1, duration: dur, ease: "power2.inOut", onUpdate() { for (const b of bv.blobs) b.path.setAttribute("d", morphD(b, px.f)); } }, at + 0.15);
      bv.blobs.forEach((b) => {
        tl.to(b.lab, { x: b.cp[0], y: b.cp[1], duration: dur, ease: "power2.inOut" }, at + 0.15);
        tl.to(b.path, { attr: { "fill-opacity": 0.1 }, duration: dur }, at + 0.15);
      });
      const tm = at + 0.15 + dur;
      for (const cd of bv.cards) {
        tl.to(cd.bg, { opacity: 1, duration: 0.25 }, tm - 0.15);
        tl.to([cd.lab, cd.cnt], { autoAlpha: 1, duration: 0.2 }, tm - 0.1);
        cd.list.forEach((ch, k) => tl.fromTo(ch.g, { scale: 0.6, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(1.8)" }, tm + cd.i * 0.08 + k * 0.07));
      }
      tl.to([sc.L.blobs, sc.L.blobLab], { autoAlpha: 0, duration: 0.3 }, tm + 0.05);
      // bridge agents light up in the gate colour and get joined to their twin in the next card
      let t = tm + 0.7;
      for (const br of bv.bridges) {
        const ids = new Set(br.bd.nodes);
        for (const cd of [bv.cards[br.bd.between[0]], bv.cards[br.bd.between[1]]]) {
          for (const ch of cd.list) if (ids.has(ch.id)) tl.to(ch.bg, { attr: { fill: CHIP.hot.fill, stroke: CHIP.hot.stroke, "stroke-width": CHIP.hot.w }, duration: 0.3 }, t);
        }
        tl.set(bv.bridgesG, { autoAlpha: 1 }, t);
        br.lines.forEach((ln) => tl.fromTo(ln, { drawSVG: "0%" }, { drawSVG: "100%", duration: A.dur(0.4), ease: "power1.out" }, t));
        t += 0.35;
      }
      tl.fromTo(bv.note, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, t);
      return t + 0.6;
    },

    /** Step 7: gates between the cards (left to right), repeated-id brackets, then S0 and its pointers. */
    playGates(tl, at) {
      const sc = A.scene, bv = sc.bagv;
      let t = at;
      for (const gt of bv.gates) {
        const ids = new Set(gt.bd.nodes);
        for (const ch of [...bv.cards[gt.bd.between[0]].list, ...bv.cards[gt.bd.between[1]].list]) {
          if (!ids.has(ch.id)) continue;
          if (!A.rm()) tl.to(ch.g, { scale: 1.09, duration: 0.2, yoyo: true, repeat: 1 }, t);
        }
        tl.set(gt.g, { autoAlpha: 1 }, t + 0.1);
        tl.fromTo(gt.bar, { attr: { height: 0 } }, { attr: { height: bv.gateBot - bv.gateTop }, duration: A.dur(0.45), ease: "power2.out" }, t + 0.1);
        tl.fromTo(gt.tab, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2.2)" }, t + 0.1);
        tl.fromTo(gt.lbl, { opacity: 0 }, { opacity: 1, duration: 0.4 }, t + 0.4);
        t += 0.8;
      }
      for (const b of bv.brackets) { tl.fromTo(b.g, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, t); t += 0.4; }
      if (bv.s0) {
        const s0 = bv.s0;
        t += 0.2;
        tl.set(s0.g, { autoAlpha: 1 }, t);
        tl.fromTo(s0.bar, { attr: { height: 0 } }, { attr: { height: bv.busY - bv.gateTop + 5 }, duration: A.dur(0.6), ease: "power2.out" }, t);
        tl.fromTo(s0.tab, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2.2)" }, t);
        tl.fromTo(s0.sign, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, t + 0.3);
        tl.fromTo(s0.bus, { autoAlpha: 0 }, { autoAlpha: 0.85, duration: 0.5 }, t + 0.6);
        s0.ptr.forEach((p, i) => tl.fromTo(p, { autoAlpha: 0 }, { autoAlpha: 0.9, duration: 0.4 }, t + 0.9 + i * 0.2));
        t += 1.3 + s0.ptr.length * 0.2;
      }
      return t;
    },
  };
})(window.App);
