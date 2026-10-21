/* Linear (path-decomposition) view: bag columns, agent pills over their bag intervals,
 * checkpoint gates at bag boundaries, and the blast-radius counter. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, fmt } = A;
  const X0 = 320, X1 = 1560, COL_Y = 76, COL_H = 424, GATE_Y0 = 60, GATE_Y1 = COL_Y + COL_H;

  function build(sc) {
    const plan = sc.plan, nb = plan.bags.length;
    const pitch = (X1 - X0) / nb;
    const lin = { nb, pitch, cols: [], pills: {}, gates: {}, order: [] };
    sc.lin = lin;
    lin.gateX = (b) => X0 + (b + 1) * pitch;
    lin.gatesH = () => GATE_Y1 - GATE_Y0;
    const colL = (i) => X0 + i * pitch + 10, colR = (i) => X0 + (i + 1) * pitch - 10;

    // columns
    lin.colsG = mkG(sc.L.lin);
    plan.bags.forEach((bag, i) => {
      const gg = mkG(lin.colsG);
      gg.append(svg("rect", { x: colL(i), y: COL_Y, width: pitch - 20, height: COL_H, rx: 10, fill: C.bags[i % C.bags.length], stroke: C.grid, "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
      gg.append(svg("text", { x: (colL(i) + colR(i)) / 2, y: COL_Y + 27, "text-anchor": "middle", "font-size": 18, "font-weight": 700, fill: C.ink2 }, "B" + (i + 1)));
      lin.cols.push(gg);
    });

    // pills, rows ordered by first column then by last column
    const spans = plan.node_spans;
    const ids = [...sc.ids].sort((a, b) => (spans[a][0] - spans[b][0]) || (spans[a][1] - spans[b][1]) || (a < b ? -1 : 1));
    lin.order = ids;
    const row0 = COL_Y + 64;
    const rowH = Math.min(56, (COL_Y + COL_H - 34 - row0) / Math.max(1, ids.length - 1));
    lin.pillsG = mkG(sc.L.lin);
    ids.forEach((id, r) => {
      const [f, l] = spans[id];
      const left = colL(f) + 6, right = colR(l) - 6, w = right - left;
      const nv = sc.nodes[id];
      const p = { id, cx: (left + right) / 2, cy: row0 + r * rowH, w, state: "idle" };
      p.g = mkG(lin.pillsG, { role: "img", "aria-label": `Agent ${id}: active in bags B${f + 1} to B${l + 1}` });
      p.hl = svg("rect", { x: -w / 2 - 5, y: -25, width: w + 10, height: 50, rx: 25, fill: "none", stroke: C.ink, "stroke-width": 3.5, opacity: 0 });
      p.body = svg("rect", { x: -w / 2, y: -20, width: w, height: 40, rx: 20, fill: C.st.idle.fill, stroke: C.st.idle.stroke, "stroke-width": 2 });
      p.hatch = svg("rect", { x: -w / 2, y: -20, width: w, height: 40, rx: 20, fill: "url(#hatch-red)", opacity: 0 });
      p.g.append(svg("rect", { x: -w / 2 - 16, y: -30, width: w + 32, height: 60, fill: "none", "pointer-events": "none" }), p.hl, p.body, p.hatch);
      A.icon(p.g, A.roleIcon(nv.n), -w / 2 + 24, 0, 20);
      p.label = svg("text", { x: -w / 2 + 42, y: 6, "font-weight": 600, fill: C.ink }, id);
      A.fitText(p.label, id, Math.max(40, w - 42 - 58), 18, 18, 600);
      p.g.appendChild(p.label);
      const badge = mkG(p.g); gsap.set(badge, { x: w / 2 - 28, y: 0 });
      badge.append(svg("rect", { x: -20, y: -14, width: 40, height: 28, rx: 14, fill: C.ink, stroke: "#fff", "stroke-width": 2 }),
        svg("text", { y: 6, "text-anchor": "middle", "font-size": 18, "font-weight": 700, fill: "#fff", style: "font-variant-numeric:tabular-nums" }, fmt(nv.weight)));
      p.bug = mkG(p.g); gsap.set(p.bug, { x: -w / 2 + 2, y: -14, autoAlpha: 0 });
      p.bug.append(svg("circle", { r: 12, fill: C.st.compromised.stroke, stroke: "#fff", "stroke-width": 2 }));
      A.icon(p.bug, "bug", 0, 0, 16, "#fff");
      A.pivot(p.g); A.pivot(p.bug);
      lin.pills[id] = p;
    });

    // gates
    lin.gatesG = mkG(sc.L.lin);
    for (const cp of plan.checkpoints) {
      // S0 is the door from the outside world, not a bag boundary: park it left of every
      // column and point it at the entry agents it actually checks.
      const gx = cp.boundary < 0 ? X0 - 30 : lin.gateX(cp.boundary);
      const gt = { id: cp.id, cp, x: gx };
      gt.g = mkG(lin.gatesG, { class: "gate-hit", role: "img", "aria-label": `Checkpoint ${cp.id}, blast radius ${fmt(cp.rho)}`, "data-id": cp.id });
      gsap.set(gt.g, { x: gx });
      if (cp.boundary < 0) {
        for (const id of cp.nodes) {
          const p = lin.pills[id];
          if (!p) continue;
          const x2 = p.cx - p.w / 2 - gx - 6;
          gt.g.append(
            svg("line", { x1: 8, y1: p.cy, x2: x2 - 8, y2: p.cy, stroke: C.gate, "stroke-width": 2.5, "stroke-dasharray": "6 6", "stroke-linecap": "round", opacity: 0.7 }),
            svg("path", { d: `M${x2 - 12},${p.cy - 7} L${x2},${p.cy} L${x2 - 12},${p.cy + 7} Z`, fill: C.gate, opacity: 0.8 }));
        }
      }
      gt.bar = svg("rect", { x: -5, y: GATE_Y0, width: 10, height: GATE_Y1 - GATE_Y0, rx: 5, fill: C.gate });
      gt.hit = svg("rect", { x: -22, y: GATE_Y0 - 40, width: 44, height: GATE_Y1 - GATE_Y0 + 40, fill: "transparent" });
      gt.tab = mkG(gt.g); gsap.set(gt.tab, { y: 22, transformOrigin: "50% 50%" });
      gt.tabBg = svg("rect", { x: -30, y: -16, width: 60, height: 32, rx: 8, fill: C.stage || "#fff", stroke: C.gate, "stroke-width": 2.5 });
      gt.tab.appendChild(gt.tabBg);
      gt.ic = A.icon(gt.tab, cp.boundary < 0 ? "arrowIn" : "lock", -17, 0, 15, C.gate);
      gt.txt = svg("text", { x: 8, y: 7, "text-anchor": "middle", "font-size": 20, "font-weight": 700, fill: C.ink }, cp.id);
      gt.tab.appendChild(gt.txt);
      gt.g.prepend(gt.hit); gt.g.insertBefore(gt.bar, gt.tab);
      lin.gates[cp.id] = gt;
    }

    // blast-radius counter (left region)
    const rc = lin.rho = { g: mkG(sc.L.lin), val: { v: 0 } };
    gsap.set(rc.g, { x: 40, y: 96 });
    rc.g.append(svg("rect", { width: 236, height: 116, rx: 10, fill: "#fff", stroke: C.line, "stroke-width": 2 }));
    rc.g.append(svg("text", { x: 14, y: 28, "font-size": 18, "font-weight": 600, fill: C.ink2 }, "Blast radius (ρ)"));
    rc.num = svg("text", { x: 14, y: 72, "font-size": 44, "font-weight": 700, fill: C.ink, style: "font-variant-numeric:tabular-nums" }, "0");
    rc.sub = svg("text", { x: 14, y: 102, "font-size": 18, "font-weight": 600, fill: C.ink2 }, "");
    rc.gate = svg("text", { x: 222, y: 28, "text-anchor": "end", "font-size": 18, "font-weight": 700, fill: C.gate }, "");
    rc.g.append(rc.num, rc.sub, rc.gate);
  }
  A.sceneParts.push(build);

  const dsAgents = (cp) => `${cp.downstream.length} agent${cp.downstream.length === 1 ? "" : "s"} downstream`;

  A.L = {
    X0, X1, COL_Y, COL_H,

    setPillState(p, hit, dur, tl, at) {
      p.state = hit ? "hit" : "idle";
      A.tw(tl, p.body, { attr: { fill: hit ? C.st.compromised.fill : C.st.idle.fill, stroke: hit ? C.st.compromised.stroke : C.st.idle.stroke } }, dur, at);
      A.tw(tl, p.hatch, { opacity: hit ? 1 : 0 }, dur, at);
      A.tw(tl, p.bug, { autoAlpha: hit ? 1 : 0 }, dur, at);
    },

    setRho(cp) {
      const rc = A.scene.lin.rho;
      rc.num.textContent = cp ? fmt(cp.rho) : "0";
      rc.sub.textContent = cp ? dsAgents(cp) : "";
      rc.gate.textContent = cp ? cp.id : "";
    },
    dsAgents,

    /** Emphasise one gate (thick bar, filled tab) and dim the others; `id` null = all normal. */
    emphasise(id, dur, tl, at) {
      const lin = A.scene.lin;
      for (const k of Object.keys(lin.gates)) {
        const gt = lin.gates[k], on = id === k;
        A.tw(tl, gt.bar, { attr: { x: on ? -8 : -5, width: on ? 16 : 10, fill: on ? C.st.compromised.stroke : C.gate } }, dur, at);
        A.tw(tl, gt.tabBg, { attr: { fill: on ? C.ink : "#fff" } }, dur, at);
        gt.txt.setAttribute("fill", on ? "#fff" : C.ink);
        A.tw(tl, gt.g, { opacity: id && !on ? 0.45 : 1 }, dur, at);
      }
    },

    /** Snap the linear layer to a view descriptor. */
    apply(v) {
      const sc = A.scene, lin = sc.lin, plan = sc.plan;
      gsap.set(lin.colsG, { autoAlpha: v.lin ? (v.pillsDim ? 0.55 : 1) : 0 });
      lin.cols.forEach((c) => gsap.set(c, { autoAlpha: 1 }));
      const hitCp = v.hit ? plan.checkpoints.find((c) => c.id === v.hit) : null;
      for (const id of lin.order) {
        const p = lin.pills[id];
        gsap.set(p.g, { x: p.cx, y: p.cy, scale: 1, autoAlpha: v.pills ? (v.pillsDim ? 0.3 : 1) : 0 });
        A.L.setPillState(p, !!(hitCp && hitCp.downstream.includes(id)), 0);
        gsap.set(p.hl, { opacity: 0 });
      }
      for (const cp of plan.checkpoints) {
        const gt = lin.gates[cp.id];
        gt.bar.setAttribute("height", GATE_Y1 - GATE_Y0);
        gsap.set(gt.g, { autoAlpha: v.gates ? 1 : 0, x: gt.x });
        gsap.set(gt.tab, { scale: 1, y: 22 });
      }
      A.L.emphasise(hitCp ? hitCp.id : null, 0);
      gsap.set(lin.rho.g, { autoAlpha: v.rho ? 1 : 0 });
      A.L.setRho(v.rho ? plan.checkpoints.find((c) => c.id === v.rho) : null);
      lin.rho.val.v = v.rho ? plan.checkpoints.find((c) => c.id === v.rho).rho : 0;
    },
  };
})(window.App);
