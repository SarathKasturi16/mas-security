/* Live runs (steps 12 and 13): stream /api/run over SSE, feed events into an animation
 * queue so every event gets its own un-overlapped animation, mirror them into the log. */
(function (A) {
  "use strict";
  const { svg, g: mkG, C, $ } = A;

  let token = 0;            // bumped on abort so stale callbacks do nothing
  let cur = null;           // active run context
  let activeTl = null;
  let activeRes = null;     // resolver of the pending tlPromise, so abort() never leaves it hanging

  const padTo = (tl, min) => { tl.set({}, {}, Math.max(min, 0.05)); return tl; };
  const tlPromise = (tl) => new Promise((res) => {
    activeTl = tl; activeRes = res;
    if (tl.duration() <= 0) { res(); return; }
    tl.eventCallback("onComplete", res);
    tl.play(0);
  });
  const nodeOf = (id) => A.scene && A.scene.nodes[id];
  const succ = (id) => A.scene.edges.filter((e) => e.from === id).map((e) => e.to);
  const preds = (id) => A.scene.edges.filter((e) => e.to === id).map((e) => e.from);
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  // ---------------------------------------------------------------- UI chrome
  function setBadge(ctx, extra) {
    const b = $("live-badge");
    b.hidden = false;
    b.className = "live-badge" + (ctx.mode === "defended" ? " def" : "");
    ctx.badgeBase = ctx.mode === "defended" ? "Live run - DEFENDED" : "Live run - NO defence";
    b.textContent = ctx.badgeBase + (extra ? " (" + extra + ")" : "") + " · 00:00.0";
    clearInterval(ctx.timer);
    ctx.t0 = performance.now();
    ctx.timer = setInterval(() => {
      b.textContent = ctx.badgeBase + (extra ? " (" + extra + ")" : "") + " · " + A.logs.fmtElapsed(performance.now() - ctx.t0).slice(0, 7);
    }, 100);
  }
  function stopTimer(ctx) { clearInterval(ctx.timer); }

  function showMsg(text, err) {
    const m = $("stage-msg");
    if (!text) { m.hidden = true; return; }
    m.textContent = text; m.className = "stage-msg" + (err ? " err" : ""); m.hidden = false;
  }
  function showVerdict(kind, text, sub) {
    const v = $("verdict");
    if (!kind) { v.hidden = true; return; }
    v.className = "verdict " + kind;
    v.replaceChildren(el(kind === "ok" ? "✓" : kind === "blocked" ? "✕" : "⚠"), el(text));
    if (sub) v.appendChild(el(sub, "sub"));
    v.hidden = false;
    if (!A.rm()) gsap.fromTo(v, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: "back.out(2)" });
    else gsap.set(v, { scale: 1, opacity: 1 });
    function el(t, cls) { const s = A.el("span", cls, t); return s; }
  }
  A.showVerdict = showVerdict;

  // ---------------------------------------------------------------- pieces drawn in the stage
  function chipEl(vote, model, compact) {
    const gg = svg("g");
    if (compact) {
      gg.append(svg("circle", { r: 17, fill: vote ? C.block : "#fff", stroke: vote ? C.block : C.pass, "stroke-width": 2.5 }));
      A.icon(gg, vote ? "x" : "check", 0, 0, 20, vote ? "#fff" : C.pass);
    } else {
      gg.append(svg("rect", { x: -58, y: -17, width: 116, height: 34, rx: 17, fill: vote ? C.block : "#fff", stroke: vote ? C.block : C.pass, "stroke-width": 2.5 }));
      A.icon(gg, vote ? "x" : "check", -37, 0, 18, vote ? "#fff" : C.pass);
      gg.append(svg("text", { x: 11, y: 6, "text-anchor": "middle", "font-size": 18, "font-weight": 700, fill: vote ? "#fff" : C.pass }, vote ? "BLOCK" : "PASS"));
    }
    gg.appendChild(svg("title", null, model + ": " + (vote ? "BLOCK" : "PASS")));
    return gg;
  }

  function bannerEl(text, blocked, w) {
    const gg = svg("g");
    gg.append(svg("rect", { x: -w / 2, y: -28, width: w, height: 56, rx: 28, fill: blocked ? C.block : "#fff", stroke: blocked ? C.block : C.pass, "stroke-width": 3 }));
    A.icon(gg, blocked ? "x" : "check", -w / 2 + 32, 0, 22, blocked ? "#fff" : C.pass);
    gg.append(svg("text", { x: 14, y: 8, "text-anchor": "middle", "font-size": 22, "font-weight": 700, fill: blocked ? "#fff" : C.ink }, text));
    return gg;
  }

  const LIVE_TEAM_NOTE = "Live run uses the 7-agent pentest team (the only team with live agents)";

  // ---------------------------------------------------------------- event handlers (return a timeline or promise)
  async function onRunStart(ev, ctx) {
    ctx.payload = ev.payload; ctx.guarded = ev.guarded || [];
    if (ev.plan && ev.plan.manifest && ev.plan.manifest !== A.state.manifest) {
      const note = LIVE_TEAM_NOTE;
      A.logs.add(ctx.mode, "SYSTEM", "system", note + ` (switching from ${A.state.manifest} to ${ev.plan.manifest})`, [], ev);
      showMsg(note, false);
      setTimeout(() => { const m = $("stage-msg"); if (m.textContent === note) m.hidden = true; }, 8000);
      await A.main.switchManifest(ev.plan.manifest);
      if (ctx.my !== token) return null;             // aborted / superseded while the plan loaded
    }
    A.steps.snap(ctx.step);
    ctx.guardedSet = new Set(ctx.guarded.length ? ctx.guarded : A.scene.guarded);
    A.G.compact(A.logs.isOpen(), 0);
    A.logs.add(ctx.mode, "SYSTEM", "system",
      `Run started: ${ev.mode}, backend ${ev.backend}, payload ${ev.payload}, ${ev.alloc} split, B=${ev.budget}, guards ${ev.guard_model}`,
      [["payload_text", ev.payload_text || ""], ["guarded", (ev.guarded || []).join(", ") || "(none)"], ["order", (ev.order || []).join(" > ")]], ev);
    const tl = gsap.timeline();
    const sc = A.scene;
    if (!A.rm()) tl.fromTo(sc.websiteG, { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "power2.out", transformOrigin: "50% 50%" }, 0);
    await tlPromise(padTo(tl, 0.6));
    return null;
  }

  /** Where a guarded agent's guards sit: on the incoming arrow, a short way before the agent. */
  const STATION_BACK = 74;                           // viewBox units before the arrow tip
  function incomingEdge(id, sources) {
    const sc = A.scene;
    return (sources && sources[0]) || sc.edges.find((e) => e.to === id) || sc.webEdges.find((w) => w.to === id) || null;
  }
  function stationOf(edge) {
    let len = 200;
    try { len = edge.el.getTotalLength(); } catch (_) { /* detached path */ }
    const frac = Math.max(0.45, Math.min(0.92, 1 - STATION_BACK / Math.max(len, 1)));
    return { edge, frac, P: A.fx.edgePoint(edge, frac) };
  }

  function stationShield(nv, st, k) {
    const g = mkG(A.scene.L.tmp);
    g.append(svg("circle", { r: 24, fill: "#fff", stroke: C.shield, "stroke-width": 3 }),
      svg("path", { d: A.SHIELD_D, fill: C.shieldFill, stroke: C.shield, "stroke-width": 3, "stroke-linejoin": "round", transform: "scale(0.62)" }),
      svg("text", { y: 6, "text-anchor": "middle", "font-size": 17, "font-weight": 800, fill: C.shield }, String(k)));
    gsap.set(g, { x: st.P[0], y: st.P[1], autoAlpha: 0 });
    A.pivot(g);
    return g;
  }

  function onAgentStart(ev, ctx) {
    const sc = A.scene, nv = nodeOf(ev.node);
    ctx.inputs[ev.node] = ev.input;
    const pr = preds(ev.node);
    const len = (ev.input || "").length;
    const guarded = ctx.mode === "defended" && ctx.guardedSet.has(ev.node);
    const from = pr.length ? `hand-off from ${pr.join(", ")}` : "the target page";
    A.logs.add(ctx.mode, "AGENT", ev.node,
      guarded ? `incoming ${from} (${len} chars) is checked by ${ev.node}'s guards before ${ev.node} runs`
        : pr.length ? `${ev.node} receives hand-off from ${pr.join(", ")} (${len} chars)` : `${ev.node} reads the target page (${len} chars)`,
      [["input", ev.input || ""]], ev);
    if (!nv) return null;
    const tl = gsap.timeline();
    if (!guarded) A.G.setState(nv, "active", 0.3, tl, 0);
    let sources = [];
    if (pr.length) sources = sc.edges.filter((e) => e.to === ev.node && ctx.infected.has(e.from));
    else if (ctx.payload !== "clean") sources = sc.webEdges.filter((w) => w.to === ev.node);
    const toks = []; let end = 0.45;
    const rec = { toks, edges: sources, station: null };
    let st = null;
    if (guarded) {
      const edge = incomingEdge(ev.node, sources);
      if (edge) {
        st = rec.station = stationOf(edge);
        const sh = stationShield(nv, st, sc.plan.node_guards[ev.node] || 1);
        rec.shield = sh;
        ctx.tmp[ev.node] = [sh];
        tl.fromTo(sh, { scale: 0.3, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: "back.out(2.4)" }, 0.25);
        end = 0.9;
      }
    }
    sources.forEach((e, i) => {
      const tok = A.fx.token(sc.L.tmp, "attack"); toks.push(tok);
      const at = 0.1 + i * 0.12;
      const stop = st && e === st.edge ? st.frac : (guarded ? stationOf(e).frac : 1);
      const fin = A.fx.travel(tl, tok, e, at, A.dur(0.9) * stop, ++ctx.seq, 0, stop);
      A.G.edgeStyle(e, "hot", 0.25, tl, at + 0.1);
      end = Math.max(end, fin);
    });
    ctx.tokens[ev.node] = rec;
    return padTo(tl, end);
  }

  function onVote(ev, ctx) {
    const sc = A.scene, nv = nodeOf(ev.node);
    const votes = ev.votes || [], k = ev.k || votes.length, models = ev.models || [];
    const blocks = votes.filter(Boolean).length, cps = (ev.checkpoint || []).join("+") || "checkpoint";
    const dirTxt = ev.direction === "outgoing" ? "outgoing hand-off from" : "incoming hand-off to";
    const det = votes.map((v, i) => [`G${i + 1}${models[i] ? " (" + models[i] + ")" : ""}`, v ? "BLOCK" : "PASS"]);
    det.push(["rule", ev.rule || "any"], ["direction", ev.direction || "incoming"]);
    ctx.votes[ev.node] = ev;
    if (ev.guard_error) {
      A.logs.add(ctx.mode, "ERROR", ev.node,
        `${cps} guards could not check the ${dirTxt} ${ev.node} (backend error) — failed closed: input wiped, NOT counted as a detection`, det, ev);
    } else {
      A.logs.add(ctx.mode, ev.blocked ? "BLOCK" : "GUARD", ev.node,
        `${cps} guards checked the ${dirTxt} ${ev.node}: ${blocks}/${k} voted BLOCK` + (ev.blocked ? ` — blocked, ContextWipe; ${ev.node} never sees the injection` : " — passed, nothing suspicious"), det, ev);
    }
    if (!nv) return null;
    const tl = gsap.timeline(), tmp = ctx.tmp[ev.node] || [];
    const tk = ctx.tokens[ev.node] || { toks: [], edges: [], station: null };
    const st = tk.station || (() => { const e = incomingEdge(ev.node, tk.edges); return e ? stationOf(e) : null; })();
    const P = st ? st.P : [nv.x - 84 * nv.sc - 40, nv.y];
    // vote chips: a small grid on the incoming arrow, kept clear of the agent's own box
    const cell = k > 12 ? 32 : 40, perRow = k <= 4 ? k : Math.min(10, Math.ceil(Math.sqrt(k * 1.5)));
    const rows = Math.ceil(k / perRow), gw = perRow * cell, gh = rows * cell;
    const left = P[0] <= nv.x, nodeL = nv.x - 84 * nv.sc, nodeR = nv.x + 84 * nv.sc;
    let cx = left ? Math.min(P[0], nodeL - 12 - gw / 2) : Math.max(P[0], nodeR + 12 + gw / 2);
    cx = Math.max(12 + gw / 2, Math.min(1588 - gw / 2, cx));
    const above = P[1] - 32 - gh >= 62;
    const gy0 = above ? P[1] - 32 - gh : P[1] + 32;
    votes.forEach((v, i) => {
      const r = Math.floor(i / perRow), c = i - r * perRow, inRow = Math.min(perRow, k - r * perRow);
      const x = cx + (c - (inRow - 1) / 2) * cell, y = gy0 + r * cell + cell / 2;
      const ch = chipEl(v, models[i] || "guard " + (i + 1), true);
      if (cell < 40) ch.setAttribute("transform", "scale(0.82)");
      const wrap = mkG(sc.L.tmp); wrap.appendChild(ch);
      gsap.set(wrap, { x, y: y + (above ? 8 : -8), autoAlpha: 0 });
      tl.to(wrap, { autoAlpha: 1, y, duration: A.dur(0.22), ease: "power2.out" }, 0.05 + i * (A.rm() ? 0 : 0.09));
      tmp.push(wrap);
    });
    const tChips = 0.3 + (A.rm() ? 0 : 0.09 * (k - 1));
    const tVerdict = tChips + 0.35;
    const label = ev.guard_error ? "GUARD ERROR (fail-closed)" : ev.blocked ? `BLOCKED ${blocks}/${k}` : `PASSED ${blocks}/${k}`;
    const bw = A.textW(label, 22, 700) + 84, by = above ? gy0 - 30 : gy0 + gh + 30;
    const banner = bannerEl(label, ev.blocked, bw);
    sc.L.tmp.appendChild(banner);
    gsap.set(banner, { x: Math.max(12 + bw / 2, Math.min(1588 - bw / 2, cx)), y: by, autoAlpha: 0, scale: 0.9, transformOrigin: "50% 50%" });
    tmp.push(banner);
    tl.to(banner, { autoAlpha: 1, scale: 1, duration: A.dur(0.25), ease: "back.out(2)" }, tVerdict);
    let end = tVerdict + 0.75;
    if (ev.blocked) {
      if (!A.rm()) {
        tl.to(nv.shield, { scale: 1.25, duration: 0.12 }, tVerdict).to(nv.shield, { scale: 0.85, duration: 0.3, ease: "back.out(3)" }, tVerdict + 0.12);
        tl.set(nv.shield.firstChild, { attr: { fill: "#fff" } }, tVerdict).set(nv.shield.firstChild, { attr: { fill: C.shieldFill } }, tVerdict + 0.12);
        if (tk.shield) tl.to(tk.shield, { scale: 1.3, duration: 0.12, yoyo: true, repeat: 1 }, tVerdict);
      }
      // the token dies on the arrow, before it reaches the agent
      for (const tok of tk.toks) tl.to(tok.all, { autoAlpha: 0, duration: 0.1 }, tVerdict);
      if (tk.toks.length) A.fx.shatter(tl, P[0], P[1], tVerdict);
      for (const e of tk.edges) A.G.edgeStyle(e, "cut", 0.25, tl, tVerdict);
    } else {
      // allowed: the agent starts working and any token carries on into it
      A.G.setState(nv, "active", 0.3, tl, tVerdict + 0.15);
      tk.toks.forEach((tok, i) => {
        const e = tk.edges[i];
        if (!e) return;
        const sf = tk.station && e === tk.station.edge ? tk.station.frac : stationOf(e).frac;
        A.fx.travel(tl, tok, e, tVerdict + 0.2, A.dur(0.9) * (1 - sf), undefined, sf, 1);
      });
      end = tVerdict + 1.3;
    }
    ctx.tmp[ev.node] = tmp;
    return padTo(tl, end);
  }

  function onOutput(ev, ctx) {
    const sc = A.scene, nv = nodeOf(ev.node);
    const out = succ(ev.node), tgt = out.length ? out.join(", ") : "end of chain";
    const detail = ev.wiped && ev.agent_input
      ? [["input (after ContextWipe)", ev.agent_input], ["blocked hand-off", ctx.inputs[ev.node] || ""], ["output", ev.output || ""], ["upstream", (ev.upstream || []).join(", ") || "(target page)"]]
      : [["input", ctx.inputs[ev.node] || ""], ["output", ev.output || ""], ["upstream", (ev.upstream || []).join(", ") || "(target page)"]];
    const vt = ctx.votes[ev.node];
    if (vt) detail.push(["guard votes", (vt.votes || []).map((v) => (v ? "BLOCK" : "PASS")).join(" ") + "  rule=" + (vt.rule || "any") + "  direction=" + (vt.direction || "incoming")]);
    let level, msg;
    if (ev.error) { level = "ERROR"; msg = `${ev.node}: backend error — ${trunc((ev.output || "").replace(/\s+/g, " "), 110)}`; }
    else if (ev.wiped) { level = "CLEAN"; msg = `${ev.node} → ${tgt}: ContextWipe applied, ${ev.node} stayed clean, sanitised summary forwarded`; }
    else if (ev.compromised) { level = "INFECT"; msg = `${ev.node} → ${tgt}: output contains hidden instruction — INFECTED`; }
    else { level = "CLEAN"; msg = `${ev.node} → ${tgt}: output clean`; }
    A.logs.add(ctx.mode, level, ev.node, msg, detail, ev);
    if (ev.compromised && !ev.wiped) ctx.infected.add(ev.node);
    if (!nv) return null;

    const tl = gsap.timeline(), tk = ctx.tokens[ev.node];
    let end = 0.7;
    const absorb = () => {
      if (!tk) return;
      for (const tok of tk.toks) tl.to(tok.all, { autoAlpha: 0, scale: 0.2, duration: A.dur(0.25) }, 0.05);
    };
    if (ev.error) {
      absorb(); A.G.setState(nv, "error", 0.35, tl, 0);
    } else if (ev.wiped) {
      // incoming check blocked the hand-off: the agent never saw the injection, it works on a clean summary
      if (nv.state !== "active") A.G.setState(nv, "active", 0.25, tl, 0);
      A.G.setState(nv, "clean", 0.4, tl, 0.55);
      const tag = mkG(sc.L.tmp);
      const label = "ContextWipe applied", tw0 = A.textW(label, 18, 600) + 40;
      tag.append(svg("rect", { x: -tw0 / 2, y: -17, width: tw0, height: 34, rx: 17, fill: "#fff", stroke: C.block, "stroke-width": 2.5 }),
        svg("text", { y: 6, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: C.block }, label));
      const hh = 38 * nv.sc, below = nv.y + hh + 30 <= 612;
      gsap.set(tag, { x: Math.max(40 + tw0 / 2, Math.min(1560 - tw0 / 2, nv.x)), y: below ? nv.y + hh + 30 : nv.y - hh - 30, autoAlpha: 0 });
      tl.to(tag, { autoAlpha: 1, duration: 0.2 }, 0.55).to(tag, { autoAlpha: 0, duration: 0.3 }, 2.5).call(() => tag.remove(), null, 2.9);
      end = 1.25;
    } else if (ev.compromised) {
      absorb(); A.G.setState(nv, "compromised", 0.35, tl, 0.1);
      if (!A.rm()) tl.to(nv.g, { x: nv.x + 4, duration: 0.04, repeat: 3, yoyo: true }, 0.1).set(nv.g, { x: nv.x }, 0.3);
    } else {
      absorb(); A.G.setState(nv, "clean", 0.35, tl, 0.05);
    }
    // station shield, chips and banner from the guard vote fade a moment later
    const tmp = ctx.tmp[ev.node];
    if (tmp && tmp.length) {
      tl.to(tmp, { autoAlpha: 0, duration: 0.3 }, Math.min(end - 0.2, 1.0)).call(() => tmp.forEach((n) => n.remove()), null, Math.min(end - 0.2, 1.0) + 0.35);
    }
    return padTo(tl, end);
  }

  function onRunEnd(ev, ctx) {
    const plan = A.scene.plan;
    const crit = plan.nodes.filter((n) => n.critical).map((n) => n.id);
    const blocked = ev.blocked_at || [];
    let verdictKind, text, sub, level, msg;
    if (ev.orch_pwned) {
      verdictKind = "bad"; text = (crit.join(", ") || "key agent") + " COMPROMISED";
      sub = ev.rep_pwned ? "reporter compromised" : "orchestrator compromised";
      level = "INFECT"; msg = `RESULT: ${crit.join(", ") || "orchestrator"} COMPROMISED${ev.rep_pwned ? ", reporter COMPROMISED" : ""}`;
    } else if (blocked.length) {
      verdictKind = "blocked"; text = "BLOCKED - attack stopped"; sub = "blocked at " + blocked.join(", ");
      level = "CLEAN"; msg = `RESULT: ${crit.join(", ") || "orchestrator"} clean — attack blocked at ${blocked.join(", ")}`;
    } else {
      verdictKind = "ok"; text = "No compromise"; sub = "no agent compromised";
      level = "CLEAN"; msg = "RESULT: no agent compromised";
    }
    A.logs.add(ctx.mode, level, "system", msg, [["orch_pwned", String(ev.orch_pwned)], ["rep_pwned", String(ev.rep_pwned)], ["blocked_at", blocked.join(", ") || "(none)"]], ev);
    showVerdict(verdictKind, text, sub);
    stopTimer(ctx);
    $("live-badge").textContent = ctx.badgeBase + " · finished " + A.logs.fmtElapsed(performance.now() - ctx.t0).slice(0, 7);
    ctx.ended = true;
    A.state.done[ctx.mode] = true;
    return padTo(gsap.timeline(), 1.0);
  }

  function onFatal(ev, ctx) {
    A.logs.add(ctx.mode, "ERROR", "system", "Server error: " + (ev.message || "unknown"), [["message", ev.message || ""]], ev);
    showMsg("Run failed: " + (ev.message || "unknown server error"), true);
    stopTimer(ctx);
    ctx.ended = true;
    return null;
  }

  const HANDLERS = { run_start: onRunStart, agent_start: onAgentStart, guard_vote: onVote, agent_output: onOutput, run_end: onRunEnd, fatal: onFatal };

  // ---------------------------------------------------------------- queue + stream
  function runMode(mode, my, opts) {
    const step = mode === "undefended" ? 12 : 13;
    return new Promise((resolve) => {
      const ctx = { mode, step, my, guardedSet: new Set(A.scene ? A.scene.guarded : []), infected: new Set(), tokens: {}, tmp: {}, inputs: {}, votes: {}, seq: 0, payload: "poisoned", queue: [], busy: false, streamEnded: false, got: 0 };
      cur = ctx;
      A.steps.goTo(step, { snap: true, fromLive: true });
      if (!A.logs.isOpen()) A.logs.open();
      A.logs.startRun(mode);
      showVerdict(null); showMsg("");
      setBadge(ctx);
      A.G.compact(true);

      const finish = () => {
        if (ctx.finished) return; ctx.finished = true;
        stopTimer(ctx); if (ctx.stream) ctx.stream.close();
        if (cur === ctx) cur = null;
        resolve();
      };
      ctx.finish = finish;

      const pump = () => {
        if (ctx.finished || ctx.my !== token) { finish(); return; }
        if (ctx.busy) return;
        if (!ctx.queue.length) { if (ctx.streamEnded) finish(); return; }
        ctx.busy = true;
        const ev = ctx.queue.shift();
        const fail = (e) => {
          console.error("live handler", ev.type, e);
          A.logs.add(ctx.mode, "ERROR", "system", `Display error while handling "${ev.type}": ${(e && e.message) || e}`, [], null);
        };
        let p;
        try {
          const r = HANDLERS[ev.type] ? HANDLERS[ev.type](ev, ctx) : null;
          p = r && typeof r.eventCallback === "function" ? tlPromise(r) : Promise.resolve(r);
        } catch (e) { p = Promise.reject(e); }
        p.catch(fail).finally(() => { ctx.busy = false; pump(); });
      };
      ctx.push = (ev) => { ctx.queue.push(ev); pump(); };
      ctx.end = () => { ctx.streamEnded = true; pump(); };

      const replay = () => {
        const evs = A.api.recorded(mode);
        if (!evs) {
          A.logs.add(mode, "ERROR", "system", "Backend unreachable and no recorded run is available.", [], null);
          showMsg("Backend unreachable. Start it with: python -m demo.server", true);
          ctx.end(); return;
        }
        A.logs.add(mode, "ERROR", "system", "Backend unreachable - replaying recorded run", [], null);
        showMsg("Replaying recorded run", false);
        setBadge(ctx, "recorded");
        evs.forEach((e) => ctx.queue.push(JSON.parse(JSON.stringify(e))));
        ctx.end();
      };

      const runOpts = {
        mode, backend: A.state.backend, clean: A.state.clean, alloc: A.state.alloc,
        budget: A.state.budget, guardModel: A.state.guardModel, seed: A.state.seed,
      };
      ctx.stream = A.api.stream(runOpts, {
        onEvent: (ev) => { ctx.got++; ctx.push(ev); },
        onDone: () => ctx.end(),
        onError: async (msg) => {
          if (ctx.got === 0) {
            // Replay only when the server is really unreachable. If it answers, show why it refused the run.
            const d = await A.api.diagnose(runOpts);
            if (ctx.finished || ctx.my !== token) return;
            if (!d.reachable) { replay(); return; }
            msg = d.status === 429 ? "A live LLM run is already in progress. Wait for it to finish, then try again."
              : d.error ? "The server refused the run: " + d.error
                : "The server is up but the run stream failed to start. Try again.";
          }
          A.logs.add(mode, "ERROR", "system", msg, [], null);
          showMsg(msg, true);
          ctx.end();
        },
      });
    });
  }

  A.live = {
    /** kind: "undefended" | "defended" | "both". Resolves when all requested runs have finished. */
    async start(kind) {
      if (A.state.running) return;
      const my = ++token;
      A.state.running = true; A.emit("runstate");
      const modes = kind === "both" ? ["undefended", "defended"] : [kind];
      try {
        for (const m of modes) {
          if (my !== token) break;
          await runMode(m, my);
        }
      } finally {
        if (my === token) { A.state.running = false; A.emit("runstate"); }
      }
    },
    abort() {
      token++;
      if (activeTl) activeTl.kill();
      if (activeRes) { const r = activeRes; activeRes = null; r(); }
      if (cur) { clearInterval(cur.timer); cur.finish(); }
      A.state.running = false; A.emit("runstate");
      showMsg(""); showVerdict(null);
    },
    running: () => A.state.running,
  };
})(window.App);
