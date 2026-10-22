/* Bootstrap: load manifests + plan, build the scene, wire the two tabs (Algorithm, Attack lab) and every control. */
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
  let reqSeq = 0, pendingPlans = 0;

  /** True while any plan request is in flight (the lab keeps Run disabled until the scene is rebuilt). */
  const planPending = () => pendingPlans > 0;
  /** True when the loaded plan is the one the controls ask for. */
  const planMatches = () => !!st.plan && committed.manifest === st.manifest && committed.budget === st.budget && committed.alloc === st.alloc;

  /** Resolves to the plan, or null when a newer request superseded this one (its result is dropped). */
  async function loadPlan(keepStep) {
    const id = ++reqSeq;
    pendingPlans++; A.emit("planstate");
    try {
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
      syncControls();
      A.buildScene(plan);
      if (keepStep !== false) A.steps.refresh();
      A.emit("plan", plan);
      return plan;
    } finally {
      pendingPlans--; A.emit("planstate");
    }
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

  /** The Groq runs are capped server-side; keep the slider inside that cap in the lab (synchronous). */
  function capBudget() {
    const cap = st.tab === "lab" && st.backend === "groq" ? A.LIVE_BUDGET_MAX : 30;
    $("rng-budget").max = String(cap);
    if (st.budget > cap) st.budget = cap;
  }
  /** Apply the cap and redraw the plan when it no longer matches the controls. */
  async function applyBudgetCap() {
    capBudget();
    if (!planMatches()) await reload();
  }

  A.main = {
    reload, applyBudgetCap, planPending,
    /** Used by live runs when the server's run uses a different manifest/budget/split than the one shown. */
    async syncPlan(o) {
      if (o.manifest) st.manifest = o.manifest;
      if (o.budget != null) st.budget = o.budget;
      if (o.alloc) st.alloc = o.alloc;
      await loadPlan(false);
    },
    async switchManifest(id) { await A.main.syncPlan({ manifest: id }); },
  };

  // ---------------------------------------------------------------- controls
  function buildDots() {
    const ol = $("dots");
    A.SEQ.forEach((n, i) => {
      const t = A.steps.TITLES[n];
      const li = el("li");
      const b = el("button", "dot"); b.type = "button";
      b.setAttribute("aria-label", `Step ${i}: ${t}`); b.title = `${i}. ${t}`;
      b.appendChild(el("i"));
      b.addEventListener("click", () => { if (st.tab === "algo") A.steps.goTo(n); });
      li.appendChild(b); ol.appendChild(li);
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
    const n = A.steps.cur(), run = !!st.running, lab = st.tab === "lab";
    $("btn-prev").disabled = A.steps.seqPrev(n) < 0;
    $("btn-next").disabled = A.steps.seqNext(n) < 0;
    for (const id of ["rng-budget", "alloc-risk", "alloc-uniform"]) $(id).disabled = run;
    $("sel-manifest").disabled = run || lab;
    $("sel-manifest").title = lab ? "The Attack lab uses the 7-agent pentest team (the only team with live agents)" : "";
  }

  // ---------------------------------------------------------------- tabs
  // What the Algorithm tab had when the lab was entered; restored synchronously on the way back so that a quick
  // lab -> algo -> lab sequence never stashes the lab's own values.
  let algoStep = 0, algoManifest = null, algoBudget = null, tabSeq = 0;

  function stashAlgo() {
    if (algoManifest !== null) return;
    const c = A.steps.cur();
    if (A.steps.seqPos(c) >= 0) algoStep = c;
    algoManifest = st.manifest; algoBudget = st.budget;
  }
  function restoreAlgo() {
    if (algoManifest !== null) { st.manifest = algoManifest; st.budget = algoBudget; }
    algoManifest = null; algoBudget = null;
  }

  function paintTab(tab) {
    document.body.classList.toggle("tab-algo", tab === "algo");
    document.body.classList.toggle("tab-lab", tab === "lab");
    for (const b of document.querySelectorAll(".tabm")) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
    }
  }

  /** Bring the scene in line with `tab` (st.tab is already set). False when a newer tab switch took over. */
  async function showTab(tab, my, algoTarget) {
    const stale = () => my !== tabSeq || st.tab !== tab;
    if (tab === "lab") {
      st.manifest = A.LIVE_MANIFEST;
      capBudget();
      if (!planMatches()) await loadPlan(false);
      if (stale()) return false;
      await A.lab.enter();
      return !stale();
    }
    capBudget();
    if (!planMatches()) await loadPlan(false);
    if (stale()) return false;
    if (algoTarget) algoTarget();
    else A.steps.snap(A.steps.seqPos(algoStep) >= 0 ? algoStep : 0);
    return true;
  }

  async function setTab(tab, fromHash) {
    if (tab === st.tab) return;
    const my = ++tabSeq;
    if (st.tab === "lab") A.lab.leave();                       // stops a run in flight (logs "run stopped" once)
    if (st.running) A.live.abort();
    if (tab === "lab") stashAlgo(); else restoreAlgo();
    st.tab = tab;
    paintTab(tab);
    if (!fromHash) {
      history.replaceState(null, "", tab === "lab" ? location.pathname + location.search + "#lab" : location.pathname + location.search);
    }
    if (!A.scene) { updateButtons(); return; }                 // start-up still loading: init() finishes the job
    try { await showTab(tab, my); }
    catch (e) { fatalScreen("Could not switch tab: " + e.message); }
    updateButtons();
  }

  function wireTabs() {
    const tabs = Array.from(document.querySelectorAll(".tabm"));
    tabs.forEach((b, i) => {
      b.addEventListener("click", () => setTab(b.dataset.tab));
      b.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault(); e.stopPropagation();
        const t = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        t.focus(); setTab(t.dataset.tab);
      });
    });
    window.addEventListener("hashchange", () => setTab(location.hash === "#lab" ? "lab" : "algo", true));
  }

  function wire() {
    wireSettings(); wireTabs();
    $("btn-prev").addEventListener("click", () => A.steps.prev());
    $("btn-next").addEventListener("click", () => A.steps.next());
    $("btn-reset").addEventListener("click", () => A.steps.resetStep());
    $("btn-restart").addEventListener("click", () => A.steps.restart());

    $("sel-manifest").addEventListener("change", (e) => { st.manifest = e.target.value; reload(); });
    $("rng-budget").addEventListener("input", (e) => { $("out-budget").textContent = e.target.value; });
    $("rng-budget").addEventListener("change", (e) => {
      const cap = parseInt($("rng-budget").max, 10) || 30;
      st.budget = Math.max(A.minBudget(), Math.min(cap, parseInt(e.target.value, 10) || st.budget));
      reload();
    });
    for (const [id, v] of [["alloc-risk", "risk"], ["alloc-uniform", "uniform"]]) {
      $(id).addEventListener("click", () => { if (st.alloc !== v) { st.alloc = v; reload(); } });
    }
    $("rng-speed").addEventListener("input", (e) => setSpeed(parseFloat(e.target.value)));
    $("tg-rm").addEventListener("change", (e) => setRM(e.target.checked));
    $("tg-labels").addEventListener("change", (e) => { st.labels = e.target.checked; $("svg").classList.toggle("hide-sec", !st.labels); });

    $("svg").addEventListener("click", (e) => {
      const g = e.target.closest && e.target.closest(".gate-hit");
      if (g && g.dataset.id && st.tab === "algo") A.steps.replayGate(g.dataset.id);
    });

    document.addEventListener("keydown", (e) => {
      const t = e.target, tag = t && t.tagName;
      const typing = tag === "INPUT" && t.type !== "range" && t.type !== "checkbox" || tag === "TEXTAREA";
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") { if (typing) t.blur(); return; }
      if (typing || tag === "SELECT") return;
      if (e.key === "r" || e.key === "R") { $("tg-rm").checked = !st.rm; setRM(!st.rm); return; }
      if (st.tab !== "algo") return;
      if (e.key === "ArrowRight") { e.preventDefault(); A.steps.next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); A.steps.prev(); }
      else if (e.key === " " && tag !== "BUTTON") { e.preventDefault(); A.steps.next(); }
    });

    A.on("runstate", updateButtons);
    A.on("chrome", updateButtons);
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
    A.lab.init();
    setRM(st.rm);
    const qs = st.params;
    const sp = parseFloat(qs.get("speed"));
    setSpeed(isFinite(sp) && sp > 0 ? sp : 1);
    if (qs.get("rm") === "1") setRM(true);

    let manifests;
    try { manifests = await A.api.manifests(); }
    catch (e) { fatalScreen("Cannot reach the backend (" + e.message + "). Start it with: python -m demo.server"); return; }
    st.manifests = manifests;
    const sel = $("sel-manifest");
    for (const m of manifests) { const o = el("option", null, m.id + " (" + m.nodes + " agents)"); o.value = m.id; o.title = m.title; sel.appendChild(o); }
    if (!manifests.some((m) => m.id === st.manifest)) st.manifest = manifests[0].id;
    committed.manifest = st.manifest;

    const stepParam = parseInt(qs.get("step"), 10);
    const wantLab = location.hash === "#lab" || stepParam === 12 || stepParam === 13;
    if (wantLab) {
      stashAlgo();
      st.tab = "lab"; st.manifest = A.LIVE_MANIFEST; paintTab("lab"); capBudget();
    }
    let plan;
    try { plan = await loadPlan(false); }
    catch (e) { fatalScreen("Could not load the plan: " + e.message); return; }
    if (!plan && !A.scene) await new Promise((res) => A.on("plan", res));   // superseded by a control change: wait for it
    if (A.api.offline) fatalScreen("Backend offline: showing the recorded pentest7 plan");

    // A tab clicked while loading only changed st.tab (setTab returns early without a scene): settle on that one.
    const my = ++tabSeq;
    try {
      if (st.tab === "lab") {
        if (await showTab("lab", my) && (stepParam === 13)) A.lab.setDefence(true, true);
      } else {
        await showTab("algo", my, () => {
          if (A.steps.seqPos(stepParam) >= 0) A.steps.snap(stepParam); else A.steps.intro();
        });
      }
    } catch (e) { fatalScreen("Start-up failed: " + e.message); }
    updateButtons();
  }
  init().catch((e) => { console.error(e); fatalScreen("Start-up failed: " + e.message); });
})(window.App);
