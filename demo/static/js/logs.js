/* Logs drawer: structured rows, level chips, source filter, search, tabs, auto-scroll, JSON export. */
(function (A) {
  "use strict";
  const { $, el } = A;
  const LEVELS = ["SYSTEM", "AGENT", "GUARD", "BLOCK", "INFECT", "CLEAN", "ERROR"];
  const GLYPH = { SYSTEM: "⚙", AGENT: "●", GUARD: "◈", BLOCK: "✕", INFECT: "✱", CLEAN: "✓", ERROR: "▲" };

  const S = {
    rows: [], raw: [], view: "both", levels: new Set(LEVELS), src: "", query: "",
    sources: new Set(), t0: { undefended: 0, defended: 0 }, panes: [], stick: new Map(), seq: 0,
    open: false, userView: false,
  };

  const mmss = (ms) => {
    const t = Math.max(0, Math.floor(ms)), m = Math.floor(t / 60000), s = Math.floor(t / 1000) % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") + "." + String(t % 1000).padStart(3, "0");
  };

  // ---------------------------------------------------------------- row DOM
  function highlight(parent, text, q) {
    if (!q) { parent.textContent = text; return; }
    const lo = text.toLowerCase(), ql = q.toLowerCase();
    let i = 0, j;
    while ((j = lo.indexOf(ql, i)) !== -1) {
      if (j > i) parent.appendChild(document.createTextNode(text.slice(i, j)));
      parent.appendChild(el("mark", null, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    if (i < text.length) parent.appendChild(document.createTextNode(text.slice(i)));
  }

  function buildRow(r, animate) {
    const d = el("details", `lrow lvl-${r.level}` + (animate ? " enter" : ""));
    const sm = el("summary");
    sm.append(
      el("span", "t", (S.view === "both" ? (r.run === "defended" ? "D " : r.run === "undefended" ? "U " : "  ") : "") + mmss(r.t)),
    );
    const chip = el("span", `lv-chip lvl-${r.level}`); chip.textContent = GLYPH[r.level] + " " + r.level;
    sm.appendChild(chip);
    sm.appendChild(el("span", "src", r.src));
    const msg = el("span", "msg"); highlight(msg, r.msg, S.query); msg.title = r.msg;
    sm.append(msg, el("span", "chev", "›"));
    d.appendChild(sm);
    if (r.detail && r.detail.length) {
      const body = el("div", `detail lvl-${r.level}`);
      r.detail.forEach(([k, v], i) => {
        if (i) body.appendChild(document.createTextNode("\n"));
        body.appendChild(el("b", null, k + ": "));
        body.appendChild(document.createTextNode(v));
      });
      d.appendChild(body);
    } else {
      d.classList.add("nodetail");
    }
    return d;
  }

  // ---------------------------------------------------------------- filtering / rendering
  function passes(r, run) {
    if (!S.levels.has(r.level)) return false;
    if (S.src && r.src !== S.src) return false;
    if (S.query && !r.msg.toLowerCase().includes(S.query.toLowerCase())) return false;
    if (run && r.run !== run) return false;
    return true;
  }
  function paneSpecs() {
    if (S.view === "side") return [{ run: "undefended", title: "Undefended" }, { run: "defended", title: "Defended" }];
    if (S.view === "both") return [{ run: null, title: "" }];
    return [{ run: S.view, title: "" }];
  }

  function buildPanes() {
    const body = $("log-body");
    body.replaceChildren();
    body.classList.toggle("side", S.view === "side");
    S.panes = paneSpecs().map((spec) => {
      const pane = el("div", "pane"); pane.setAttribute("role", "log"); pane.setAttribute("aria-live", $("log-announce").checked ? "polite" : "off");
      if (spec.title) pane.appendChild(el("div", "pane-h", spec.title));
      const list = el("div", "list"); pane.appendChild(list);
      body.appendChild(pane);
      const p = { spec, pane, list };
      S.stick.set(pane, true);
      pane.addEventListener("scroll", () => {
        const at = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
        S.stick.set(pane, at);
        updateJump();
      });
      return p;
    });
  }

  function render() {
    let shown = 0;
    for (const p of S.panes) {
      const frag = document.createDocumentFragment();
      let n = 0;
      for (const r of S.rows) if (passes(r, p.spec.run)) { frag.appendChild(buildRow(r, false)); n++; }
      p.list.replaceChildren(frag);
      if (!n) p.list.appendChild(el("div", "lempty", S.rows.length ? "No rows match the current filters." : "No run yet. Press a Run button."));
      shown += n;
      if (S.stick.get(p.pane)) p.pane.scrollTop = p.pane.scrollHeight;
    }
    $("log-shown").textContent = shown + " / " + S.rows.length * (S.view === "side" ? 1 : 1);
    updateJump();
  }

  function updateJump() {
    const away = S.panes.some((p) => !S.stick.get(p.pane));
    $("log-jump").hidden = !away;
  }

  function updateCounts() {
    $("log-count").textContent = String(S.rows.length);
    let shown = 0;
    for (const r of S.rows) if (S.panes.some((p) => passes(r, p.spec.run))) shown++;
    $("log-shown").textContent = shown + " / " + S.rows.length;
  }

  function appendRow(r) {
    for (const p of S.panes) {
      if (!passes(r, p.spec.run)) continue;
      const empty = p.list.querySelector(":scope > .lempty"); if (empty) empty.remove();
      p.list.appendChild(buildRow(r, !A.rm()));
      if (S.stick.get(p.pane)) p.pane.scrollTop = p.pane.scrollHeight;
    }
    updateJump();
  }

  function addSource(src) {
    if (S.sources.has(src)) return;
    S.sources.add(src);
    const sel = $("log-src");
    const opt = el("option", null, src); opt.value = src; sel.appendChild(opt);
  }

  // ---------------------------------------------------------------- public API
  A.logs = {
    init() {
      const chips = $("lv-chips");
      for (const lv of LEVELS) {
        const b = el("button", `lvchip lvl-${lv}`, GLYPH[lv] + " " + lv);
        b.type = "button"; b.setAttribute("aria-pressed", "true");
        b.addEventListener("click", () => {
          const on = !S.levels.has(lv);
          if (on) S.levels.add(lv); else S.levels.delete(lv);
          b.setAttribute("aria-pressed", String(on)); render(); updateCounts();
        });
        chips.appendChild(b);
      }
      for (const t of document.querySelectorAll(".tab")) {
        t.addEventListener("click", () => { S.userView = true; A.logs.setView(t.dataset.view); });
      }
      $("log-src").addEventListener("change", (e) => { S.src = e.target.value; render(); updateCounts(); });
      $("log-search").addEventListener("input", (e) => { S.query = e.target.value.trim(); render(); updateCounts(); });
      $("log-announce").addEventListener("change", () => { for (const p of S.panes) p.pane.setAttribute("aria-live", $("log-announce").checked ? "polite" : "off"); });
      $("log-clear").addEventListener("click", () => A.logs.clear());
      $("log-close").addEventListener("click", () => A.logs.close());
      $("log-dl").addEventListener("click", () => A.logs.download());
      $("log-jump").addEventListener("click", () => {
        for (const p of S.panes) { S.stick.set(p.pane, true); p.pane.scrollTop = p.pane.scrollHeight; }
        updateJump();
      });
      $("btn-log").addEventListener("click", () => A.logs.toggle());
      buildPanes(); render();
    },

    /** Mark the start of a run (resets its elapsed clock, selects its tab unless the user chose one). */
    startRun(run) {
      S.t0[run] = performance.now();
      if (!S.userView && S.view !== "side") A.logs.setView(run, true);
    },
    elapsed(run) { return performance.now() - (S.t0[run] || performance.now()); },
    fmtElapsed: mmss,

    /** Add a structured row. `ev` (optional) is the raw event kept for JSON export. */
    add(run, level, src, msg, detail, ev) {
      const r = { id: ++S.seq, run, level, src, msg, detail: detail || [], t: A.logs.elapsed(run) };
      S.rows.push(r);
      if (ev) S.raw.push({ run, t_ms: Math.round(r.t), event: ev });
      addSource(src);
      appendRow(r); updateCounts();
      return r;
    },

    setView(v, auto) {
      S.view = v;
      if (!auto) S.userView = true;
      for (const t of document.querySelectorAll(".tab")) {
        const on = t.dataset.view === v;
        t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on));
      }
      buildPanes(); render(); updateCounts();
    },

    clear() {
      S.rows = []; S.raw = []; S.sources.clear(); S.seq = 0;
      $("log-src").replaceChildren(Object.assign(el("option", null, "All sources"), { value: "" }));
      S.src = "";
      render(); updateCounts();
    },

    open() {
      const d = $("drawer");
      if (S.open) return;
      S.open = true;
      d.hidden = false; d.classList.add("closing"); void d.offsetWidth; d.classList.remove("closing");
      $("btn-log").setAttribute("aria-expanded", "true"); $("log-ic").textContent = "▼";
      A.emit("drawer", true);
    },
    close() {
      const d = $("drawer");
      if (!S.open) return;
      S.open = false;
      d.classList.add("closing");
      setTimeout(() => { if (!S.open) d.hidden = true; }, A.rm() ? 0 : 250);
      $("btn-log").setAttribute("aria-expanded", "false"); $("log-ic").textContent = "▲";
      A.emit("drawer", false);
    },
    toggle() { S.open ? A.logs.close() : A.logs.open(); },
    isOpen: () => S.open,
    focusSearch() { A.logs.open(); setTimeout(() => $("log-search").focus(), 0); },

    download() {
      const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), events: S.raw }, null, 2)], { type: "application/json" });
      const a = el("a"); a.href = URL.createObjectURL(blob); a.download = "mas-demo-events.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    rowCount: () => S.rows.length,
    rows: () => S.rows,
  };
})(window.App);
