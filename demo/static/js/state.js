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
    budget: clampInt(num("budget", 10), 3, 15),
    alloc: q.get("alloc") === "uniform" ? "uniform" : "risk",
    // The Attack lab tries Groq first and falls back to the offline stub; ?backend=stub starts on the stub.
    // A page load never starts a run by itself.
    backend: q.get("backend") === "stub" ? "stub" : "groq",
    guardModel: q.get("guard_model") === "sim" ? "sim" : "heuristic",
    seed: clampInt(num("seed", 0), 0, 1000000),
    tab: "algo",                // "algo" | "lab"
    plan: null,                 // /api/plan response for the current selection
    step: 0,
    speed: 1,
    rm: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    labels: true,
    running: false,             // a live run is streaming / animating
    params: q,
  };
  A.LAST_STEP = 14;
  // The Algorithm tab walks these internal step indices in order; 12 and 13 (the live runs) belong to the Attack lab.
  A.SEQ = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14];
  A.LAST_POS = A.SEQ.length - 1;          // the counter reads "Step k / 12"
  A.GOAL_TOKEN = "[[PWNED:exfil-creds]]"; // default goal token of the bundled presets

  /** Smallest legal budget = number of checkpoints (each needs >= 1 guard). */
  A.minBudget = () => Math.max(3, A.state.plan ? A.state.plan.checkpoints.length : 3);
})(window.App);
