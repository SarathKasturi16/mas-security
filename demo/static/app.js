/* Trust-Aware Topological Linearization — live demo client.
 * Vanilla JS, no dependencies. SECURITY: every string that originates from the SSE
 * stream (agent output/input, labels, model names, errors) is written with
 * textContent / text nodes only. This file never uses innerHTML/insertAdjacentHTML.
 */
(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // The topology is always the same 7 nodes; fixed layout (viewBox units).
  const NODE_W = 185, NODE_H = 70;
  const LAYOUT = {
    recon:        { x: 10,  y: 28 },
    scan_web:     { x: 10,  y: 128 },
    scan_net:     { x: 10,  y: 228 },
    analysis:     { x: 255, y: 128 },
    exploit:      { x: 500, y: 68 },
    orchestrator: { x: 500, y: 188 },
    reporter:     { x: 745, y: 128 },
  };
  const VIEW_W = 940, VIEW_H = 320;

  // Used only until run_start delivers the real topology.
  const DEFAULT_TOPOLOGY = {
    nodes: [
      { id: "recon", label: "Recon", weight: null },
      { id: "scan_web", label: "Web Scanner", weight: null },
      { id: "scan_net", label: "Net Scanner", weight: null },
      { id: "analysis", label: "Analysis", weight: null },
      { id: "exploit", label: "Exploit", weight: null },
      { id: "orchestrator", label: "Orchestrator", weight: null },
      { id: "reporter", label: "Reporter", weight: null },
    ],
    edges: [
      { from: "recon", to: "analysis" }, { from: "scan_web", to: "analysis" },
      { from: "scan_net", to: "analysis" }, { from: "analysis", to: "exploit" },
      { from: "analysis", to: "orchestrator" }, { from: "exploit", to: "reporter" },
      { from: "orchestrator", to: "reporter" },
    ],
    entry: ["recon", "scan_web", "scan_net"],
    critical: ["orchestrator", "reporter"],
  };

  const STATE_TEXT = {
    pending: "PENDING", active: "RUNNING", clean: "CLEAN",
    compromised: "COMPROMISED", blocked: "BLOCKED", error: "ERROR",
  };

  // ---------------------------------------------------------------- helpers
  const $ = (id) => document.getElementById(id);

  /** Create an element; `text` (if given) is set via textContent (never HTML). */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function svgEl(tag, attrs, text) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) n.setAttribute(k, String(attrs[k]));
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function fmtWeight(w) {
    if (typeof w === "number" && isFinite(w)) return "weight " + String(+w.toFixed(2));
    if (w === null || w === undefined) return "";
    return "weight " + String(w);
  }

  // ---------------------------------------------------------------- app state
  const app = {
    layout: "single",       // "single" | "side"
    panels: [],
    running: false,
    token: 0,               // bumped on start / Clear to cancel stale callbacks
    cancel: null,           // cancels the in-flight stream
    markerSeq: 0,
  };

  // ---------------------------------------------------------------- graph
  function buildGraph(panel, topology) {
    const topo = topology || DEFAULT_TOPOLOGY;
    const uid = ++app.markerSeq;
    const entrySet = new Set(topo.entry || []);
    const critSet = new Set(topo.critical || []);
    const guardSet = new Set(panel.guarded || []);

    const svg = svgEl("svg", {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Agent pipeline graph",
    });

    // Arrowheads, one per edge colour.
    const defs = svgEl("defs");
    const markerColours = { pending: "#5b6475", clean: "#4ade80", compromised: "#f87171", blocked: "#fbbf24" };
    for (const k of Object.keys(markerColours)) {
      const m = svgEl("marker", {
        id: `ah-${k}-${uid}`, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse",
      });
      m.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: markerColours[k] }));
      defs.appendChild(m);
    }
    svg.appendChild(defs);

    // Resolve a position for every node (unknown ids get a spare slot at the bottom).
    const pos = {};
    let spare = 0;
    for (const n of topo.nodes) {
      pos[n.id] = LAYOUT[n.id] || { x: 255 + 245 * (spare++ % 2), y: 250 };
    }

    // Edges first (so boxes sit on top).
    const edgeEls = [];
    const gEdges = svgEl("g");
    for (const e of topo.edges || []) {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) continue;
      let d;
      if (Math.abs(a.x - b.x) < 10) {            // same column: vertical link
        const down = b.y > a.y;
        d = `M${a.x + NODE_W / 2},${a.y + (down ? NODE_H : 0)} L${b.x + NODE_W / 2},${b.y + (down ? 0 : NODE_H)}`;
      } else {
        const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
        const dx = (x2 - x1) / 2;
        d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 2},${y2}`;
      }
      const p = svgEl("path", { d, class: "edge e-pending", "marker-end": `url(#ah-pending-${uid})` });
      gEdges.appendChild(p);
      edgeEls.push({ from: e.from, to: e.to, el: p });
    }
    svg.appendChild(gEdges);

    // Nodes.
    const nodes = {};
    const gNodes = svgEl("g");
    for (const n of topo.nodes) {
      const { x, y } = pos[n.id];
      const g = svgEl("g", { class: "node st-pending", transform: `translate(${x},${y})` });
      g.appendChild(svgEl("title", null, `${n.label || n.id} (${n.id})`));
      g.appendChild(svgEl("rect", { width: NODE_W, height: NODE_H, rx: 12, ry: 12 }));
      g.appendChild(svgEl("text", { class: "n-label", x: 14, y: 30 }, n.label || n.id));
      g.appendChild(svgEl("text", { class: "n-weight", x: 14, y: 55 }, fmtWeight(n.weight)));
      const st = svgEl("text", { class: "n-state", x: NODE_W - 12, y: 55 }, STATE_TEXT.pending);
      g.appendChild(st);
      if (critSet.has(n.id)) g.appendChild(svgEl("text", { class: "n-star", x: NODE_W - 12, y: 29 }, "★"));
      if (entrySet.has(n.id)) g.appendChild(svgEl("text", { class: "n-entry", x: 4, y: -7 }, "⇐target"));
      if (guardSet.has(n.id)) g.appendChild(svgEl("text", { class: "n-guard", x: NODE_W - 2, y: -7 }, "GUARD CHECKPOINT"));
      gNodes.appendChild(g);
      nodes[n.id] = { g, stateEl: st, state: "pending" };
    }
    svg.appendChild(gNodes);

    panel.graph = { svg, nodes, edges: edgeEls, uid };
    panel.graphWrap.replaceChildren(svg);
  }

  function setNodeState(panel, id, state) {
    const gr = panel.graph;
    if (!gr || !gr.nodes[id]) return;
    const n = gr.nodes[id];
    n.state = state;
    n.g.setAttribute("class", "node st-" + state);
    n.stateEl.textContent = STATE_TEXT[state] || state;
    // Edges are coloured by the state of the data they carry (their source).
    for (const e of gr.edges) {
      if (e.from !== id) continue;
      const k = state === "compromised" ? "compromised"
        : state === "blocked" ? "blocked"
        : state === "clean" ? "clean" : "pending";
      e.el.setAttribute("class", "edge e-" + k);
      e.el.setAttribute("marker-end", `url(#ah-${k}-${gr.uid})`);
    }
  }

  // ---------------------------------------------------------------- panels
  function createPanel(title, titleCls) {
    const root = el("section", "panel");
    const head = el("div", "panel-head");
    const h = el("h2", "panel-title " + (titleCls || ""), title);
    const sub = el("span", "panel-sub", "idle");
    head.append(h, sub);
    const graphWrap = el("div", "graph-wrap");
    const bannerSlot = el("div", "banner-slot");
    const log = el("div", "log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    root.append(head, graphWrap, bannerSlot, log);

    const panel = {
      root, titleEl: h, subEl: sub, graphWrap, bannerSlot, log,
      graph: null, guarded: [], topology: null,
      pending: {},   // node -> thinking placeholder (current run)
      cards: {},     // node -> finished card (current run)
      inputs: {},    // node -> input text (current run)
      votes: {},     // node -> guard_vote event (current run)
    };
    resetPanel(panel);
    return panel;
  }

  function showEmpty(panel) {
    panel.log.replaceChildren(
      el("div", "empty", "No run yet. Choose Run Undefended, Run Defended, or Run Both.")
    );
  }

  function resetRunState(panel) {
    panel.pending = {}; panel.cards = {}; panel.inputs = {}; panel.votes = {};
  }

  function resetPanel(panel) {
    resetRunState(panel);
    panel.guarded = [];
    panel.topology = null;
    panel.bannerSlot.replaceChildren();
    panel.subEl.textContent = "idle";
    buildGraph(panel, DEFAULT_TOPOLOGY);
    showEmpty(panel);
  }

  function setPanelTitle(panel, text, cls) {
    panel.titleEl.textContent = text;
    panel.titleEl.className = "panel-title " + (cls || "");
  }

  function buildPanels() {
    const main = $("main");
    main.className = "main " + (app.layout === "side" ? "side" : "single");
    app.panels = [];
    if (app.layout === "side") {
      app.panels.push(createPanel("Undefended", "t-undefended"));
      app.panels.push(createPanel("Defended", "t-defended"));
    } else {
      app.panels.push(createPanel("Ready", ""));
    }
    main.replaceChildren(...app.panels.map((p) => p.root));
  }

  /** Append a node to a panel's log, keeping it pinned to the bottom if the user was there. */
  function appendLog(panel, node, replacing) {
    const log = panel.log;
    const empty = log.querySelector(":scope > .empty");
    if (empty) empty.remove();
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
    if (replacing && replacing.parentNode === log) replacing.replaceWith(node);
    else log.appendChild(node);
    if (stick) log.scrollTop = log.scrollHeight;
  }

  // ---------------------------------------------------------------- cards
  function statusOf(d) {
    if (d.wiped) return "blocked";
    if (d.compromised) return "compromised";
    if (d.error) return "error";
    return "clean";
  }

  const BADGE = {
    clean: "CLEAN",
    compromised: "COMPROMISED",
    blocked: "BLOCKED + ContextWipe",
    error: "ERROR",
  };

  function renderGuards(card, vote) {
    const old = card.querySelector(":scope > .guards");
    if (old) old.remove();
    const votes = Array.isArray(vote.votes) ? vote.votes : [];
    const models = Array.isArray(vote.models) ? vote.models : [];
    const wrap = el("div", "guards");
    wrap.appendChild(el("span", "guards-title", "guard ensemble:"));
    let blocks = 0;
    votes.forEach((v, i) => {
      if (v) blocks++;
      const chip = el("span", "chip " + (v ? "c-block" : "c-pass"));
      chip.appendChild(el("span", "model", models[i] !== undefined ? models[i] : "guard " + (i + 1)));
      chip.appendChild(el("span", "verdict", v ? "BLOCK" : "PASS"));
      wrap.appendChild(chip);
    });
    const verdict = vote.blocked ? "BLOCK" : "PASS";
    const line = el(
      "div", "ensemble " + (vote.blocked ? "e-block" : "e-pass"),
      `ensemble: ${verdict} (${blocks}/${votes.length})`
    );
    line.title = "number of guards voting BLOCK / total guards";
    wrap.appendChild(line);
    card.appendChild(wrap);
  }

  function buildCard(panel, d) {
    const status = statusOf(d);
    const card = el("article", "card s-" + status);
    const head = el("header", "card-head");
    head.appendChild(el("span", "card-label", d.label || d.node));
    head.appendChild(el("code", "card-node", d.node));
    head.appendChild(el("span", "badge b-" + status, BADGE[status]));
    card.appendChild(head);

    const input = panel.inputs[d.node];
    const det = el("details", "card-input");
    det.appendChild(el("summary", null, "input (upstream hand-off)"));
    det.appendChild(el("pre", "card-pre input-pre", input !== undefined && input !== "" ? input : "(no input recorded)"));
    card.appendChild(det);

    const out = d.output !== undefined && d.output !== null && d.output !== "" ? d.output : "(empty reply)";
    card.appendChild(el("pre", "card-pre output-pre" + (d.error ? " is-error" : ""), out));

    const vote = panel.votes[d.node];
    if (vote) renderGuards(card, vote);
    return card;
  }

  function buildThinking(d) {
    const card = el("article", "card s-thinking");
    const head = el("header", "card-head");
    head.appendChild(el("span", "card-label", d.label || d.node));
    head.appendChild(el("code", "card-node", d.node));
    head.appendChild(el("span", "badge b-clean", "RUNNING"));
    card.appendChild(head);
    const t = el("div", "thinking-text");
    t.appendChild(document.createTextNode("…thinking"));
    const dots = el("span", "thinking-dots");
    for (let i = 0; i < 3; i++) dots.appendChild(el("span", null, "."));
    t.appendChild(dots);
    card.appendChild(t);
    return card;
  }

  function buildBanner(ev, mode) {
    const orch = !!ev.orch_pwned, rep = !!ev.rep_pwned;
    const blocked = Array.isArray(ev.blocked_at) ? ev.blocked_at : [];
    const b = el("div", "banner");
    let verdict, detail = "";
    if (orch || rep) {
      b.classList.add("v-bad");
      const parts = [];
      if (orch) parts.push("ORCHESTRATOR COMPROMISED");
      if (rep) parts.push("REPORTER COMPROMISED");
      verdict = parts.join(" / ");
      if (mode === "defended") verdict = "BREACH DESPITE DEFENCE — " + verdict;
      if (blocked.length) detail = "blocked at: " + blocked.join(", ");
    } else {
      b.classList.add("v-good");
      verdict = mode === "defended" ? "CONTAINED — orchestrator clean" : "No compromise detected — orchestrator clean";
      detail = blocked.length ? "blocked at: " + blocked.join(", ") : (mode === "defended" ? "blocked at: (none)" : "");
      if (mode === "defended") detail += (detail ? "  ·  " : "") + "reporter clean";
    }
    b.appendChild(el("div", "verdict", verdict));
    if (detail) b.appendChild(el("div", "detail", detail));
    return b;
  }

  function buildErrorBanner(title, message) {
    const b = el("div", "banner v-err");
    b.appendChild(el("div", "verdict", title));
    if (message) b.appendChild(el("div", "msg", message));
    return b;
  }

  function buildRunHeader(ev) {
    const mode = ev.mode === "defended" ? "defended" : "undefended";
    const card = el("article", "card s-run");
    const head = el("header", "card-head");
    head.appendChild(el("span", "run-title t-" + mode, "▶ " + mode + " run"));
    head.appendChild(el("code", "card-node", "backend: " + (ev.backend !== undefined ? ev.backend : "?")));
    const guarded = Array.isArray(ev.guarded) ? ev.guarded : [];
    head.appendChild(el("code", "card-node", mode === "defended" && guarded.length
      ? "guards at: " + guarded.join(", ") : "no guards"));
    card.appendChild(head);
    // Show the ACTUAL target content read at entry (payload_text), not the mode label.
    const payloadText = (typeof ev.payload_text === "string" && ev.payload_text !== "")
      ? ev.payload_text : null;
    if (payloadText) {
      const det = el("details", "card-input");
      const kind = ev.payload === "clean" ? "clean target content (control)"
        : "injection payload (attacker-controlled target content)";
      det.appendChild(el("summary", null, kind));
      det.appendChild(el("pre", "card-pre input-pre", payloadText));
      card.appendChild(det);
    }
    return card;
  }

  // ---------------------------------------------------------------- event handling
  function handleEvent(panel, ev, ctx) {
    switch (ev.type) {
      case "run_start": {
        ctx.mode = ev.mode === "defended" ? "defended" : "undefended";
        resetRunState(panel);
        panel.guarded = Array.isArray(ev.guarded) ? ev.guarded : [];
        panel.topology = ev.topology || DEFAULT_TOPOLOGY;
        buildGraph(panel, panel.topology);
        panel.bannerSlot.replaceChildren();
        panel.subEl.textContent = "streaming… (" + String(ev.backend) + ")";
        if (app.layout === "single") {
          setPanelTitle(panel, ctx.mode, "t-" + ctx.mode);
        }
        appendLog(panel, buildRunHeader(ev));
        break;
      }
      case "agent_start": {
        panel.inputs[ev.node] = ev.input;
        setNodeState(panel, ev.node, "active");
        const old = panel.pending[ev.node];
        const ph = buildThinking(ev);
        panel.pending[ev.node] = ph;
        appendLog(panel, ph, old);
        break;
      }
      case "guard_vote": {
        panel.votes[ev.node] = ev;
        const done = panel.cards[ev.node];
        if (done) renderGuards(done, ev);        // vote arrived after the card
        break;
      }
      case "agent_output": {
        const status = statusOf(ev);
        setNodeState(panel, ev.node, status);
        const card = buildCard(panel, ev);
        const ph = panel.pending[ev.node];
        delete panel.pending[ev.node];
        panel.cards[ev.node] = card;
        appendLog(panel, card, ph);
        break;
      }
      case "run_end": {
        panel.subEl.textContent = "finished";
        const mk = () => buildBanner(ev, ctx.mode);
        panel.bannerSlot.replaceChildren(mk());
        appendLog(panel, mk());
        // Make sure blocked checkpoints are visibly amber even if a card was missed.
        for (const id of Array.isArray(ev.blocked_at) ? ev.blocked_at : []) {
          if (panel.graph && panel.graph.nodes[id] && panel.graph.nodes[id].state !== "blocked") {
            setNodeState(panel, id, "blocked");
          }
        }
        break;
      }
      case "fatal": {
        panel.subEl.textContent = "error";
        const msg = ev.message !== undefined ? ev.message : "unknown error";
        panel.bannerSlot.replaceChildren(buildErrorBanner("RUN FAILED", msg));
        appendLog(panel, buildErrorBanner("RUN FAILED", msg));
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- streaming
  /** Open one EventSource for one run; resolves when the stream ends (done/error/cancel). */
  function runStream(panel, mode, backend) {
    return new Promise((resolve) => {
      const url = "/api/run?mode=" + encodeURIComponent(mode) +
        "&backend=" + encodeURIComponent(backend) + "&clean=0";
      const ctx = { mode };
      const es = new EventSource(url);
      let finished = false;

      const finish = (errMsg) => {
        if (finished) return;
        finished = true;
        es.close();                       // never let EventSource auto-reconnect (would restart the run)
        if (app.cancel === cancel) app.cancel = null;
        if (errMsg) {
          panel.subEl.textContent = "error";
          panel.bannerSlot.replaceChildren(buildErrorBanner("CONNECTION LOST", errMsg));
          appendLog(panel, buildErrorBanner("CONNECTION LOST", errMsg));
        } else if (panel.subEl.textContent.indexOf("streaming") === 0) {
          panel.subEl.textContent = "finished";
        }
        resolve();
      };
      const cancel = () => finish();
      app.cancel = cancel;

      es.onmessage = (e) => {
        let ev;
        try { ev = JSON.parse(e.data); } catch (_) { return; }
        if (ev && typeof ev === "object") handleEvent(panel, ev, ctx);
      };
      es.addEventListener("done", () => finish());
      es.onerror = () => finish("The event stream to /api/run was interrupted before the run completed. Is the server still running?");
    });
  }

  function setRunning(on) {
    app.running = on;
    for (const id of ["btn-undefended", "btn-defended", "btn-both", "lay-single", "lay-side", "backend"]) {
      $(id).disabled = on;
    }
  }

  async function startRuns(kind) {
    if (app.running) return;
    const my = ++app.token;
    window.__runComplete = false;   // screenshot driver waits on this
    const backend = $("backend").value;
    const modes = kind === "both" ? ["undefended", "defended"] : [kind];

    // Prepare panels.
    if (app.layout === "side") {
      if (kind === "both") app.panels.forEach(resetPanel);
      else resetPanel(app.panels[kind === "undefended" ? 0 : 1]);
    } else {
      resetPanel(app.panels[0]);
    }

    setRunning(true);
    try {
      for (const mode of modes) {
        if (my !== app.token) break;       // cancelled by Clear
        const panel = app.layout === "side"
          ? app.panels[mode === "undefended" ? 0 : 1]
          : app.panels[0];
        await runStream(panel, mode, backend);
      }
    } finally {
      if (my === app.token) {
        setRunning(false);
        window.__runComplete = true;   // all requested runs finished
      }
    }
  }

  function clearAll() {
    app.token++;
    if (app.cancel) app.cancel();
    setRunning(false);
    buildPanels();
  }

  function setLayout(layout) {
    if (app.running || layout === app.layout) return;
    app.layout = layout;
    const single = layout === "single";
    $("lay-single").classList.toggle("active", single);
    $("lay-single").setAttribute("aria-checked", String(single));
    $("lay-side").classList.toggle("active", !single);
    $("lay-side").setAttribute("aria-checked", String(!single));
    buildPanels();
  }

  // ---------------------------------------------------------------- init
  $("btn-undefended").addEventListener("click", () => startRuns("undefended"));
  $("btn-defended").addEventListener("click", () => startRuns("defended"));
  $("btn-both").addEventListener("click", () => startRuns("both"));
  $("btn-clear").addEventListener("click", clearAll);
  $("lay-single").addEventListener("click", () => setLayout("single"));
  $("lay-side").addEventListener("click", () => setLayout("side"));

  buildPanels();

  // Headless auto-run hook (for screenshot capture). Visiting
  //   ?auto=undefended|defended|both&backend=stub[&layout=side]
  // auto-starts that run on load and flips window.__runComplete when done.
  // No effect on normal interactive use (no ?auto param).
  window.__runComplete = false;
  (function autoRun() {
    const q = new URLSearchParams(location.search);
    const auto = q.get("auto");
    if (!auto) return;
    const backend = q.get("backend");
    if (backend) $("backend").value = backend;
    if (q.get("layout") === "side") setLayout("side");
    const kind = ["undefended", "defended", "both"].includes(auto) ? auto : "undefended";
    startRuns(kind);
  })();
})();
