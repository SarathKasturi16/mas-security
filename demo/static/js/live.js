/* Live runs for the Attack lab (stage views 12 and 13): POST /api/run, feed the streamed events into an
 * animation queue so every event gets its own un-overlapped animation, write them to the log viewer. */
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
  function showMsg(text, err) {
    const m = $("stage-msg");
    if (!text) { m.hidden = true; return; }
    m.textContent = text; m.className = "stage-msg" + (err ? " err" : ""); m.hidden = false;
  }
  /** One plain line under the lab controls, e.g. "orchestrator compromised". */
  function showVerdict(text) { $("verdict").textContent = text || ""; }
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
  const preview = (text, canary, n) => {
    const t = (text || "").replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    const i = canary ? t.indexOf(canary) : -1;
    if (i < 0) return t.slice(0, n - 3) + "...";
    if (i + canary.length <= n - 3) return t.slice(0, n - 3) + "...";
    const head = t.slice(0, 36), tail = t.slice(Math.max(36, i - 20), i + canary.length + 8);
    return head + " ... " + tail;
  };

  // ---------------------------------------------------------------- event handlers (return a timeline or promise)
  async function onRunStart(ev, ctx) {
    ctx.canary = ev.canary || ctx.req.goalToken || A.GOAL_TOKEN;
    // The red attack token is drawn only when the target text really carries the goal token.
    const injected = typeof ev.payload_text === "string" ? ev.payload_text.includes(ctx.canary) : ev.payload !== "clean";
    ctx.payload = injected ? "poisoned" : "clean";
    ctx.guarded = ev.guarded || [];
    // The server's run is the truth: redraw when its team, budget or split differ from the scene on screen
    // (e.g. a plan reload was still in flight when Run was pressed, or the budget was clamped for Groq).
    const sp = A.state.plan, pl = ev.plan || {};
    const manifestDiff = !!pl.manifest && pl.manifest !== A.state.manifest;
    const planDiff = !!sp && ((ev.budget != null && ev.budget !== sp.budget) || (!!ev.alloc && ev.alloc !== sp.alloc));
    if (manifestDiff || planDiff) {
      if (manifestDiff) A.logs.note(LIVE_TEAM_NOTE + ` (switching from ${A.state.manifest} to ${pl.manifest})`, ev);
      await A.main.syncPlan({ manifest: pl.manifest, budget: ev.budget, alloc: ev.alloc });
      if (ctx.my !== token) return null;             // aborted / superseded while the plan loaded
    }
    A.steps.snap(ctx.step);
    ctx.guardedSet = new Set(ctx.guarded.length ? ctx.guarded : A.scene.guarded);
    A.G.compact(false, 0);
    ctx.runNo = A.logs.beginRun({
      mode: ctx.mode, backend: ev.backend || ctx.req.backend, preset: ev.preset || "recorded",
      guardModel: ev.guard_model || ctx.req.guardModel, budget: ev.budget, alloc: ev.alloc, goalToken: ctx.canary,
    });
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
    const from = pr.length ? pr.join(", ") : "target";
    A.logs.line({
      kind: "agent", src: ev.node, tag: "IN", text: `<- ${from} (${len} chars)`,
      full: "input:\n" + (ev.input || ""),
    }, ev);
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
    const det = votes.map((v, i) => `G${i + 1}${models[i] ? " (" + models[i] + ")" : ""}: ${v ? "BLOCK" : "PASS"}`);
    det.push(`rule=${ev.rule || "any"}  direction=${ev.direction || "incoming"}`);
    ctx.votes[ev.node] = ev;
    const voteSegs = [];
    votes.forEach((v, i) => { if (i) voteSegs.push([" ", null]); voteSegs.push([v ? "BLOCK" : "PASS", v ? "st-block" : "st-pass"]); });
    const head = `${cps} ${k} guard${k === 1 ? "" : "s"}: `;
    if (ev.guard_error) {
      A.logs.line({
        kind: "guard", src: ev.node, tag: "GUARD", status: ["ERROR", "st-block"],
        segs: [[head + "backend error -> failed closed, input wiped, not counted as a detection", null]], full: det.join("\n"),
      }, ev);
    } else {
      A.logs.line({
        kind: "guard", src: ev.node, tag: "GUARD", full: det.join("\n"),
        segs: [[head, null], ...voteSegs, [ev.blocked ? " -> blocked, ContextWipe" : " -> passed", null]],
      }, ev);
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
    const out = succ(ev.node);
    const full = ev.wiped && ev.agent_input
      ? "input (after ContextWipe):\n" + ev.agent_input + "\n\nblocked hand-off:\n" + (ctx.inputs[ev.node] || "") + "\n\noutput:\n" + (ev.output || "")
      : "input:\n" + (ctx.inputs[ev.node] || "") + "\n\noutput:\n" + (ev.output || "");
    const segs = [[`"${preview(ev.output, ctx.canary, 110)}"`, null]];
    if (ev.wiped) segs.push(["  (input wiped)", "dim"]);
    if (out.length === 0) segs.push(["  (end of chain)", "dim"]);
    const status = ev.error ? ["ERROR", "st-block"] : ev.compromised ? ["COMPROMISED", "st-bad"] : ["CLEAN", "st-pass"];
    A.logs.line({ kind: "agent", src: ev.node, tag: "OUT", segs, status, full }, ev);
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
    const blocked = ev.blocked_at || [];
    const cpOf = (id) => { const v = ctx.votes[id]; return v && v.checkpoint && v.checkpoint.length ? ` (${v.checkpoint.join("+")})` : ""; };
    const pwned = [];
    if (ev.orch_pwned) pwned.push("orchestrator");
    if (ev.rep_pwned) pwned.push("reporter");
    const stopped = blocked.map((id) => id + cpOf(id)).join(", ");
    let verdict, segs;
    if (pwned.length) {
      verdict = pwned.join(" and ") + " compromised";
      segs = [];
      pwned.forEach((n, i) => { segs.push([(i ? ", " : "") + n + " ", null], ["COMPROMISED", "st-bad"]); });
      if (stopped) segs.push([`; attack stopped at ${stopped}`, null]);
    } else if (blocked.length) {
      verdict = "attack stopped at " + stopped;
      segs = [[verdict + "; orchestrator ", null], ["clean", "st-pass"]];
    } else if (ctx.infected.size) {
      const who = [...ctx.infected].join(", ");
      verdict = `${who} compromised; the attack did not reach the orchestrator`;
      segs = [[who + " ", null], ["COMPROMISED", "st-bad"], ["; orchestrator ", null], ["clean", "st-pass"]];
    } else {
      verdict = "no agent compromised";
      segs = [["no agent compromised", "st-pass"]];
    }
    A.logs.endRun(segs, ev);
    showVerdict(verdict);
    ctx.ended = true;
    ctx.result = { ok: true, verdict };
    return padTo(gsap.timeline(), 1.0);
  }

  function onFatal(ev, ctx) {
    A.logs.note("error: " + (ev.message || "unknown server error"), ev);
    showMsg("Run failed: " + (ev.message || "unknown server error"), true);
    ctx.ended = true;
    return null;
  }

  const HANDLERS = { run_start: onRunStart, agent_start: onAgentStart, guard_vote: onVote, agent_output: onOutput, run_end: onRunEnd, fatal: onFatal };

  // ---------------------------------------------------------------- queue + stream
  /** Run one attack. Resolves to {ok:true, verdict} or {refused:{status,message}} (the server said no
   *  before any event, so the lab can fall back to the stub) or {failed:true}. */
  function runMode(req, my) {
    const mode = req.mode, step = mode === "undefended" ? 12 : 13;
    return new Promise((resolve) => {
      const ctx = { mode, req, step, my, guardedSet: new Set(A.scene ? A.scene.guarded : []), infected: new Set(), tokens: {}, tmp: {}, inputs: {}, votes: {}, seq: 0, payload: "poisoned", canary: req.goalToken, queue: [], busy: false, streamEnded: false, got: 0, result: null };
      cur = ctx;
      A.steps.goTo(step, { snap: true, fromLive: true });
      showVerdict(null); showMsg("");

      const finish = (result) => {
        if (ctx.finished) return; ctx.finished = true;
        if (ctx.stream) ctx.stream.close();
        if (cur === ctx) cur = null;
        resolve(result || ctx.result || { failed: true });
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
          A.logs.note(`display error while handling "${ev.type}": ${(e && e.message) || e}`);
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
          A.logs.note("backend unreachable and no recorded run is available");
          showMsg("Backend unreachable. Start it with: python -m demo.server", true);
          ctx.end(); return;
        }
        A.logs.note("backend unreachable; replaying a recorded run (it ignores the payload you entered)");
        showMsg("Replaying recorded run", false);
        evs.forEach((e) => ctx.queue.push(JSON.parse(JSON.stringify(e))));
        ctx.end();
      };

      ctx.stream = A.api.stream(req, {
        onEvent: (ev) => { ctx.got++; ctx.push(ev); },
        onDone: () => ctx.end(),
        onRefused: (status, message) => {
          if (ctx.finished || ctx.my !== token) return;
          finish({ refused: { status, message } });
        },
        onUnreachable: () => { if (!ctx.finished && ctx.my === token) replay(); },
        onError: (msg) => {
          if (ctx.finished || ctx.my !== token) return;
          A.logs.note("error: " + msg);
          showMsg(msg, true);
          ctx.end();
        },
      });
    });
  }

  A.live = {
    /** req: {mode, backend, alloc, budget, guardModel, seed, goalToken, preset | payload}. */
    async start(req) {
      if (A.state.running) return { failed: true };
      const my = ++token;
      A.state.running = true; A.emit("runstate");
      try {
        return await runMode(req, my);
      } finally {
        if (my === token) { A.state.running = false; A.emit("runstate"); }
      }
    },
    abort() {
      token++;
      if (activeTl) activeTl.kill();
      if (activeRes) { const r = activeRes; activeRes = null; r(); }
      if (cur) cur.finish({ failed: true });
      A.state.running = false; A.emit("runstate");
      showMsg(""); showVerdict(null);
    },
    running: () => A.state.running,
  };
})(window.App);
