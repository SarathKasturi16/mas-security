/* Live runs (steps 11 and 12): stream /api/run over SSE, feed events into an animation
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

  function onAgentStart(ev, ctx) {
    const sc = A.scene, nv = nodeOf(ev.node);
    ctx.inputs[ev.node] = ev.input;
    const pr = preds(ev.node);
    const len = (ev.input || "").length;
    A.logs.add(ctx.mode, "AGENT", ev.node,
      pr.length ? `${ev.node} receives hand-off from ${pr.join(", ")} (${len} chars)` : `${ev.node} reads the target page (${len} chars)`,
      [["input", ev.input || ""]], ev);
    if (!nv) return null;
    const tl = gsap.timeline();
    A.G.setState(nv, "active", 0.3, tl, 0);
    let sources = [];
    if (pr.length) sources = sc.edges.filter((e) => e.to === ev.node && ctx.infected.has(e.from));
    else if (ctx.payload !== "clean") sources = sc.webEdges.filter((w) => w.to === ev.node);
    const toks = []; let end = 0.45;
    sources.forEach((e, i) => {
      const tok = A.fx.token(sc.L.tmp, "attack"); toks.push(tok);
      const at = 0.1 + i * 0.12;
      const fin = A.fx.travel(tl, tok, e, at, A.dur(0.9), ++ctx.seq);
      A.G.edgeStyle(e, "hot", 0.25, tl, at + 0.1);
      end = Math.max(end, fin);
    });
    ctx.tokens[ev.node] = { toks, edges: sources };
    return padTo(tl, end);
  }

  function onVote(ev, ctx) {
    const sc = A.scene, nv = nodeOf(ev.node);
    const votes = ev.votes || [], k = ev.k || votes.length, models = ev.models || [];
    const blocks = votes.filter(Boolean).length, cps = (ev.checkpoint || []).join("+") || "checkpoint";
    const det = votes.map((v, i) => [`G${i + 1}${models[i] ? " (" + models[i] + ")" : ""}`, v ? "BLOCK" : "PASS"]);
    det.push(["rule", ev.rule || "any"]);
    ctx.votes[ev.node] = ev;
    A.logs.add(ctx.mode, ev.blocked ? "BLOCK" : "GUARD", ev.node,
      ev.blocked ? `${cps} guards ${blocks}/${k}: BLOCK — ContextWipe applied` : `${cps} guards ${blocks}/${k}: PASS`, det, ev);
    if (!nv) return null;
    const tl = gsap.timeline(), tmp = [];
    const compact = k > 8, cw = compact ? 40 : 124, perRow = compact ? 14 : 6;
    const rows = Math.ceil(k / perRow);
    const hh = 38 * nv.sc;
    // chips + banner go above the node when there is room, otherwise below it
    const above = nv.y - hh - 34 - (rows - 1) * 42 - 17 - 70 >= 0;
    const dir = above ? -1 : 1;
    const rowW = Math.min(k, perRow) * cw - 8;
    const cx = Math.max(40 + rowW / 2, Math.min(1560 - rowW / 2, nv.x));
    const rowY = (r) => nv.y + dir * (hh + 34 + r * 42);
    votes.forEach((v, i) => {
      const r = Math.floor(i / perRow), c = i - r * perRow, inRow = Math.min(perRow, k - r * perRow);
      const x = cx + (c - (inRow - 1) / 2) * cw, y = rowY(r);
      const ch = chipEl(v, models[i] || "guard " + (i + 1), compact);
      sc.L.tmp.appendChild(ch); gsap.set(ch, { x, y: y - dir * 10, autoAlpha: 0 });
      tl.to(ch, { autoAlpha: 1, y, duration: A.dur(0.25), ease: "power2.out" }, 0.05 + i * (A.rm() ? 0 : 0.1));
      tmp.push(ch);
    });
    const tChips = 0.3 + (A.rm() ? 0 : 0.1 * (k - 1));
    const tVerdict = tChips + 0.4;
    const bw = 380, bx = Math.max(40 + bw / 2, Math.min(1560 - bw / 2, nv.x));
    const by = rowY(rows - 1) + dir * (17 + 40);
    ctx.wipeBelow = above;                            // the ContextWipe tag takes the opposite side
    const banner = bannerEl(ev.blocked ? "BLOCKED - attack stopped" : "ALLOWED - input clean", ev.blocked, bw);
    sc.L.tmp.appendChild(banner); gsap.set(banner, { x: bx, y: by, autoAlpha: 0, scale: 0.9, transformOrigin: "50% 50%" });
    tmp.push(banner);
    tl.to(banner, { autoAlpha: 1, scale: 1, duration: A.dur(0.25), ease: "back.out(2)" }, tVerdict);
    tmp.push(banner);
    if (ev.blocked) {
      const tk = ctx.tokens[ev.node];
      if (!A.rm()) {
        tl.to(nv.shield, { scale: 1.25, duration: 0.12 }, tVerdict).to(nv.shield, { scale: 0.85, duration: 0.3, ease: "back.out(3)" }, tVerdict + 0.12);
        tl.set(nv.shield.firstChild, { attr: { fill: "#fff" } }, tVerdict).set(nv.shield.firstChild, { attr: { fill: C.shieldFill } }, tVerdict + 0.12);
        tl.to(nv.g, { x: nv.x + 4, duration: 0.04, repeat: 3, yoyo: true }, tVerdict + 0.05).set(nv.g, { x: nv.x }, tVerdict + 0.25);
      }
      if (tk) {
        for (const tok of tk.toks) {
          tl.to(tok.all, { autoAlpha: 0, duration: 0.1 }, tVerdict);
          A.fx.shatter(tl, nv.x - 84 * nv.sc, nv.y, tVerdict);
        }
        for (const e of tk.edges) A.G.edgeStyle(e, "cut", 0.25, tl, tVerdict);
      }
    }
    ctx.tmp[ev.node] = tmp;
    return padTo(tl, tVerdict + 0.75);
  }

  function onOutput(ev, ctx) {
    const sc = A.scene, nv = nodeOf(ev.node);
    const out = succ(ev.node), tgt = out.length ? out.join(", ") : "end of chain";
    const detail = [["input", ctx.inputs[ev.node] || ""], ["output", ev.output || ""], ["upstream", (ev.upstream || []).join(", ") || "(target page)"]];
    const vt = ctx.votes[ev.node];
    if (vt) detail.push(["guard votes", (vt.votes || []).map((v) => (v ? "BLOCK" : "PASS")).join(" ") + "  rule=" + (vt.rule || "any")]);
    let level, msg;
    if (ev.error) { level = "ERROR"; msg = `${ev.node}: backend error — ${trunc((ev.output || "").replace(/\s+/g, " "), 110)}`; }
    else if (ev.wiped) { level = "CLEAN"; msg = `${ev.node} → ${tgt}: ContextWipe applied, sanitised summary forwarded — clean`; }
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
      A.G.setState(nv, "blocked", 0.25, tl, 0);
      const hw = 84 * nv.sc, hh = 38 * nv.sc;
      if (!A.rm()) {
        const wipe = svg("rect", { x: -60, y: -hh - 4, width: 120, height: 2 * hh + 8, fill: "url(#wipe-grad)" });
        sc.L.tmp.appendChild(wipe); gsap.set(wipe, { x: nv.x - hw - 120, y: nv.y });
        tl.to(wipe, { x: nv.x + hw, duration: 0.5, ease: "power2.inOut" }, 0.3).call(() => wipe.remove(), null, 0.85);
      }
      A.G.setState(nv, "clean", 0.4, tl, 0.8);
      const tag = mkG(sc.L.tmp);
      const tw0 = 292;
      tag.append(svg("rect", { x: -tw0 / 2, y: -17, width: tw0, height: 34, rx: 17, fill: "#fff", stroke: C.block, "stroke-width": 2.5 }),
        svg("text", { y: 6, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: C.block }, "ContextWipe: memory cleared"));
      const ty = ctx.wipeBelow === false ? nv.y - hh - 30 : nv.y + hh + 30;
      gsap.set(tag, { x: Math.max(40 + tw0 / 2, Math.min(1560 - tw0 / 2, nv.x)), y: ty, autoAlpha: 0 });
      tl.to(tag, { autoAlpha: 1, duration: 0.2 }, 0.8).to(tag, { autoAlpha: 0, duration: 0.3 }, 2.5).call(() => tag.remove(), null, 2.9);
      end = 1.25;
    } else if (ev.compromised) {
      absorb(); A.G.setState(nv, "compromised", 0.35, tl, 0.1);
      if (!A.rm()) tl.to(nv.g, { x: nv.x + 4, duration: 0.04, repeat: 3, yoyo: true }, 0.1).set(nv.g, { x: nv.x }, 0.3);
    } else {
      absorb(); A.G.setState(nv, "clean", 0.35, tl, 0.05);
    }
    // chips / banner from the guard vote fade a moment later
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
      sub = ev.rep_pwned ? "reporter taken over too" : "attack reached the key agent";
      level = "INFECT"; msg = `RESULT: ${crit.join(", ") || "orchestrator"} COMPROMISED${ev.rep_pwned ? ", reporter COMPROMISED" : ""}`;
    } else if (blocked.length) {
      verdictKind = "blocked"; text = "BLOCKED - attack stopped"; sub = "blocked at " + blocked.join(", ");
      level = "CLEAN"; msg = `RESULT: ${crit.join(", ") || "orchestrator"} clean — attack blocked at ${blocked.join(", ")}`;
    } else {
      verdictKind = "ok"; text = "No compromise"; sub = "no hostile content reached the team";
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
    const step = mode === "undefended" ? 11 : 12;
    return new Promise((resolve) => {
      const ctx = { mode, step, my, infected: new Set(), tokens: {}, tmp: {}, inputs: {}, votes: {}, seq: 0, payload: "poisoned", queue: [], busy: false, streamEnded: false, got: 0 };
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
