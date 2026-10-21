/* Step controller: 14 frames (0-13). Each step has
 *   VIEW[n]   - the complete end state (applied instantly and idempotently by snap()), and
 *   PLAY[n]   - a GSAP timeline that animates the transition from VIEW[n-1] to VIEW[n].
 * Moving forward one step plays the timeline then re-applies VIEW[n]; jumping or going back snaps. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, fmt, $ } = A;

  // ---------------------------------------------------------------- end-state views
  const DEF = {
    title: 0, watermark: 0, net: 0, edges: 0, website: 0, entry: 0, legend: 0, tray: 0, star: 0, holds: 0,
    scaled: 0, scores: 0, nodeState: "idle", hot: 0, nodeShields: 0,
    lin: 0, pills: 0, pillsDim: 0, gates: 0, rho: null, hit: null,
    pot: 0, ghost: 0, coins: 0, bars: 0, gShields: 0, results: 0,
  };
  const VIEW = [
    { title: 1, watermark: 1 },
    { net: 1, edges: 1, legend: 1 },
    { net: 1, edges: 1, website: 1, entry: 1, legend: 1 },
    { net: 1, edges: 1, website: 1, entry: 1, star: 1, holds: 1, nodeState: "infected", hot: 1 },
    { net: 1, edges: 1, tray: 1, star: 1, scaled: 1, scores: 1 },
    { lin: 1, pills: 1 },
    { lin: 1, pills: 1, gates: 1 },
    { lin: 1, pills: 1, gates: 1, rho: "S0", hit: "S0" },
    { lin: 1, pills: 1, pillsDim: 1, gates: 1, pot: 1, ghost: 1, coins: "placed", bars: 1 },
    { lin: 1, pills: 1, pillsDim: 1, gates: 1, gShields: 1 },
    { net: 1, edges: 1, star: 1, scaled: 1, scores: 1, nodeShields: 1 },
    { net: 1, edges: 1, website: 1, star: 1, scaled: 1, scores: 1 },
    { net: 1, edges: 1, website: 1, star: 1, scaled: 1, scores: 1, nodeShields: 1 },
    { results: 1 },
  ];
  const view = (n) => Object.assign({}, DEF, VIEW[n]);

  const TITLES = ["Title", "The team", "The threat", "Why it is dangerous", "Risk scores", "Linearize", "Checkpoints",
    "Blast radius", "Budget", "Guards", "Back to the network", "Live run: no defence", "Live run: defended", "The numbers"];
  const ACCENT = ["#44505F", "#16202D", "#B45309", "#B42318", "#8A6100", "#1D4ED8", "#334155", "#B42318", "#8A6100", "#1D4ED8", "#1D4ED8", "#B42318", "#17744F", "#17744F"];

  // ---------------------------------------------------------------- captions: arrays of strings, {b: bold}
  function captions(plan) {
    const n = plan.nodes.length, ent = plan.nodes.filter((x) => x.entry).length;
    const cps = plan.checkpoints, B = plan.budget;
    const strongest = cps.reduce((a, c) => (c.guards > a.guards ? c : a), cps[0]);
    const sim = plan.sim || {};
    const p = (k) => (sim[k] ? (sim[k].I_w * 100).toFixed(1) + "%" : "n/a");
    const uni = plan.alloc === "uniform";
    return [
      ["Can one poisoned web page take over a whole team of AI helpers?"],
      [`${n} AI agents work as a team on a security test. Each one passes its findings to the next.`],
      [`The target website is hostile. It hides a secret instruction (a `, { b: "prompt injection" }, `) in the page the first ${ent} agents read.`],
      ["The hidden instruction spreads from agent to agent until the one holding the credentials (passwords) is taken over."],
      ["Each agent gets a ", { b: "risk score" }, " from what it is allowed to do. Bigger means more damage if it is taken over."],
      ["We lay the team out in a line: each agent is a bar over the ", { b: "bags" }, " (groups of agents) where it is active. Bag order comes from an elimination order, not the data flow."],
      ["A ", { b: "checkpoint" }, " (gate) sits where agents hand work to each other. S0 guards the door from the outside world."],
      ["If an attack slips past a gate, everything downstream is exposed (", { b: "blast radius" }, ", ρ). " + cps.map((c) => `${c.id}: ρ\u00A0=\u00A0${fmt(c.rho)}`).join(", ") + "."],
      [`We only have `, { b: `${B} guards` }, ` to spend. ` + (uni ? "Splitting evenly ignores where the damage would be biggest." : "Putting more where the damage would be biggest beats splitting evenly (the even split is rounded to whole guards).")],
      ["Each spent coin is one more independent checker (", { b: "guard" }, `). With ${strongest.guards} guards, about ${Math.round(strongest.p_block * 100)}% of attacks are caught.`],
      ["Back on the real team: shields mark the agents with guards. These are the ones that check incoming messages."],
      ["A real run with ", { b: "no protection" }, ". Watch the hidden instruction travel from the website to the key agent."],
      ["Now the guards vote on each message. If ", { b: "any" }, " guard says BLOCK, the message is thrown away and the agent's memory is wiped."],
      sim.none ? [`Share of the team's risk that gets compromised: ${p("none")} with no defence, ${p("uniform")} with equal guards, ${p("risk")} with our risk-based split.`] : ["No simulation data for this team."],
    ];
  }

  // ---------------------------------------------------------------- state
  const ST = { cur: -1, tl: null, dwell: null, pending: null };
  const sc = () => A.scene;
  const isLive = (n) => n === 11 || n === 12;

  /** Kill the running step timeline and settle the promise that goTo()/play() handed out for it,
   *  so nothing awaiting a step (the autoplay tick) is left hanging. The autoplay dwell timer is NOT
   *  touched here: only stopPlay() ends autoplay. */
  function killTl() {
    if (ST.tl) { ST.tl.kill(); ST.tl = null; }
    gsap.killTweensOf(sc() ? [sc().L.live] : []);
    const r = ST.pending; ST.pending = null;
    if (r) r();
  }
  function clearTmp() {
    const s = sc(); if (!s) return;
    s.L.tmp.replaceChildren(); s.L.fx.replaceChildren();
    gsap.set(s.L.fx, { autoAlpha: 1 });
  }
  function applyView(n) {
    const v = view(n), s = sc();
    A.G.apply(v); A.L.apply(v); A.B.apply(v); A.R.apply(v);
    gsap.set(s.L.live, { opacity: 1 });
    A.G.compact(isLive(n) && A.logs.isOpen(), 0);
  }

  // ---------------------------------------------------------------- chrome (caption, dots, counters)
  function setCaption(n, animate) {
    const p = $("caption"), s = sc();
    const parts = captions(s.plan)[n];
    const fill = () => {
      p.style.fontSize = "";
      p.replaceChildren(...parts.map((x) => (typeof x === "string" ? document.createTextNode(x) : A.el("strong", null, x.b))));
      const bar = $("caption-bar");
      let fs = parseFloat(getComputedStyle(p).fontSize), guard = 0;
      while (p.getBoundingClientRect().height > bar.clientHeight - 4 && fs > 18 && guard++ < 12) { fs -= 2; p.style.fontSize = fs + "px"; }
    };
    $("caption-bar").style.borderLeftColor = ACCENT[n];
    document.documentElement.style.setProperty("--accent", ACCENT[n]);
    if (animate && !A.rm()) {
      gsap.to(p, { opacity: 0, duration: 0.15, onComplete: () => { fill(); gsap.to(p, { opacity: 1, duration: 0.25 }); } });
    } else { gsap.killTweensOf(p); fill(); gsap.set(p, { opacity: 1 }); }
  }

  function chrome(n, animateCaption) {
    $("step-counter").textContent = `Step ${n} / ${A.LAST_STEP}`;
    document.querySelectorAll("#dots .dot").forEach((d, i) => {
      d.classList.toggle("done", i < n); d.classList.toggle("cur", i === n);
      d.setAttribute("aria-current", i === n ? "step" : "false");
    });
    const live = isLive(n);
    $("live-badge").hidden = !live || !A.state.running;
    if (!live) { A.showVerdict(null); $("stage-msg").hidden = true; }
    setCaption(n, animateCaption);
    A.emit("chrome", n);
  }

  // ---------------------------------------------------------------- snap / play
  function snap(n) {
    killTl(); clearTmp();
    ST.cur = n;
    applyView(n);
    chrome(n, false);
    window.__stepReady = n;
    A.emit("stepready", n);
  }

  function finish(n) {
    ST.tl = null;
    clearTmp();
    applyView(n);
    window.__stepReady = n;
    A.emit("stepready", n);
  }

  function play(n) {
    killTl(); clearTmp();
    const prev = n - 1;
    ST.cur = n;
    applyView(prev);
    gsap.set($("svg"), { opacity: 1 });
    chrome(n, true);
    const tl = gsap.timeline();
    ST.tl = tl;
    PLAY[n](tl, sc());
    return new Promise((res) => {
      ST.pending = res;
      const done = () => { ST.pending = null; finish(n); res(); };
      tl.eventCallback("onComplete", done);
      if (tl.duration() <= 0) done();
    });
  }

  function fadeSwitch(n) {                       // reduced motion: 0.2s cross-fade to the end state
    killTl(); clearTmp();
    ST.cur = n;
    chrome(n, false);
    const root = $("svg"), tl = gsap.timeline();
    ST.tl = tl;
    tl.to(root, { opacity: 0, duration: 0.1 });
    tl.call(() => applyView(n));
    tl.to(root, { opacity: 1, duration: 0.1 });
    return new Promise((res) => {
      ST.pending = res;
      tl.eventCallback("onComplete", () => { ST.pending = null; finish(n); res(); });
    });
  }

  /** Navigate. Animates only for a single forward step; everything else snaps.
   *  opts.snap     never animate.
   *  opts.fromLive navigation issued by the live run itself (exempt from the abort-on-navigate rule).
   *  opts.auto     issued by the autoplay tick (does not cancel autoplay); any other call is manual and does. */
  function goTo(n, opts) {
    opts = opts || {};
    n = Math.max(0, Math.min(A.LAST_STEP, n));
    if (!opts.auto && !opts.fromLive) stopPlay();
    if (A.state.running && !(opts.fromLive && isLive(n))) A.live.abort();
    const forward = ST.cur >= 0 && n === ST.cur + 1 && !opts.snap;
    if (forward) return A.rm() ? fadeSwitch(n) : play(n);
    snap(n);
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- helpers for PLAY
  const byX = () => sc().ids.slice().sort((a, b) => sc().nodes[a].x - sc().nodes[b].x);
  const fadeOut = (tl, targets, at, d) => tl.to(targets, { autoAlpha: 0, duration: d || 0.3 }, at);
  const arc = (x0, y0, x1, y1) => `M${x0},${y0} C${x0 + (x1 - x0) * 0.15},${y0 - 150} ${x1 - (x1 - x0) * 0.15},${y1 + 120} ${x1},${y1}`;

  // ---------------------------------------------------------------- per-step transitions
  const PLAY = {
    0(tl) { tl.fromTo(sc().L.title, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "power2.out" }, 0); },

    1(tl, s) {
      fadeOut(tl, [s.L.title, s.L.watermark], 0);
      byX().forEach((id, i) => {
        const nv = s.nodes[id];
        tl.fromTo(nv.g, { autoAlpha: 0, y: nv.y + 12 }, { autoAlpha: 1, y: nv.y, duration: 0.5, ease: "power2.out" }, 0.2 + i * 0.08);
      });
      s.edges.forEach((e, i) => {
        const at = 0.7 + i * 0.05;
        tl.call(() => e.el.removeAttribute("marker-end"), null, 0);
        tl.fromTo(e.el, { drawSVG: "0%", autoAlpha: 1 }, { drawSVG: "100%", duration: 0.6, ease: "power1.inOut" }, at);
        tl.call(() => e.el.setAttribute("marker-end", "url(#ah)"), null, at + 0.6);
      });
      tl.fromTo(s.L.legend, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 1.3);
    },

    2(tl, s) {
      tl.fromTo([s.websiteG], { x: s.web.x - 140, autoAlpha: 0 }, { x: s.web.x, autoAlpha: 1, duration: 0.6, ease: "power2.out" }, 0);
      s.webEdges.forEach((e, i) => tl.fromTo(e.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.5 + i * 0.1));
      tl.fromTo(s.hidden, { autoAlpha: 0, x: s.web.x - 140 }, { autoAlpha: 1, x: s.web.x, duration: 0.5 }, 0.7);
      tl.fromTo(s.hidden.querySelector("rect"), { opacity: 1 }, { opacity: 0.45, duration: 0.5, yoyo: true, repeat: 5, ease: "sine.inOut" }, 1.2);
      s.plan.nodes.filter((n) => n.entry).forEach((n) => {
        const nv = s.nodes[n.id];
        tl.to([nv.entryRing, nv.tag], { autoAlpha: 1, duration: 0.3 }, 0.9);
        tl.fromTo(nv.entryRing, { scale: 1, transformOrigin: "50% 50%" }, { scale: 1.06, duration: 0.5, yoyo: true, repeat: 5, ease: "sine.inOut" }, 1.2);
      });
    },

    3(tl, s) {
      fadeOut(tl, s.L.legend, 0, 0.3);
      const waves = A.G.infectionWaves();
      let t = 0.4, seq = 0;
      const done = new Set();
      waves.forEach((wave, wi) => {
        let waveEnd = t;
        for (const id of wave) {
          const nv = s.nodes[id];
          const srcs = wi === 0 ? s.webEdges.filter((w) => w.to === id) : s.edges.filter((e) => e.to === id && done.has(e.from));
          let arrive = t + (A.rm() ? 0.2 : 0.9);
          srcs.forEach((e, k) => {
            const tok = A.fx.token(s.L.tmp, "attack");
            const at = t + k * 0.1;
            const fin = A.fx.travel(tl, tok, e, at, 0.9, ++seq);
            A.G.edgeStyle(e, "hot", 0.2, tl, at + 0.1);
            tl.to(tok.all, { autoAlpha: 0, scale: 0.2, duration: 0.2 }, at + 0.9);
            arrive = Math.max(arrive, at + 0.9);
            waveEnd = Math.max(waveEnd, fin);
          });
          A.G.setState(nv, "compromised", 0.35, tl, arrive);
          tl.to(nv.g, { x: nv.x + 4, duration: 0.04, repeat: 3, yoyo: true }, arrive).set(nv.g, { x: nv.x }, arrive + 0.2);
          if (nv.n.critical) {
            tl.to(nv.star, { autoAlpha: 1, duration: 0.3 }, arrive);
            tl.fromTo(nv.star, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2)" }, arrive);
            tl.to(nv.holds, { autoAlpha: 1, duration: 0.3 }, arrive + 0.2);
          }
        }
        wave.forEach((id) => done.add(id));
        t = waveEnd;
      });
      tl.set({}, {}, t + 1.2);                       // hold the all-red frame
    },

    4(tl, s) {
      // reset to idle, drop the website, bring in the chip tray
      for (const id of s.ids) A.G.setState(s.nodes[id], "idle", 0.3, tl, 0);
      for (const e of s.edges) A.G.edgeStyle(e, "default", 0.3, tl, 0);
      fadeOut(tl, [s.websiteG, s.hidden, ...s.webEdges.map((e) => e.el)], 0);
      for (const id of s.ids) { const nv = s.nodes[id]; fadeOut(tl, [nv.entryRing, nv.tag, nv.holds], 0); }
      tl.fromTo(s.L.tray, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.2);
      // chips fly into agents; each landing ticks the score badge
      let k = 0, tEnd = 0.8;
      byX().forEach((id) => {
        const nv = s.nodes[id], cbs = nv.n.cap_breakdown || [];
        const total = cbs.reduce((a, c) => a + c.points, 0);
        nv.shown = nv.weight - total; nv.scoreTxt.textContent = fmt(nv.shown);
        tl.fromTo(nv.score, { scale: 0, autoAlpha: 1 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(2)" }, 0.6);
        cbs.forEach((cb) => {
          const src = s.tray[cb.cap + "|" + cb.points]; if (!src) return;
          const clone = A.fx.chipEl(`${cb.cap} +${fmt(cb.points)}`, src.w, cb.points);
          s.L.fx.appendChild(clone);
          const at = 0.9 + k++ * 0.12;
          gsap.set(clone, { x: src.x, y: src.y, autoAlpha: 0 });
          tl.set(clone, { autoAlpha: 1 }, at);
          tl.to(clone, { motionPath: { path: arc(src.x, src.y, nv.x, nv.y), autoRotate: false }, duration: 0.7, ease: "power2.inOut" }, at);
          tl.to(clone, { scale: 0.2, autoAlpha: 0, duration: 0.2 }, at + 0.7);
          tl.call(() => { nv.shown += cb.points; nv.scoreTxt.textContent = fmt(Math.min(nv.shown, nv.weight)); }, null, at + 0.75);
          tEnd = Math.max(tEnd, at + 0.95);
        });
      });
      const px = { f: 0 }, from = {}, to = {};
      for (const id of s.ids) { from[id] = 1; to[id] = A.G.sizeScale(s, s.nodes[id].weight); }
      tl.to(px, {
        f: 1, duration: 0.7, ease: "power2.inOut", onUpdate() {
          for (const id of s.ids) A.G.setScale(s.nodes[id], from[id] + (to[id] - from[id]) * px.f);
          A.G.redrawEdges(s);
        },
      }, tEnd);
    },

    5(tl, s) {
      fadeOut(tl, [s.L.tray], 0);
      s.edges.forEach((e) => fadeOut(tl, e.el, 0, 0.35));
      const lin = s.lin;
      tl.fromTo(lin.colsG, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01 }, 0.4);
      lin.cols.forEach((c, i) => tl.fromTo(c, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.5 + i * 0.07));
      lin.order.forEach((id, i) => {
        const p = lin.pills[id], nv = s.nodes[id], at = 0.25 + i * 0.07;
        tl.set(p.g, { x: nv.x, y: nv.y, scale: 0.7, autoAlpha: 0 }, 0);
        tl.to(nv.g, { x: p.cx, y: p.cy, scale: 0.55, duration: 0.9, ease: "power3.inOut" }, at);
        tl.to(nv.g, { autoAlpha: 0, duration: 0.3 }, at + 0.55);
        tl.to(p.g, { x: p.cx, y: p.cy, scale: 1, autoAlpha: 1, duration: 0.9, ease: "power3.inOut" }, at + 0.1);
      });
    },

    6(tl, s) {
      const order = s.plan.checkpoints.slice().sort((a, b) => (a.boundary < 0) - (b.boundary < 0) || a.boundary - b.boundary);
      let t = 0.2;
      for (const cp of order) {
        const gt = s.lin.gates[cp.id];
        for (const id of cp.nodes) { const p = s.lin.pills[id]; if (p) { tl.to(p.hl, { opacity: 1, duration: 0.25 }, t).to(p.hl, { opacity: 0, duration: 0.3 }, t + 1.0); } }
        tl.set(gt.g, { autoAlpha: 1 }, t + 0.2);
        tl.fromTo(gt.bar, { attr: { height: 0 } }, { attr: { height: s.lin.gatesH() }, duration: 0.5, ease: "power2.out" }, t + 0.2);
        tl.fromTo(gt.tab, { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(2)" }, t + 0.2);
        t += 1.1;
      }
    },

    7(tl, s) { blastSequence(tl, s, 0, s.plan.checkpoints.slice().sort((a, b) => (a.boundary < 0) - (b.boundary < 0) || a.boundary - b.boundary), true); },

    8(tl, s) {
      const bud = s.bud, lin = s.lin;
      // leave the blast view
      A.L.emphasise(null, 0.3, tl, 0);
      for (const id of lin.order) A.L.setPillState(lin.pills[id], false, 0.3, tl, 0);
      tl.to(lin.rho.g, { autoAlpha: 0, duration: 0.3 }, 0);
      tl.to(lin.colsG, { autoAlpha: 0.55, duration: 0.4 }, 0);
      tl.to(lin.order.map((id) => lin.pills[id].g), { autoAlpha: 0.3, duration: 0.4 }, 0);
      // pot and coins
      tl.set(bud.potCoins, { autoAlpha: 0 }, 0);
      tl.set(bud.pot, { autoAlpha: 1 }, 0.1);
      tl.from(bud.pot, { y: "+=16", autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 0.1);
      bud.potCoins.forEach((c, i) => {
        const pos = bud.potPos[i];
        tl.set(c, { x: pos[0], y: pos[1], scale: 1 }, 0);
        tl.fromTo(c, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, 0.5 + i * 0.03);
      });
      // ghost "equal split" row
      A.B.labelRows();
      let t = 1.2;
      tl.to(bud.labels, { autoAlpha: 1, duration: 0.3 }, t);
      tl.set([bud.lblSolid, bud.lblBar], { autoAlpha: 0 }, t);
      tl.to(bud.lblGhost, { autoAlpha: 1, duration: 0.3 }, t);
      s.plan.checkpoints.forEach((cp, ci) => {
        bud.ghost[cp.id].forEach((c, i) => tl.fromTo(c, { opacity: 0, scale: 0.3, transformOrigin: "50% 50%" }, { opacity: 0.7, scale: 1, duration: 0.25 }, t + ci * 0.12 + i * 0.05));
      });
      t += 1.1;
      // real allocation: coins fly pot -> gates
      tl.to(bud.lblSolid, { autoAlpha: 1, duration: 0.3 }, t);
      let used = 0; for (const cp of s.plan.checkpoints) used += cp[bud.sel];
      for (let i = 0; i < used; i++) {
        const from = bud.potPos[i], to = A.B.coinSlot(i), at = t + (used - 1 - i) * 0.12;
        tl.to(bud.potCoins[i], { motionPath: { path: arc(from[0], from[1], to[0], to[1]), autoRotate: false }, scale: bud.r / bud.potR, duration: 0.7, ease: "power2.inOut" }, at);
      }
      t += used * 0.12 + 0.8;
      // bars + q = x -> n guards
      tl.to(bud.lblBar, { autoAlpha: 1, duration: 0.3 }, t);
      for (const cp of s.plan.checkpoints) {
        const b = bud.bars[cp.id];
        tl.set(b.g, { autoAlpha: 1 }, t);
        tl.fromTo([b.rect, b.pat], { attr: { width: 0 } }, { attr: { width: b.len }, duration: 0.6, ease: "power2.out" }, t);
        tl.fromTo(b.val, { attr: { x: 8 } }, { attr: { x: b.len + 8 }, duration: 0.6, ease: "power2.out" }, t);
        tl.fromTo(b.qt, { opacity: 0 }, { opacity: 1, duration: 0.4 }, t + 0.4);
      }
    },

    9(tl, s) {
      const bud = s.bud;
      tl.to(bud.lblGhost, { autoAlpha: 0, duration: 0.3 }, 0);
      tl.to(bud.lblBar, { autoAlpha: 0, duration: 0.3 }, 0);
      for (const cp of s.plan.checkpoints) {
        bud.ghost[cp.id].forEach((c) => tl.to(c, { opacity: 0, duration: 0.3 }, 0));
        const b = bud.bars[cp.id];
        tl.to(b.g, { autoAlpha: 0, duration: 0.3 }, 0).to(b.qt, { opacity: 0, duration: 0.3 }, 0);
      }
      // coins collapse into a shield at each gate
      let i = 0;
      for (const cp of s.plan.checkpoints) {
        const sh = bud.shields[cp.id], n = cp[bud.sel];
        for (let k = 0; k < n; k++, i++) {
          tl.to(bud.potCoins[i], { x: s.lin.gates[cp.id].x, y: 556, scale: 0.3, autoAlpha: 0, duration: 0.6, ease: "power2.inOut" }, 0.4 + k * 0.04);
        }
        tl.fromTo(sh.g, { scale: 0, autoAlpha: 1 }, { scale: 1.25, autoAlpha: 1, duration: 0.45, ease: "back.out(2)" }, 1.0);
        tl.fromTo(sh.catches, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.5);
      }
      tl.to(bud.pot, { autoAlpha: 0, duration: 0.4 }, 0.8);
      tl.to(bud.potCoins, { autoAlpha: 0, duration: 0.3 }, 0.9);
      tl.to(bud.lblSolid, { autoAlpha: 0, duration: 0.3 }, 0.8);
    },

    10(tl, s) {
      const lin = s.lin, bud = s.bud;
      for (const cp of s.plan.checkpoints) {
        const sh = bud.shields[cp.id];
        tl.to([sh.g, sh.catches], { autoAlpha: 0, duration: 0.3 }, 0);
        tl.to(lin.gates[cp.id].g, { autoAlpha: 0, duration: 0.3 }, 0);
      }
      s.edges.forEach((e) => tl.set(e.el, { autoAlpha: 0 }, 0));
      for (const id of s.ids) {
        const nv = s.nodes[id], p = lin.pills[id];
        tl.set(nv.g, { x: p.cx, y: p.cy, scale: 0.55, autoAlpha: 0 }, 0);
        tl.set(nv.score, { autoAlpha: 1 }, 0);
        tl.set(nv.star, { autoAlpha: nv.n.critical ? 1 : 0 }, 0);
        tl.set(nv.shield, { autoAlpha: 0 }, 0);
      }
      s.ids.forEach((id, i) => {
        const nv = s.nodes[id], p = lin.pills[id], at = 0.3 + i * 0.06;
        const tgt = A.G.sizeScale(s, nv.weight);
        tl.to(nv.g, { x: nv.x, y: nv.y, scale: tgt, autoAlpha: 1, duration: 0.9, ease: "power3.inOut" }, at);
        tl.to(p.g, { x: nv.x, y: nv.y, scale: 0.6, autoAlpha: 0, duration: 0.8, ease: "power3.inOut" }, at);
      });
      tl.to(lin.colsG, { autoAlpha: 0, duration: 0.5 }, 0.2);
      tl.to(s.edges.map((e) => e.el), { autoAlpha: 1, duration: 0.5 }, 1.3);
      for (const id of s.guarded) {
        const nv = s.nodes[id];
        tl.fromTo(nv.shield, { scale: 0, autoAlpha: 1 }, { scale: 0.85, autoAlpha: 1, duration: 0.35, ease: "back.out(2)" }, 1.5);
      }
      tl.set({}, {}, 2.0);
    },

    11(tl, s) {
      const web = [s.websiteG, ...s.webEdges.map((e) => e.el)];
      for (const nv of s.ids.map((i) => s.nodes[i])) tl.to(nv.shield, { autoAlpha: 0, duration: 0.2 }, 0);
      tl.fromTo(web, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.1);
      tl.set({}, {}, 0.7);
    },

    12(tl, s) {
      for (const id of s.guarded) {
        const nv = s.nodes[id];
        tl.fromTo(nv.shield, { scale: 0, autoAlpha: 1 }, { scale: 0.85, autoAlpha: 1, duration: 0.35, ease: "back.out(2)" }, 0.2 + s.guarded.indexOf(id) * 0.06);
      }
      tl.set({}, {}, 0.9);
    },

    13(tl, s) {
      tl.to([s.L.live, s.L.legend, s.L.tray], { autoAlpha: 0, duration: 0.4 }, 0);
      tl.fromTo(s.L.results, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.3);
      A.R.play(tl, 0.8);
    },
  };

  // ---------------------------------------------------------------- blast-radius sequence (step 7 and gate click)
  function blastSequence(tl, s, t0, cps, first) {
    const lin = s.lin;
    let t = t0;
    if (first) {
      tl.to(lin.colsG, { autoAlpha: 1, duration: 0.2 }, 0);
      tl.fromTo(lin.rho.g, { autoAlpha: 0, x: 20 }, { autoAlpha: 1, x: 40, duration: 0.4 }, 0);
      t += 0.4;
    }
    let prev = null;
    for (const cp of cps) {
      const gt = lin.gates[cp.id];
      if (prev) {
        for (const id of prev.downstream) A.L.setPillState(lin.pills[id], false, 0.25, tl, t);
        t += 0.3;
      }
      tl.call(() => A.L.setRho(cp), null, t);
      A.L.emphasise(cp.id, 0.25, tl, t);
      // ripple from the gate tab
      if (!A.rm()) {
        const rip = svg("circle", { r: 8, fill: "none", stroke: C.st.compromised.stroke, "stroke-width": 4 });
        s.L.fx.appendChild(rip); gsap.set(rip, { x: gt.x, y: 38, autoAlpha: 0 });
        tl.fromTo(rip, { attr: { r: 8 }, autoAlpha: 0.8 }, { attr: { r: 170 }, autoAlpha: 0, duration: 1.0, ease: "power1.out" }, t + 0.1);
      }
      // counter ticks to rho
      const proxy = { v: 0 }, rc = lin.rho;
      tl.fromTo(proxy, { v: 0 }, { v: cp.rho, duration: 0.9, ease: "power1.out", onUpdate: () => { rc.num.textContent = fmt(proxy.v); } }, t + 0.2);
      // downstream pills get hit, nearest first
      const ds = cp.downstream.map((id) => lin.pills[id]).filter(Boolean).sort((a, b) => Math.abs(a.cx - gt.x) - Math.abs(b.cx - gt.x));
      ds.forEach((p, i) => {
        const at = t + 0.3 + i * 0.1 + Math.min(0.5, Math.abs(p.cx - gt.x) / 2400);
        const toX = p.cx > gt.x ? p.cx - p.w / 2 : p.cx + p.w / 2;
        if (!A.rm() && Math.abs(toX - gt.x) > 6) {
          const ln = svg("line", { x1: gt.x, y1: p.cy, x2: toX, y2: p.cy, stroke: C.st.compromised.stroke, "stroke-width": 3, "stroke-dasharray": "7 5", "stroke-linecap": "round" });
          s.L.fx.appendChild(ln);
          tl.fromTo(ln, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.3, ease: "power1.in" }, at);
        }
        A.L.setPillState(p, true, 0.3, tl, at + 0.25);
      });
      t += 0.3 + ds.length * 0.1 + 0.9;
      prev = cp;
    }
    tl.set({}, {}, t);
  }

  function replayGate(id) {
    const s = sc(); if (ST.cur !== 7) return;
    const cp = s.plan.checkpoints.find((c) => c.id === id); if (!cp) return;
    killTl(); clearTmp(); applyView(7);
    for (const pid of s.lin.order) A.L.setPillState(s.lin.pills[pid], false, 0);
    const tl = gsap.timeline(); ST.tl = tl;
    A.L.emphasise(null, 0);
    blastSequence(tl, s, 0, [cp], false);
    tl.eventCallback("onComplete", () => {
      ST.tl = null; clearTmp();
      // leave the replayed gate selected (a valid frame of this step)
      for (const pid of s.lin.order) A.L.setPillState(s.lin.pills[pid], cp.downstream.includes(pid), 0);
      A.L.emphasise(cp.id, 0); A.L.setRho(cp);
    });
  }

  // ---------------------------------------------------------------- play / next / prev
  function liveModeFor(n) { return A.LIVE_STEPS[n]; }

  /** Advance one step; at an unfinished live step this starts the run instead. */
  function advance(auto) {
    const n = ST.cur;
    if (A.state.running) return Promise.resolve();
    const mode = liveModeFor(n);
    if (mode && !A.state.done[mode]) return A.live.start(mode);
    if (n >= A.LAST_STEP) return Promise.resolve();
    return goTo(n + 1, { auto });
  }
  /** Manual Next: ends autoplay, then advances. */
  function next() {
    if (A.state.running) return Promise.resolve();
    stopPlay();
    return advance(false);
  }
  /** Manual Prev. Blocked while a live run is streaming (the run owns the stage). */
  function prev() {
    if (A.state.running || ST.cur <= 0) return;
    goTo(ST.cur - 1, { snap: true });
  }

  function stopPlay() {
    A.state.playing = false;
    if (ST.dwell) { ST.dwell.kill(); ST.dwell = null; }
    A.emit("playstate");
  }
  function startPlay() {
    A.state.playing = true; A.emit("playstate");
    const tick = async () => {
      if (!A.state.playing) return;
      if (ST.cur >= A.LAST_STEP) { stopPlay(); return; }
      await advance(true);
      if (!A.state.playing) return;
      ST.dwell = gsap.delayedCall(2, tick);
    };
    tick();
  }
  function togglePlay() { A.state.playing ? stopPlay() : startPlay(); }

  function resetStep() {
    const n = ST.cur;
    if (A.state.running) A.live.abort();
    if (n <= 0 || isLive(n) || n === 13 && false) { snap(n); return; }
    snap(n - 1);
    goTo(n);
  }
  /** Title slide with its entrance animation. */
  function intro() {
    snap(0);
    if (A.rm()) return;
    const s = sc(), tl = gsap.timeline();
    ST.tl = tl;
    tl.from(s.L.title, { autoAlpha: 0, y: 20, duration: 0.8, ease: "power2.out" }, 0);
    s.watermarkLines.forEach((l, i) => tl.fromTo(l, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.8, ease: "power1.inOut" }, 0.2 + i * 0.05));
    tl.eventCallback("onComplete", () => finish(0));
  }
  function restart() {
    stopPlay(); if (A.state.running) A.live.abort();
    A.state.done.undefended = false; A.state.done.defended = false;
    intro();
  }

  A.steps = {
    TITLES, view, goTo, snap, intro, next, prev, togglePlay, stopPlay, startPlay, resetStep, restart, replayGate,
    cur: () => ST.cur, isLive,
    /** Re-render the current step from scratch (after the plan/scene changed). */
    refresh() { snap(Math.max(0, ST.cur)); },
  };
})(window.App);
