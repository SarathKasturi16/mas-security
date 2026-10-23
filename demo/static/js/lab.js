/* Attack lab: the target panel (preset, editable payload, goal token), the defence switch and the Run attack
 * button. The server only hosts the mock target text; it never fetches a URL. Runs go to /api/run via
 * A.live; output goes to the log viewer. */
(function (A) {
  "use strict";
  const { $, el } = A;
  const st = A.state;

  const MAX_PAYLOAD = 2000;
  const TOKEN_RE = /^[\x21-\x7e]{8,48}$/;           // the server also rejects tokens that occur in normal agent traffic
  const TOKEN_MSG = "Use a distinctive token, 8-48 characters with a symbol, e.g. [[MY-TOKEN-1]]";
  const STUB_ONLY_MSG = "custom payload: running on offline stub (Groq runs only the built-in targets)";
  const LIVE_TOKEN_RE = /^\[\[[A-Za-z0-9:_-]{4,40}\]\]$/;     // the server's stricter rule for live (Groq) runs
  const LIVE_TOKEN_MSG = "Live runs need a token like [[MY-TOKEN-1]] (letters, digits, : _ - inside double brackets)";
  const validToken = (t) => TOKEN_RE.test(t) && /[^A-Za-z0-9]/.test(t);

  const L = {
    targets: null, loading: null, presetId: "", presetBase: "", lastTok: A.GOAL_TOKEN,
    defence: false, busy: false, entered: false, runId: 0,
  };

  /** The preset text as the server will use it for goal token `tok` (the bundled text carries the default token). */
  const presetFor = (tok) => L.presetBase.split(A.GOAL_TOKEN).join(tok);
  /** True when the textarea still holds the unedited preset (for the current token), i.e. we send `preset`. */
  function unedited() {
    if (!L.presetId) return false;
    const t = $("lab-token").value;
    return $("lab-payload").value === presetFor(validToken(t) ? t : L.lastTok);
  }

  /** Groq only runs the built-in targets; a fallback is right only for "busy", "no key" or "live runs off". */
  function canFallBack(r) {
    if (r.status === 429 || r.status === 503) return true;
    if (r.status === 403) return /switched off|offline stub|live .*(off|disabled)/i.test(r.message || "");
    return false;                                      // 403 from the host/origin checks etc.: just show the error
  }

  // ---------------------------------------------------------------- validation + UI state
  function check() {
    const text = $("lab-payload").value, tok = $("lab-token").value;
    if (!text.trim()) return "The payload is empty.";
    if (text.length > MAX_PAYLOAD) return `The payload is over ${MAX_PAYLOAD} characters.`;
    if (!validToken(tok)) return TOKEN_MSG;
    if ($("lab-backend").value === "groq" && unedited() && !LIVE_TOKEN_RE.test(tok)) return LIVE_TOKEN_MSG;   // custom text runs on the stub
    return "";
  }

  function refresh() {
    const text = $("lab-payload").value;
    const c = $("lab-count");
    c.textContent = `${text.length} / ${MAX_PAYLOAD}`;
    c.classList.toggle("over", text.length > MAX_PAYLOAD);
    const problem = check();
    const m = $("lab-msg");
    m.textContent = problem; m.hidden = !problem;
    const busy = L.busy || st.running, loading = planPending();
    $("lab-run").disabled = busy || loading || !!problem;
    $("lab-run").textContent = busy ? "Running..." : "Run attack";
    $("lab-stop").hidden = !busy;
    $("lab-def").disabled = busy || loading;
    const bh = $("lab-backend-hint"), stubOnly = !unedited() && $("lab-backend").value === "groq" && !!text.trim();
    bh.textContent = stubOnly ? STUB_ONLY_MSG : ""; bh.hidden = !stubOnly;
    for (const id of ["lab-preset", "lab-payload", "lab-token", "lab-backend", "lab-guard", "lab-seed"]) $(id).disabled = busy;
    $("lab-def").setAttribute("aria-checked", String(L.defence));
    $("lab-def-txt").textContent = L.defence ? "on" : "off";
    guardsText();
  }

  const planPending = () => !!(A.main && A.main.planPending && A.main.planPending());

  function guardsText() {
    const t = $("lab-guards"), plan = st.plan;
    if (!L.defence || !plan) { t.textContent = L.defence ? "" : "No guards are active."; return; }
    const cps = (plan.checkpoints || []).map((c) => `${c.id} ${c.guards}`).join(", ");
    t.textContent = `Guards per checkpoint: ${cps} (B=${plan.budget}).`;
  }

  // ---------------------------------------------------------------- presets
  /** Load a preset. A goal token the user already changed is kept; the text is shown with that token in it. */
  function setPreset(id) {
    const t = (L.targets || []).find((x) => x.id === id);
    L.presetId = t ? t.id : "";
    L.presetBase = t ? t.text : "";
    if (t) $("lab-preset").value = t.id;
    const tok = $("lab-token");
    if (!tok.value) tok.value = A.GOAL_TOKEN;
    if (validToken(tok.value)) L.lastTok = tok.value;
    $("lab-payload").value = presetFor(L.lastTok);
    refresh();
  }

  /** The token changed: while the textarea is an unedited preset, show the preset with the new token. */
  function onToken() {
    const tok = $("lab-token").value;
    if (validToken(tok)) {
      if (L.presetId && $("lab-payload").value === presetFor(L.lastTok)) $("lab-payload").value = presetFor(tok);
      L.lastTok = tok;
    }
    refresh();
  }

  function loadTargets() {
    if (L.targets) return Promise.resolve();
    if (L.loading) return L.loading;
    L.loading = (async () => {
      const sel = $("lab-preset");
      try {
        L.targets = await A.api.targets();
      } catch (_) {
        L.targets = [];
      }
      sel.replaceChildren();
      if (!L.targets.length) {
        const o = el("option", null, "Custom payload"); o.value = ""; sel.appendChild(o);
        $("lab-payload").value = "";
        if (!$("lab-token").value) $("lab-token").value = A.GOAL_TOKEN;
        refresh();
        return;
      }
      for (const t of L.targets) { const o = el("option", null, t.label); o.value = t.id; sel.appendChild(o); }
      setPreset(L.targets.some((t) => t.id === "nmap_banner") ? "nmap_banner" : L.targets[0].id);
    })();
    return L.loading;
  }

  // ---------------------------------------------------------------- defence switch
  function setDefence(on, instant) {
    if (L.busy || st.running || planPending()) return;
    L.defence = on;
    A.showVerdict(null); $("stage-msg").hidden = true;
    if (A.scene) {
      if (on) A.steps.goTo(13, instant ? { snap: true } : { animate: true });
      else A.steps.goTo(12, { snap: true });
    }
    refresh();
  }

  // ---------------------------------------------------------------- running
  function buildRequest(mode, backend) {
    const text = $("lab-payload").value;
    const req = {
      mode, backend, manifest: st.manifest, alloc: st.alloc, budget: st.budget, guardModel: st.guardModel, seed: st.seed,
      goalToken: $("lab-token").value,
    };
    if (unedited()) req.preset = L.presetId; else req.payload = text;
    return req;
  }

  /** An older server does not know the `manifest` field. For the default team that is harmless: retry without it. */
  const rejectsManifest = (r) => !!r && r.status === 400 && /manifest/i.test(r.message || "") && st.manifest === "pentest7_poc";

  async function run() {
    if (L.busy || st.running || !A.scene || planPending() || check()) return;
    const my = ++L.runId;
    L.busy = true; refresh();
    const mode = L.defence ? "defended" : "undefended";
    let backend = $("lab-backend").value;
    try {
      if (backend === "groq" && !unedited()) {          // the server refuses custom payloads on Groq: don't try
        A.logs.note(STUB_ONLY_MSG);
        backend = "stub";
      }
      const first = backend;
      let res = await A.live.start(buildRequest(mode, backend));
      if (my !== L.runId) return;                       // stopped while it was starting
      if (rejectsManifest(res.refused)) {
        const req = buildRequest(mode, backend); delete req.manifest;
        res = await A.live.start(req);
        if (my !== L.runId) return;
      }
      if (res.refused && first === "groq" && canFallBack(res.refused)) {
        A.logs.note(`groq unavailable: ${res.refused.message}; using offline stub`);
        res = await A.live.start(buildRequest(mode, "stub"));
        if (my !== L.runId) return;
      }
      if (res.refused) {
        A.logs.note(`error: the server refused the run (${res.refused.status}): ${res.refused.message}`);
        const m = $("stage-msg");
        m.textContent = "The server refused the run: " + res.refused.message; m.className = "stage-msg err"; m.hidden = false;
      }
    } finally {
      if (my === L.runId) { L.busy = false; refresh(); }
    }
  }

  /** Idempotent: the Stop button, a tab switch and leave() can all land here for the same run. */
  function stop() {
    if (!L.busy && !st.running) return;
    L.runId++;                                          // the pending run() must not touch the UI any more
    A.live.abort();
    A.logs.note("run stopped");
    L.busy = false; refresh();
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    $("lab-preset").addEventListener("change", (e) => setPreset(e.target.value));
    $("lab-payload").addEventListener("input", refresh);
    $("lab-token").addEventListener("input", onToken);
    $("lab-backend").addEventListener("change", (e) => { st.backend = e.target.value; refresh(); });
    $("lab-guard").addEventListener("change", (e) => { st.guardModel = e.target.value; });
    $("lab-seed").addEventListener("change", (e) => {
      st.seed = Math.max(0, Math.min(1000000, parseInt(e.target.value, 10) || 0)); e.target.value = String(st.seed);
    });
    $("lab-def").addEventListener("click", () => setDefence(!L.defence));
    $("lab-run").addEventListener("click", run);
    $("lab-stop").addEventListener("click", stop);
    A.on("runstate", refresh);
    A.on("plan", () => {
      // The team or budget changed in the lab: the scene was rebuilt, so show the lab view of it again.
      if (st.tab === "lab" && L.entered && !st.running && !L.busy && A.scene) {
        A.showVerdict(null); $("stage-msg").hidden = true;
        A.live.markFeedback();
        A.steps.goTo(L.defence ? 13 : 12, { snap: true });
      }
      refresh();
    });
    A.on("planstate", refresh);
  }

  A.lab = {
    init() {
      $("lab-backend").value = st.backend; $("lab-guard").value = st.guardModel; $("lab-seed").value = String(st.seed);
      wire(); refresh();
    },
    /** Called by the tab switcher once the live team's plan is loaded. */
    async enter() {
      await loadTargets();
      if (st.tab !== "lab") return;                     // the user went back to the Algorithm tab meanwhile
      L.entered = true;
      A.showVerdict(null); $("stage-msg").hidden = true;
      if (A.scene) { A.live.markFeedback(); A.steps.goTo(L.defence ? 13 : 12, { snap: true }); }
      refresh();
    },
    leave() {
      if (L.busy || st.running) stop();
      if (A.scene) for (const e of A.scene.edges) if (e.fb) { e.fb = false; A.G.edgeStyle(e, "default", 0); }   // dashed only in the lab
      A.showVerdict(null); $("stage-msg").hidden = true;
    },
    refresh, setDefence,
    defence: () => L.defence,
  };
})(window.App);
