/* Shared mutable state + tiny pub/sub. */
(function (A) {
  "use strict";
  const handlers = {};
  A.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  A.emit = (name, arg) => { for (const fn of handlers[name] || []) fn(arg); };

  const q = new URLSearchParams(location.search);
  const num = (k, d) => { const v = parseFloat(q.get(k)); return isFinite(v) ? v : d; };
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

  A.state = {
    manifest: q.get("manifest") || "pentest7_poc",
    manifests: [],
    budget: clampInt(num("budget", 10), 3, 30),
    alloc: q.get("alloc") === "uniform" ? "uniform" : "risk",
    // A link must never start a paid run by itself: ?auto= always uses the offline stub.
    backend: q.get("backend") === "groq" && !q.get("auto") ? "groq" : "stub",
    guardModel: q.get("guard_model") === "sim" ? "sim" : "heuristic",
    seed: clampInt(num("seed", 0), 0, 1000000),
    clean: q.get("clean") === "1",
    plan: null,                 // /api/plan response for the current selection
    step: 0,
    playing: false,
    speed: 1,
    rm: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    labels: true,
    running: false,             // a live run is streaming / animating
    done: { undefended: false, defended: false },
    params: q,
  };
  A.LAST_STEP = 13;
  A.LIVE_STEPS = { 11: "undefended", 12: "defended" };

  /** Smallest legal budget = number of checkpoints (each needs >= 1 guard). */
  A.minBudget = () => Math.max(3, A.state.plan ? A.state.plan.checkpoints.length : 3);
})(window.App);
