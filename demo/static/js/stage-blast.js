/* Two overlays on the real agent network:
 *   - blast radius (step 8): a checkpoint's agents glow, a wave runs along the arrows to every agent whose
 *     risk score is summed into rho, and the equation builds term by term in a panel under the graph;
 *   - coverage (step 11): agents without a guard of their own get a dashed "covered by" link from the
 *     guarded agent(s) that feed them. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, fmt } = A;
  const PANEL_X = 40, PANEL_W = 1520;

  /** S1, S2, ... by boundary, then S0 last (the entry door is the finale: it counts everything). */
  const orderCps = (plan) => plan.checkpoints.slice().sort((a, b) => (a.boundary < 0) - (b.boundary < 0) || a.boundary - b.boundary);

  /** Hop-by-hop waves from a checkpoint to the agents in rho_terms, following real edges only. */
  function waves(sc, cp) {
    const terms = cp.rho_terms.map((t) => t.id);
    const hit = new Set(), levels = [];
    const l0 = terms.filter((id) => cp.nodes.includes(id));
    if (l0.length) { levels.push({ ids: l0, web: true, src: {} }); l0.forEach((id) => hit.add(id)); }
    while (hit.size < terms.length) {
      const next = terms.filter((id) => !hit.has(id) && sc.edges.some((e) => e.to === id && (cp.nodes.includes(e.from) || hit.has(e.from))));
      if (!next.length) { levels.push({ ids: terms.filter((id) => !hit.has(id)), src: {}, orphan: true }); break; }
      const src = {};
      for (const id of next) src[id] = sc.edges.filter((e) => e.to === id && (cp.nodes.includes(e.from) || hit.has(e.from)));
      levels.push({ ids: next, src });
      next.forEach((id) => hit.add(id));
    }
    return levels;
  }

  // ------------------------------------------------------------------ build
  function buildBlast(sc) {
    const plan = sc.plan, order = orderCps(plan), n = order.length;
    const lineH = n <= 3 ? 34 : n === 4 ? 30 : 26, fs0 = n <= 3 ? 22 : n === 4 ? 20 : 18;
    const panelH = n * lineH + 18, panelTop = 640 - panelH - 8;
    const bl = sc.blast = { order, lines: {}, info: {}, panelTop, bottomU: panelTop - 8, g: mkG(sc.L.blast) };
    bl.g.appendChild(svg("rect", { x: PANEL_X, y: panelTop, width: PANEL_W, height: panelH, rx: 12, fill: "#fff", stroke: C.line, "stroke-width": 2 }));
    order.forEach((cp, i) => {
      const lv = waves(sc, cp);
      const ids = lv.flatMap((l) => l.ids);
      const w = {}; cp.rho_terms.forEach((t) => { w[t.id] = t.weight; });
      bl.info[cp.id] = { levels: lv, ids, w };
      // tokens: "rho(S1) =", then  term + term + ... , then "= total"
      const parts = [{ k: "lab", t: `ρ(${cp.id}) =`, wt: 800 }];
      ids.forEach((id, k) => {
        if (k > 0) parts.push({ k: "plus", t: "+", wt: 600 });
        parts.push({ k: "term", id, t: id, v: fmt(w[id]) });
      });
      parts.push({ k: "eq", t: "=", wt: 600 }, { k: "total", t: fmt(cp.rho), wt: 800 });
      const widthAt = (fs) => parts.reduce((a, p) => a + (p.k === "term" ? A.textW(p.t + " ", fs, 600) + A.textW(p.v, fs, 800) : A.textW(p.t, fs, p.wt)) + 12, 0) - 12;
      let fs = fs0;
      const tw = widthAt(fs);
      if (tw > PANEL_W - 40) fs = Math.max(13, Math.floor(fs * (PANEL_W - 40) / tw));
      const y = panelTop + 12 + i * lineH + lineH * 0.68;
      const ln = bl.lines[cp.id] = { cp, y, fs, g: mkG(bl.g, { class: "gate-hit", "data-id": cp.id, role: "img", "aria-label": `Blast radius of checkpoint ${cp.id}: ${fmt(cp.rho)}` }), parts: [] };
      ln.g.appendChild(svg("rect", { x: PANEL_X + 4, y: y - lineH * 0.68 - 2, width: PANEL_W - 8, height: lineH, rx: 8, fill: "transparent" }));
      ln.hl = svg("rect", { x: PANEL_X + 4, y: y - lineH * 0.68 - 2, width: PANEL_W - 8, height: lineH, rx: 8, fill: "#F1F5F9", opacity: 0 });
      ln.g.insertBefore(ln.hl, ln.g.firstChild);
      let x = PANEL_X + 22;
      for (const p of parts) {
        const g = mkG(ln.g);
        let width;
        if (p.k === "term") {
          const a = svg("tspan", { "font-weight": 600, fill: C.ink }, p.t + " "), b = svg("tspan", { "font-weight": 800, fill: C.st.compromised.stroke }, p.v);
          const t = svg("text", { x, y, "font-size": fs }); t.append(a, b); g.appendChild(t);
          width = A.textW(p.t + " ", fs, 600) + A.textW(p.v, fs, 800);
        } else {
          const fill = p.k === "lab" ? C.gate : p.k === "total" ? C.st.compromised.stroke : C.ink2;
          g.appendChild(svg("text", { x, y, "font-size": fs, "font-weight": p.wt, fill, style: "font-variant-numeric:tabular-nums" }, p.t));
          width = A.textW(p.t, fs, p.wt);
        }
        p.g = g; x += width + 12;
        ln.parts.push(p);
      }
    });
  }
  A.sceneParts.push(buildBlast);

  // ------------------------------------------------------------------ coverage links
  const preds = (sc, id) => sc.edges.filter((e) => e.to === id).map((e) => e.from);

  /** Guarded agents that every message into `id` must pass first: nearest guarded ancestors. */
  function guardedAncestors(sc, id) {
    const out = [], seen = new Set([id]), q = [id];
    while (q.length) {
      const u = q.shift();
      for (const p of preds(sc, u)) {
        if (seen.has(p)) continue; seen.add(p);
        if ((sc.plan.node_guards[p] || 0) > 0) out.push(p); else q.push(p);
      }
    }
    return out;
  }

  function buildCover(sc) {
    const plan = sc.plan, items = sc.cover = [];
    for (const n of plan.nodes) {
      if ((plan.node_guards[n.id] || 0) > 0) continue;
      const by = guardedAncestors(sc, n.id);
      if (!by.length) continue;
      const it = { id: n.id, by, links: [], tag: mkG(sc.L.cover) };
      for (const src of by) {
        const edge = sc.edges.find((e) => e.from === src && e.to === n.id) || null;
        const path = svg("path", { class: "cover-link", fill: "none", stroke: C.shield, "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": "2 11" });
        sc.L.cover.insertBefore(path, sc.L.cover.firstChild);
        it.links.push({ src, edge, path });
      }
      const txt = by.length <= 2 ? `covered by ${by.join(" + ")}` : `covered by ${by.length} guarded agents`;
      const w = A.textW(txt, 17, 700) + 52;
      it.w = w;
      it.tag.append(svg("rect", { x: -w / 2, y: -15, width: w, height: 30, rx: 15, fill: "#fff", stroke: C.shield, "stroke-width": 2.5, "stroke-dasharray": "6 4" }),
        svg("path", { d: A.SHIELD_D, fill: C.shieldFill, stroke: C.shield, "stroke-width": 3, transform: `translate(${-w / 2 + 19},0) scale(0.3)` }),
        svg("text", { x: 10, y: 6, "text-anchor": "middle", "font-size": 17, "font-weight": 700, fill: C.shield }, txt));
      A.pivot(it.tag);
      gsap.set(it.tag, { autoAlpha: 0 });
      items.push(it);
    }
  }
  A.sceneParts.push(buildCover);

  /** Recompute link geometry and tag positions from the current node geometry. */
  function layoutCover(sc) {
    for (const it of sc.cover) {
      const nv = sc.nodes[it.id];
      for (const l of it.links) {
        if (l.edge) { l.path.setAttribute("d", l.edge.d); continue; }
        const a = sc.nodes[l.src], top = Math.min(a.y, nv.y) - 38 * Math.max(a.sc, nv.sc) - 60;
        l.path.setAttribute("d", `M${a.x},${a.y - 38 * a.sc} C${a.x},${top} ${nv.x},${top} ${nv.x},${nv.y - 38 * nv.sc - 6}`);
      }
      gsap.set(it.tag, { x: Math.max(it.w / 2 + 8, Math.min(1592 - it.w / 2, nv.x)), y: nv.y + 38 * nv.sc + 28 });
    }
  }

  // ------------------------------------------------------------------ public API
  A.X = {
    orderCps,

    /** Snap the overlays to a view descriptor. v.blast: falsy | "end" (all equations + the S0 end state). */
    apply(v) {
      const sc = A.scene, bl = sc.blast, end = v.blast === "end";
      gsap.set(bl.g, { autoAlpha: v.blast ? 1 : 0 });
      for (const cp of bl.order) {
        const ln = bl.lines[cp.id];
        gsap.set(ln.parts.map((p) => p.g), { autoAlpha: end ? 1 : 0, scale: 1 });
        gsap.set(ln.hl, { opacity: 0 });
      }
      if (end) {
        const s0 = bl.order[bl.order.length - 1], ids = new Set(s0.rho_terms.map((t) => t.id));
        for (const id of sc.ids) {
          const nv = sc.nodes[id];
          A.G.setState(nv, ids.has(id) ? "exposed" : "idle", 0);
          A.G.setGate(nv, s0.nodes.includes(id), s0.id, 0);
        }
      }
      if (v.squeeze) A.G.squeeze(bl.bottomU, 0);
      layoutCover(sc);
      for (const it of sc.cover) {
        gsap.set(it.tag, { autoAlpha: v.covered ? 1 : 0, scale: 1 });
        for (const l of it.links) gsap.set(l.path, { autoAlpha: v.covered ? 1 : 0 });
      }
    },

    /** Everything back to neutral on the network (between checkpoint phases). */
    clearNodes(tl, at, dur) {
      const sc = A.scene;
      for (const id of sc.ids) {
        const nv = sc.nodes[id];
        A.G.setState(nv, "idle", dur, tl, at);
        A.G.setGate(nv, false, "", dur, tl, at);
      }
      for (const e of sc.edges) A.G.edgeStyle(e, "default", dur, tl, at);
    },

    /** One checkpoint: glow, wave along the arrows, equation grows term by term. `eq` false = replay without the panel. */
    phase(tl, at, cp, eq) {
      const sc = A.scene, bl = sc.blast, info = bl.info[cp.id], ln = bl.lines[cp.id];
      const isS0 = cp.boundary < 0;
      let t = at;
      if (eq) tl.fromTo(ln.parts[0].g, { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, duration: 0.4 }, t);
      tl.to(ln.hl, { opacity: 1, duration: 0.3 }, t);
      for (const id of cp.nodes) {
        const nv = sc.nodes[id];
        A.G.setState(nv, "gate", 0.35, tl, t);
        A.G.setGate(nv, true, cp.id, 0.35, tl, t);
        if (!A.rm()) tl.fromTo(nv.gtag, { scale: 0.5 }, { scale: 1, duration: 0.35, ease: "back.out(2.4)" }, t);
      }
      if (isS0) {
        tl.fromTo([sc.websiteG, sc.hidden, ...sc.webEdges.map((e) => e.el)], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, t);
      }
      t += 0.9;
      let seq = 0;
      info.levels.forEach((lv) => {
        let end = t + A.dur(0.7);
        for (const id of lv.ids) {
          const nv = sc.nodes[id];
          let srcs = lv.web ? sc.webEdges.filter((w) => w.to === id) : (lv.src[id] || []);
          srcs.forEach((e, k) => {
            const tok = A.fx.token(sc.L.tmp, "attack");
            const a = t + k * 0.08;
            const fin = A.fx.travel(tl, tok, e, a, A.dur(0.7), ++seq);
            A.G.edgeStyle(e, "hot", 0.2, tl, a + 0.05);
            tl.to(tok.all, { autoAlpha: 0, scale: 0.2, duration: 0.15 }, a + A.dur(0.7));
            end = Math.max(end, fin);
          });
          const arrive = srcs.length ? t + A.dur(0.7) : t + 0.1;
          A.G.setState(nv, "exposed", 0.3, tl, arrive);
          if (!A.rm()) tl.to(nv.g, { x: nv.x + 4, duration: 0.04, repeat: 3, yoyo: true }, arrive).set(nv.g, { x: nv.x }, arrive + 0.2);
          popup(tl, nv, info.w[id], arrive);
          if (eq) {
            const k = info.ids.indexOf(id);
            const pi = k === 0 ? [ln.parts.findIndex((p) => p.k === "term")] : [ln.parts.findIndex((p) => p.k === "term" && p.id === id) - 1, ln.parts.findIndex((p) => p.k === "term" && p.id === id)];
            for (const j of pi) tl.fromTo(ln.parts[j].g, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power2.out" }, arrive);
          }
        }
        t = end + 0.15;
      });
      if (eq) {
        const eqI = ln.parts.findIndex((p) => p.k === "eq");
        tl.fromTo(ln.parts[eqI].g, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, t);
        tl.fromTo(ln.parts[eqI + 1].g, { autoAlpha: 0, scale: 0.6, transformOrigin: "0% 50%" }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(2)" }, t + 0.15);
      }
      t += 1.4;
      tl.to(ln.hl, { opacity: 0, duration: 0.3 }, t);
      return t + 0.1;
    },
  };

  /** Floating "+4.5" that rises from an agent as its score is added to rho. */
  function popup(tl, nv, w, at) {
    if (A.rm()) return;
    const t = svg("text", { "text-anchor": "middle", "font-size": 26, "font-weight": 800, fill: C.st.compromised.stroke, stroke: "#fff", "stroke-width": 5, "paint-order": "stroke" }, "+" + fmt(w));
    A.scene.L.tmp.appendChild(t);
    gsap.set(t, { x: nv.x + 84 * nv.sc - 10, y: nv.y - 38 * nv.sc - 6, autoAlpha: 0 });
    tl.to(t, { autoAlpha: 1, duration: 0.15 }, at).to(t, { y: nv.y - 38 * nv.sc - 44, autoAlpha: 0, duration: 0.9, ease: "power1.out" }, at + 0.25);
  }
})(window.App);
