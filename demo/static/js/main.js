/* Bootstrap: load manifests + plan, build the scene, wire every control, headless hooks. */
(function (A) {
  "use strict";
  const { $, el } = A;
  const st = A.state;
  gsap.registerPlugin(MotionPathPlugin, DrawSVGPlugin, Flip);
  window.__runComplete = false;
  window.__stepReady = -1;

  function fatalScreen(msg) {
    const m = $("stage-msg");
    m.textContent = msg; m.className = "stage-msg err"; m.hidden = false;
  }

  // ---------------------------------------------------------------- plan loading
  /** Fetch the plan; if the budget is below the number of checkpoints, raise it until accepted. */
  async function fetchPlan() {
    let b = Math.min(st.budget, 30), lastErr = null;
    for (let i = 0; i < 28 && b <= 30; i++, b++) {
      try { return await A.api.plan(st.manifest, b, st.alloc); }
      catch (e) { lastErr = e; if (e.http !== 400) throw e; }
    }
    throw lastErr || new Error("No feasible guard budget (3-30) for this team");
  }

  // Last selection the server accepted; the controls roll back to it if a new request fails.
  const committed = { manifest: st.manifest, budget: st.budget, alloc: st.alloc };
  let reqSeq = 0;

  /** Resolves to the plan, or null when a newer request superseded this one (its result is dropped). */
  async function loadPlan(keepStep) {
    const id = ++reqSeq;
    let plan;
    try { plan = await fetchPlan(); }
    catch (e) {
      if (id === reqSeq) {                       // only the newest request may roll back
        st.manifest = committed.manifest; st.budget = committed.budget; st.alloc = committed.alloc;
        syncControls();
      }
      throw e;
    }
    if (id !== reqSeq) return null;
    st.plan = plan; st.budget = plan.budget; st.alloc = plan.alloc;
    committed.manifest = st.manifest; committed.budget = plan.budget; committed.alloc = plan.alloc;
    st.done.undefended = false; st.done.defended = false;
    syncControls();
    A.buildScene(plan);
    if (keepStep !== false) A.steps.refresh();
    return plan;
  }

  function syncControls() {
    const r = $("rng-budget");
    r.min = String(A.minBudget()); r.value = String(st.budget);
    $("out-budget").textContent = String(st.budget);
    for (const [id, v] of [["alloc-risk", "risk"], ["alloc-uniform", "uniform"]]) {
      const on = st.alloc === v;
      $(id).classList.toggle("on", on); $(id).setAttribute("aria-checked", String(on));
    }
    $("sel-manifest").value = st.manifest;
  }

  async function reload() {
    try { await loadPlan(); }
    catch (e) { fatalScreen("Could not load the plan (kept the previous one): " + e.message); }
  }

  A.main = {
    reload,
    /** Used by live runs when the server's run uses a different manifest than the one shown. */
    async switchManifest(id) {
      st.manifest = id;
      await loadPlan(false);
    },
  };

  // ---------------------------------------------------------------- controls
  function buildDots() {
    const ol = $("dots");
    A.steps.TITLES.forEach((t, i) => {
      const li = el("li");
      const b = el("button", "dot"); b.type = "button";
      b.setAttribute("aria-label", `Step ${i}: ${t}`); b.title = `${i}. ${t}`;
      b.appendChild(el("i"));
      b.addEventListener("click", () => { if (!A.state.running) A.steps.goTo(i); });
      li.appendChild(b); ol.appendChild(li);
    });
  }

  /** Compact progress (shown instead of the dots on narrow windows). */
  function updateProgress(n, run) {
    const last = A.LAST_STEP;
    $("prog-txt").textContent = `Step ${n} / ${last}`;
    $("prog-fill").style.width = (100 * n / last) + "%";
    const bar = $("prog-bar");
    bar.setAttribute("aria-valuenow", String(n));
    bar.setAttribute("aria-valuetext", `Step ${n} of ${last}: ${A.steps.TITLES[n] || ""}`);
    bar.setAttribute("aria-disabled", String(!!run));
  }

  function wireProgress() {
    const bar = $("prog-bar");
    bar.addEventListener("click", (e) => {
      if (st.running) return;
      const r = bar.getBoundingClientRect();
      if (r.width <= 0) return;
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      A.steps.goTo(Math.round(f * A.LAST_STEP));
    });
    bar.addEventListener("keydown", (e) => {
      if (st.running) return;
      const n = A.steps.cur();
      let to = null;
      if (e.key === "Home") to = 0;
      else if (e.key === "End") to = A.LAST_STEP;
      else if (e.key === "ArrowUp" || e.key === "PageUp") to = Math.min(A.LAST_STEP, n + 1);
      else if (e.key === "ArrowDown" || e.key === "PageDown") to = Math.max(0, n - 1);
      if (to === null) return;       // Left/Right are handled by the global step shortcuts
      e.preventDefault(); A.steps.goTo(to);
    });
  }

  /** Settings popover (used when the strip is collapsed on narrow windows). */
  function wireSettings() {
    const btn = $("btn-settings"), strip = $("strip");
    const isOpen = () => strip.classList.contains("open");
    function setOpen(on, refocus) {
      strip.classList.toggle("open", on);
      btn.setAttribute("aria-expanded", String(on));
      if (on) { const f = strip.querySelector("input:not([disabled]), select:not([disabled]), button:not([disabled])"); if (f) f.focus(); }
      else if (refocus) btn.focus();
    }
    btn.addEventListener("click", () => setOpen(!isOpen(), true));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) { e.stopPropagation(); setOpen(false, true); }
    }, true);
    document.addEventListener("pointerdown", (e) => {
      if (isOpen() && !strip.contains(e.target) && !btn.contains(e.target)) setOpen(false, false);
    }, true);
    window.addEventListener("resize", () => { if (isOpen() && !btn.offsetParent) setOpen(false, false); });
  }

  function updateButtons() {
    const n = A.steps.cur(), mode = A.LIVE_STEPS[n];
    const run = !!st.running;
    document.querySelector(".hdr").classList.toggle("busy", run);
    $("btn-prev").disabled = n <= 0 || run;
    updateProgress(n, run);
    document.querySelectorAll("#dots .dot").forEach((d) => { d.disabled = run; });
    const waiting = !!mode && !st.done[mode];
    $("next-label").textContent = waiting ? "Run" : "Next";
    $("btn-next").classList.toggle("run-primary", waiting);
    $("btn-next").disabled = run || (n >= A.LAST_STEP);
    $("play-label").textContent = st.playing ? "Pause" : "Play";
    $("btn-play").setAttribute("aria-label", st.playing ? "Pause" : "Play");
    $("btn-next").setAttribute("aria-label", waiting ? "Run this step" : "Next step");
    for (const id of ["btn-run-u", "btn-run-d", "btn-run-b"]) $(id).disabled = run;
    for (const id of ["sel-manifest", "rng-budget", "alloc-risk", "alloc-uniform", "sel-backend", "sel-guard", "num-seed", "tg-clean"]) $(id).disabled = run;
    $("btn-run-u").classList.toggle("run-primary", n === 12 && !st.done.undefended);
    $("btn-run-d").classList.toggle("run-primary", n === 13 && !st.done.defended);
  }

  function wire() {
    wireProgress(); wireSettings();
    $("btn-prev").addEventListener("click", () => A.steps.prev());
    $("btn-next").addEventListener("click", () => A.steps.next());
    $("btn-play").addEventListener("click", () => A.steps.togglePlay());
    $("btn-run-u").addEventListener("click", () => { A.steps.stopPlay(); A.live.start("undefended"); });
    $("btn-run-d").addEventListener("click", () => { A.steps.stopPlay(); A.live.start("defended"); });
    $("btn-run-b").addEventListener("click", () => { A.steps.stopPlay(); A.live.start("both"); });
    $("btn-reset").addEventListener("click", () => A.steps.resetStep());
    $("btn-restart").addEventListener("click", () => A.steps.restart());

    $("sel-manifest").addEventListener("change", (e) => { st.manifest = e.target.value; reload(); });
    $("rng-budget").addEventListener("input", (e) => { $("out-budget").textContent = e.target.value; });
    $("rng-budget").addEventListener("change", (e) => {
      st.budget = Math.max(A.minBudget(), Math.min(30, parseInt(e.target.value, 10) || st.budget));
      reload();
    });
    for (const [id, v] of [["alloc-risk", "risk"], ["alloc-uniform", "uniform"]]) {
      $(id).addEventListener("click", () => { if (st.alloc !== v) { st.alloc = v; reload(); } });
    }
    $("rng-speed").addEventListener("input", (e) => setSpeed(parseFloat(e.target.value)));
    $("tg-rm").addEventListener("change", (e) => setRM(e.target.checked));
    $("tg-labels").addEventListener("change", (e) => { st.labels = e.target.checked; $("svg").classList.toggle("hide-sec", !st.labels); });
    $("sel-backend").addEventListener("change", (e) => { st.backend = e.target.value; });
    $("sel-guard").addEventListener("change", (e) => { st.guardModel = e.target.value; });
    $("num-seed").addEventListener("change", (e) => { st.seed = Math.max(0, Math.min(1000000, parseInt(e.target.value, 10) || 0)); e.target.value = String(st.seed); });
    $("tg-clean").addEventListener("change", (e) => { st.clean = e.target.checked; });

    $("svg").addEventListener("click", (e) => {
      const g = e.target.closest && e.target.closest(".gate-hit");
      if (g && g.dataset.id) A.steps.replayGate(g.dataset.id);
    });

    document.addEventListener("keydown", (e) => {
      const t = e.target, tag = t && t.tagName;
      const typing = tag === "INPUT" && t.type !== "range" && t.type !== "checkbox" || tag === "TEXTAREA";
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" && !typing) { e.preventDefault(); A.logs.focusSearch(); return; }
      if (e.key === "Escape") { if (A.logs.isOpen()) A.logs.close(); if (typing) t.blur(); return; }
      if (typing || tag === "SELECT") return;
      if (e.key === "ArrowRight") { e.preventDefault(); A.steps.next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); A.steps.prev(); }
      else if (e.key === " " && tag !== "BUTTON") { e.preventDefault(); A.steps.next(); }
      else if (e.key === "p" || e.key === "P") A.steps.togglePlay();
      else if (e.key === "l" || e.key === "L") A.logs.toggle();
      else if (e.key === "r" || e.key === "R") { $("tg-rm").checked = !st.rm; setRM(!st.rm); }
    });

    A.on("runstate", updateButtons);
    A.on("playstate", updateButtons);
    A.on("chrome", updateButtons);
    A.on("drawer", (open) => { if (A.steps.isLive(A.steps.cur())) A.G.compact(open); });
    let rz;
    window.addEventListener("resize", () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (A.scene && A.steps.isLive(A.steps.cur())) A.G.compact(A.logs.isOpen(), 0); }, 120);
    });
  }

  function setSpeed(v) {
    st.speed = v;
    gsap.globalTimeline.timeScale(v);
    $("out-speed").textContent = v.toFixed(1) + "x";
    $("rng-speed").value = String(Math.min(2, Math.max(0.5, v)));
  }
  function setRM(on) {
    st.rm = on;
    document.body.classList.toggle("rm", on);
    $("tg-rm").checked = on;
  }

  // ---------------------------------------------------------------- start-up
  async function init() {
    buildDots();
    wire();
    A.logs.init();
    setRM(st.rm);
    const qs = st.params;
    const sp = parseFloat(qs.get("speed"));
    const auto = qs.get("auto");
    setSpeed(isFinite(sp) && sp > 0 ? sp : (auto ? 3 : 1));
    if (qs.get("rm") === "1") setRM(true);
    $("sel-backend").value = st.backend; $("sel-guard").value = st.guardModel;
    $("num-seed").value = String(st.seed); $("tg-clean").checked = st.clean;

    let manifests;
    try { manifests = await A.api.manifests(); }
    catch (e) { fatalScreen("Cannot reach the backend (" + e.message + "). Start it with: python -m demo.server"); return; }
    st.manifests = manifests;
    const sel = $("sel-manifest");
    for (const m of manifests) { const o = el("option", null, m.id + " (" + m.nodes + " agents)"); o.value = m.id; o.title = m.title; sel.appendChild(o); }
    if (!manifests.some((m) => m.id === st.manifest)) st.manifest = manifests[0].id;
    committed.manifest = st.manifest;

    try { await loadPlan(false); }
    catch (e) { fatalScreen("Could not load the plan: " + e.message); return; }
    if (A.api.offline) fatalScreen("Backend offline: showing the recorded pentest7 plan");

    const stepParam = parseInt(qs.get("step"), 10);
    if (auto) {
      const kind = ["undefended", "defended", "both"].includes(auto) ? auto : "undefended";
      A.steps.snap(kind === "defended" ? 13 : 12);
      if (qs.get("layout") === "side") { A.logs.setView("side"); }
      await A.live.start(kind);
      window.__runComplete = true;
    } else if (isFinite(stepParam)) {
      A.steps.snap(Math.max(0, Math.min(A.LAST_STEP, stepParam)));
    } else {
      A.steps.intro();
    }
    updateButtons();
  }
  init().catch((e) => { console.error(e); fatalScreen("Start-up failed: " + e.message); });
})(window.App);
