/* Budget view (pot, coins, guard rows, bars, shields at gates) and the results bar chart. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, fmt } = A;
  const ROW_GHOST = 516, ROW_SOLID = 546, BAR_Y = 592, TXT_Y = 630;

  // ------------------------------------------------------------------ budget
  function coinEl(r) {
    const gg = svg("g", { class: "coin" });
    gg.append(svg("circle", { r, fill: "url(#coin-grad)", stroke: C.coinEdge, "stroke-width": 2 }));
    gg.append(svg("path", { d: `M${-r * 0.6},${-r * 0.25} A${r * 0.65},${r * 0.65} 0 0 1 ${-r * 0.1},${-r * 0.65}`, fill: "none", stroke: "#fff", "stroke-opacity": 0.5, "stroke-width": 2, "stroke-linecap": "round" }));
    gg.append(svg("text", { y: r * 0.35, "text-anchor": "middle", "font-size": Math.min(16, r * 1.15), "font-weight": 700, fill: C.coinEdge }, "1"));
    return gg;
  }

  /** Centre positions for n coins of radius r in rows around (cx, y0). */
  function slotPositions(cx, y0, n, r, width) {
    const step = 2 * r + 4, cap = Math.max(1, Math.floor(width / step));
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cap), inRow = Math.min(cap, n - row * cap);
      const col = i - row * cap;
      out.push([cx + (col - (inRow - 1) / 2) * step, y0 + row * step]);
    }
    return out;
  }
  function pickRadius(maxN, width) {
    for (const r of [11, 9, 7]) {
      const cap = Math.floor(width / (2 * r + 4));
      if (maxN <= cap * 2) return r;
    }
    return 6;
  }

  function buildBudget(sc) {
    const plan = sc.plan, lin = sc.lin, B = plan.budget;
    const bud = sc.bud = { pot: null, potCoins: [], ghost: {}, slots: {}, bars: {}, shields: {} };
    const L = sc.L.budget;
    const W = lin.pitch - 40;

    // pot (left region)
    const pot = bud.pot = mkG(L); gsap.set(pot, { x: 40, y: 262 });
    pot.append(svg("rect", { x: 0, y: 0, width: 220, height: 20, rx: 10, fill: C.pot, stroke: C.potEdge, "stroke-width": 3 }));
    pot.append(svg("path", { d: "M12,20 H208 C214,60 212,110 198,138 Q192,150 178,150 H42 Q28,150 22,138 C8,110 6,60 12,20 Z", fill: C.pot, stroke: C.potEdge, "stroke-width": 3, "stroke-linejoin": "round" }));
    pot.append(svg("text", { x: 110, y: -14, "text-anchor": "middle", "font-size": 22, "font-weight": 700, fill: C.ink }, `Budget B = ${B}`));
    const potR = B <= 18 ? 14 : 11, pStep = 2 * potR + 3;
    const perRow = Math.floor(190 / pStep);
    bud.potPos = [];
    for (let i = 0; i < B; i++) {
      const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, B - row * perRow);
      bud.potPos.push([40 + 110 + (col - (inRow - 1) / 2) * pStep, 262 + 142 - potR - row * pStep]);
    }
    for (let i = 0; i < B; i++) {
      const c = coinEl(potR); L.appendChild(c); A.pivot(c); gsap.set(c, { x: bud.potPos[i][0], y: bud.potPos[i][1] });
      bud.potCoins.push(c);
    }
    bud.potR = potR;

    // row labels (left region)
    bud.labels = mkG(L);
    bud.lblGhost = svg("text", { x: 40, y: ROW_GHOST + 6, "font-size": 18, "font-weight": 600, fill: C.ink2 }, "");
    bud.lblSolid = svg("text", { x: 40, y: ROW_SOLID + 6, "font-size": 18, "font-weight": 700, fill: C.ink }, "");
    bud.lblBar = svg("text", { x: 40, y: BAR_Y + 14, "font-size": 18, "font-weight": 600, fill: C.ink2 }, "Guards per gate");
    bud.labels.append(bud.lblGhost, bud.lblSolid, bud.lblBar);

    const sel = plan.alloc === "uniform" ? "guards_uniform" : "guards_risk";
    const oth = plan.alloc === "uniform" ? "guards_risk" : "guards_uniform";
    const maxG = Math.max(...plan.checkpoints.map((c) => Math.max(c[sel], c[oth])), 1);
    const r = pickRadius(maxG, W);
    bud.r = r; bud.sel = sel; bud.oth = oth;
    const maxBar = lin.pitch - 90;
    const barScale = maxBar / maxG;

    for (const cp of plan.checkpoints) {
      const gt = lin.gates[cp.id], gx = gt.x;
      // ghost (other allocation) circles
      const gp = slotPositions(gx, ROW_GHOST, cp[oth], r, W);
      bud.ghost[cp.id] = gp.map(([x, y]) => {
        const c = svg("circle", { cx: x, cy: y, r, fill: "none", stroke: C.coinEdge, "stroke-width": 2, "stroke-dasharray": "4 3", opacity: 0 });
        L.appendChild(c); return c;
      });
      bud.slots[cp.id] = slotPositions(gx, ROW_SOLID, cp[sel], r, W);
      // bar
      const x0 = gx - (maxBar) / 2 - 10;
      const bar = mkG(L); gsap.set(bar, { x: x0, y: BAR_Y, autoAlpha: 0 });
      const len = cp[sel] * barScale;
      const fill = plan.alloc === "uniform" ? C.barEqual : C.barRisk;
      const rect = svg("rect", { x: 0, y: 0, width: len, height: 20, rx: 4, fill, stroke: C.ink, "stroke-width": 2 });
      const pat = svg("rect", { x: 0, y: 0, width: len, height: 20, rx: 4, fill: plan.alloc === "uniform" ? "url(#dots-amber)" : "none" });
      const val = svg("text", { x: len + 8, y: 16, "font-size": 18, "font-weight": 700, fill: C.ink }, String(cp[sel]));
      bar.append(svg("line", { x1: 0, y1: -4, x2: 0, y2: 24, stroke: C.ink, "stroke-width": 2 }), rect, pat, val);
      const q = plan.alloc === "uniform" ? cp.q_uniform : cp.q_risk;
      const qt = svg("text", { x: gx, y: TXT_Y, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: C.ink2, opacity: 0 }, `q = ${q.toFixed(2)} → ${cp[sel]} guard${cp[sel] === 1 ? "" : "s"}`);
      L.appendChild(qt);
      bud.bars[cp.id] = { g: bar, rect, pat, val, len, qt };
      // shield (step 9+)
      const sh = mkG(L); A.pivot(sh); gsap.set(sh, { x: gx, y: 556, scale: 0, autoAlpha: 0 });
      sh.append(svg("path", { d: A.SHIELD_D, fill: C.shieldFill, stroke: C.shield, "stroke-width": 3, "stroke-linejoin": "round" }));
      sh.append(svg("text", { y: 9, "text-anchor": "middle", "font-size": 24, "font-weight": 700, fill: C.shield }, String(cp.guards)));
      const catches = svg("text", { x: gx, y: TXT_Y, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: C.ink, opacity: 0 }, `catches ${Math.round(cp.p_block * 100)}%`);
      L.appendChild(catches);
      bud.shields[cp.id] = { g: sh, catches };
    }
    bud.strongest = plan.checkpoints.reduce((a, c) => (c.guards > a.guards ? c : a), plan.checkpoints[0]);
  }
  A.sceneParts.push(buildBudget);

  /** Row label (textContent only). The equal split is rounded to whole guards (e.g. 10 over 3 gates = 4/3/3),
   *  so say so under the label rather than leave the audience to wonder. */
  function setRowLabel(t, name, equal, noteAbove) {
    const note = () => svg("tspan", { x: 40, dy: noteAbove ? -17 : 17, "font-size": 14, "font-weight": 500 }, "(rounded to whole guards)");
    if (!equal) { t.replaceChildren(document.createTextNode(name)); return; }
    if (noteAbove) t.replaceChildren(note(), svg("tspan", { x: 40, dy: 17 }, name));   // keep the name on the row's baseline
    else t.replaceChildren(document.createTextNode(name), note());
  }

  A.B = {
    ROW_SOLID,
    /** Label text depends on which allocation is selected. */
    labelRows() {
      const bud = A.scene.bud, uni = A.scene.plan.alloc === "uniform";
      setRowLabel(bud.lblGhost, uni ? "Risk split" : "Equal split", !uni, true);
      setRowLabel(bud.lblSolid, uni ? "Equal split" : "Risk split", uni, false);
    },
    apply(v) {
      const sc = A.scene, bud = sc.bud, plan = sc.plan;
      A.B.labelRows();
      gsap.set(bud.pot, { autoAlpha: v.pot ? 1 : 0 });
      const placed = v.coins === "placed";
      let used = 0;
      for (const cp of plan.checkpoints) used += cp[bud.sel];
      bud.potCoins.forEach((c, i) => {
        const here = placed && i < used;
        let pos = bud.potPos[i];
        if (here) pos = A.B.coinSlot(i);
        gsap.set(c, { x: pos[0], y: pos[1], scale: here ? bud.r / bud.potR : 1, autoAlpha: v.pot ? 1 : 0 });
      });
      gsap.set(bud.labels, { autoAlpha: v.ghost || v.coins ? 1 : 0 });
      gsap.set(bud.lblGhost, { autoAlpha: v.ghost ? 1 : 0 });
      gsap.set(bud.lblSolid, { autoAlpha: v.coins ? 1 : 0 });
      gsap.set(bud.lblBar, { autoAlpha: v.bars ? 1 : 0 });
      for (const cp of plan.checkpoints) {
        bud.ghost[cp.id].forEach((c) => gsap.set(c, { opacity: v.ghost ? 0.7 : 0 }));
        const b = bud.bars[cp.id];
        gsap.set(b.g, { autoAlpha: v.bars ? 1 : 0 });
        b.rect.setAttribute("width", b.len); b.pat.setAttribute("width", b.len); b.val.setAttribute("x", b.len + 8);
        gsap.set(b.qt, { opacity: v.bars ? 1 : 0 });
        const s = bud.shields[cp.id];
        gsap.set(s.g, { scale: v.gShields ? 1.25 : 0, autoAlpha: v.gShields ? 1 : 0 });
        gsap.set(s.catches, { opacity: v.gShields ? 1 : 0 });
      }
    },
    /** Slot position of the i-th flying coin (coins are dealt to gates in order). */
    coinSlot(i) {
      const bud = A.scene.bud;
      let k = i;
      for (const cp of A.scene.plan.checkpoints) {
        const n = cp[bud.sel];
        if (k < n) return bud.slots[cp.id][k];
        k -= n;
      }
      return bud.potPos[i];
    },
  };

  // ------------------------------------------------------------------ results chart
  function buildResults(sc) {
    const plan = sc.plan, sim = plan.sim || {};
    const L = sc.L.results;
    const rows = [
      { key: "none", label: "No defence", color: C.barNone, pat: "url(#hatch-solid-red)" },
      { key: "uniform", label: "Equal split", color: C.barEqual, pat: "url(#dots-amber)" },
      { key: "risk", label: "Risk split", color: C.barRisk, pat: "none" },
    ].filter((r) => sim[r.key]);
    const res = sc.res = { bars: [], rows };
    if (!rows.length) return;
    const maxV = Math.max(...rows.map((r) => sim[r.key].I_w), 0.01);
    const niceMax = Math.min(1, Math.max(0.1, Math.ceil(maxV * 10 - 1e-9) / 10));
    const y = d3.scaleLinear().domain([0, niceMax]).range([510, 100]);
    res.y = y; res.axisX = 420; res.baseY = 510;
    // grid + ticks
    const nt = Math.round(niceMax * 10);
    for (let i = 0; i <= nt; i++) {
      const v = i / 10, yy = y(v);
      L.append(svg("line", { x1: 420, x2: 1180, y1: yy, y2: yy, stroke: i === 0 ? C.ink : C.grid, "stroke-width": i === 0 ? 2 : 1.5 }));
      L.append(svg("text", { x: 408, y: yy + 6, "text-anchor": "end", "font-size": 18, fill: C.ink2, style: "font-variant-numeric:tabular-nums" }, v.toFixed(1)));
    }
    L.append(svg("line", { x1: 420, x2: 420, y1: 100, y2: 510, stroke: C.ink, "stroke-width": 2 }));
    L.append(svg("text", { transform: "translate(352,305) rotate(-90)", "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: C.ink2 }, "Expected share of team risk compromised"));
    const bw = 180, gap = 90, x0 = 440;
    rows.forEach((r, i) => {
      const x = x0 + i * (bw + gap), v = sim[r.key].I_w;
      const gb = mkG(L);
      const rect = svg("rect", { x, y: 510, width: bw, height: 0, fill: r.color, stroke: C.ink, "stroke-width": 2 });
      const pat = svg("rect", { x, y: 510, width: bw, height: 0, fill: r.pat });
      const val = svg("text", { x: x + bw / 2, y: 500, "text-anchor": "middle", "font-size": 28, "font-weight": 700, fill: C.ink, style: "font-variant-numeric:tabular-nums" }, v.toFixed(3));
      const cat = svg("text", { x: x + bw / 2, y: 546, "text-anchor": "middle", "font-size": 22, "font-weight": 600, fill: C.ink }, r.label);
      const po = sim[r.key].p_orch;
      const sub = svg("text", { x: x + bw / 2, y: 574, "text-anchor": "middle", "font-size": 18, fill: C.ink2, class: "sec" }, `key agent hit: ${(po * 100).toFixed(1)}%`);
      gb.append(rect, pat, val, cat, sub);
      res.bars.push({ r, v, x, rect, pat, val, cat, sub, bw });
    });
    // "Nx lower" annotation: arrow from bar 1 to the last bar
    const first = res.bars[0], last = res.bars[res.bars.length - 1];
    if (res.bars.length > 1) {
      const y1 = y(first.v) - 56, y3 = y(last.v) - 56;
      const x1 = first.x + first.bw / 2 + 24, x3 = last.x + last.bw / 2 - 8;
      const path = svg("path", { d: `M${x1},${Math.max(y1, 56)} C${x1 + 220},${Math.max(y1, 56) - 10} ${x3 - 120},${y3 - 60} ${x3},${y3}`, fill: "none", stroke: C.ink, "stroke-width": 3, "stroke-linecap": "round", "marker-end": "url(#ah-solid)" });
      const ratio = last.v > 0 ? first.v / last.v : Infinity;
      const txt = svg("text", { x: (x1 + x3) / 2, y: Math.max(y1, 56) - 22, "text-anchor": "middle", "font-size": 22, "font-weight": 700, fill: C.ink }, isFinite(ratio) ? (ratio >= 100 ? "over 100x lower" : `${Math.round(ratio)}x lower`) : "eliminated");
      L.append(path, txt);
      res.arrow = path; res.ratioTxt = txt;
    }
  }
  A.sceneParts.push(buildResults);

  A.R = {
    apply(v) {
      const sc = A.scene;
      gsap.set(sc.L.results, { autoAlpha: v.results ? 1 : 0 });
      if (!sc.res || !sc.res.bars.length) return;
      sc.res.bars.forEach((b) => {
        const h = sc.res.baseY - sc.res.y(b.v), top = sc.res.baseY - h;
        for (const e of [b.rect, b.pat]) { e.setAttribute("y", top); e.setAttribute("height", h); }
        b.val.setAttribute("y", top - 10); b.val.textContent = b.v.toFixed(3);
        gsap.set([b.val, b.cat, b.sub], { opacity: 1 });
      });
      if (sc.res.arrow) { gsap.set(sc.res.arrow, { clearProps: "strokeDasharray,strokeDashoffset" }); gsap.set([sc.res.arrow, sc.res.ratioTxt], { opacity: 1 }); }
    },
    /** Add bar-growth tweens to timeline `tl` starting at `at`. Returns end time. */
    play(tl, at) {
      const res = A.scene.res; if (!res.bars.length) return at;
      let t = at;
      res.bars.forEach((b, i) => {
        const s = at + i * 0.25, d = A.dur(0.8);
        const h = res.baseY - res.y(b.v);
        const proxy = { f: 0 };
        tl.set([b.rect, b.pat], { attr: { y: res.baseY, height: 0 } }, 0);
        tl.set(b.val, { opacity: 0 }, 0);
        tl.set(b.val, { opacity: 1 }, s);
        tl.to(proxy, {
          f: 1, duration: d, ease: "power2.out", onUpdate() {
            const hh = h * proxy.f, top = res.baseY - hh;
            for (const e of [b.rect, b.pat]) { e.setAttribute("y", top); e.setAttribute("height", hh); }
            b.val.setAttribute("y", top - 10); b.val.textContent = (b.v * proxy.f).toFixed(3);
          },
        }, s);
        t = Math.max(t, s + d);
      });
      if (res.arrow) {
        tl.fromTo(res.arrow, { drawSVG: "0%" }, { drawSVG: "100%", duration: A.dur(0.9), ease: "power1.inOut" }, t);
        tl.fromTo(res.ratioTxt, { opacity: 0 }, { opacity: 1, duration: 0.4 }, t + 0.4);
        t += 1;
      }
      return t;
    },
  };
})(window.App);
