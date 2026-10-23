/* Agent output log viewer: a plain terminal-style transcript of every run in the Attack lab.
 * One line per event in fixed-width columns. Click a line (or press Enter / Space) to open a detail block under it:
 * INPUT and OUTPUT boxes for agents, a vote table for guards, a plain explanation for errors. Run history is kept so
 * run 1 and run 2 read one after the other. Data only ever goes through textContent. */
(function (A) {
  "use strict";
  const { $, el } = A;

  const FILTERS = ["all", "agents", "guards"];
  const S = {
    runs: [],          // [{n, header, events:[{t_ms, event}]}]
    cur: null,         // the run lines are currently being written for
    runNo: 0,
    filter: "all",
    wrap: false,
    lines: 0,
  };

  const two = (n) => String(n).padStart(2, "0");
  const clock = () => { const d = new Date(); return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds()); };

  function body() { return $("log-body"); }
  function nearBottom(b) { return b.scrollHeight - b.scrollTop - b.clientHeight < 40; }

  function emptyNote() {
    const b = body();
    if (b.childElementCount) return;
    b.appendChild(el("div", "ll-empty", "No run yet. Press Run attack."));
  }

  /** Append a finished line element and keep the pane pinned to the bottom if it already was. */
  function push(node) {
    const b = body();
    const stick = nearBottom(b);
    const empty = b.querySelector(":scope > .ll-empty"); if (empty) empty.remove();
    b.appendChild(node);
    if (stick) b.scrollTop = b.scrollHeight;
    S.lines++;
  }

  function seg(parent, text, cls) {
    const s = el("span", cls || null, text);
    parent.appendChild(s);
    return s;
  }

  // ---------------------------------------------------------------- detail blocks
  let detailSeq = 0;

  /** Fill `pre` with `text`; every occurrence of the goal token gets a red highlight. Text nodes only. */
  function fillText(pre, text, tok) {
    pre.replaceChildren();
    if (!text) { pre.appendChild(el("span", "dim", "(empty)")); return; }
    if (!tok || !text.includes(tok)) { pre.appendChild(document.createTextNode(text)); return; }
    const parts = text.split(tok);
    parts.forEach((part, i) => {
      if (i) pre.appendChild(el("mark", "tok", tok));
      if (part) pre.appendChild(document.createTextNode(part));
    });
  }

  function copyText(text, btn) {
    const done = (msg) => { btn.textContent = msg; setTimeout(() => { btn.textContent = "[copy]"; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done("[copied]"), () => done("[copy failed]"));
    } else done("[copy failed]");
  }

  /** One titled text box: "INPUT  from recon, scan_web (2,942 chars)  [copy]" over a wrapped, scrollable body. */
  function makeBox(title, part, tok) {
    const box = el("div", "dbox");
    const top = el("div", "dbox-top");
    top.appendChild(el("span", "dbox-t", title));
    const head = el("span", "dbox-h", part.head || "");
    top.appendChild(head);
    const cp = el("button", "tx dbox-cp", "[copy]");
    cp.type = "button";
    top.appendChild(cp);
    const pre = el("pre", "dbox-pre");
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", title.toLowerCase() + " text");
    let shown = part;
    const show = (p) => { shown = p; head.textContent = p.head || ""; fillText(pre, p.text || "", tok); };
    show(part);
    cp.addEventListener("click", (e) => { e.stopPropagation(); copyText(shown.text || "", cp); });
    cp.setAttribute("aria-label", "Copy " + title.toLowerCase() + " text");
    box.append(top, pre);
    return { box, show };
  }

  function agentDetail(d) {
    const root = el("div", "dt");
    if (d.error) {
      const e = el("div", "dt-err");
      e.appendChild(el("p", "dt-msg", d.error.text));
      if (d.error.raw) e.appendChild(el("p", "dt-raw", "Raw status: " + d.error.raw));
      root.appendChild(e);
    }
    const boxes = el("div", "dboxes" + (d.output && !d.error ? "" : " one"));
    let inBox = null;
    if (d.input) { inBox = makeBox("INPUT", d.input, d.token); boxes.appendChild(inBox.box); }
    if (d.output && !d.error) boxes.appendChild(makeBox("OUTPUT", d.output, d.token).box);
    root.appendChild(boxes);
    if (d.wipeNote) {
      const n = el("p", "dt-note");
      n.appendChild(el("span", "st-block", "ContextWipe: "));
      n.appendChild(document.createTextNode(d.wipeNote + " "));
      if (d.alt && inBox) {
        const b = el("button", "tx", "[show blocked hand-off]");
        b.type = "button";
        let alt = false;
        b.addEventListener("click", (e) => {
          e.stopPropagation(); alt = !alt;
          inBox.show(alt ? d.alt : d.input);
          b.textContent = alt ? "[show what the agent received]" : "[show blocked hand-off]";
        });
        n.appendChild(b);
      }
      root.appendChild(n);
    }
    return root;
  }

  function guardDetail(d) {
    const root = el("div", "dt");
    if (d.errorText) root.appendChild(el("p", "dt-msg", d.errorText));
    const t = el("table", "gt");
    const cap = el("caption", "sr", "Guard votes for " + d.checkpoint);
    t.appendChild(cap);
    const hr = el("tr");
    for (const h of ["guard", "model", "vote"]) { const th = el("th", null, h); th.scope = "col"; hr.appendChild(th); }
    const thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    const tb = el("tbody");
    for (const r of d.rows) {
      const tr = el("tr");
      tr.appendChild(el("td", null, "#" + r.n));
      tr.appendChild(el("td", "gt-m", r.model || "-"));
      const [txt, cls] = r.vote === true ? ["BLOCK", "st-block"] : r.vote === false ? ["PASS", "st-pass"]
        : r.err ? ["guard error (" + r.err + ")", "st-block"] : ["not needed (already blocked)", "dim"];
      tr.appendChild(el("td", cls, txt));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    root.appendChild(t);
    if (d.backend) root.appendChild(el("p", "dt-note", "Guard backend: " + d.backend));
    root.appendChild(el("p", "dt-note", d.ruleText));
    return root;
  }

  function buildDetail(d) {
    return d.type === "guard" ? guardDetail(d) : agentDetail(d);
  }

  function makeLine(spec) {
    const kind = spec.kind || "sys";
    const w = el("div", "lw");
    w.dataset.kind = kind;
    const row = el("div", "ll" + (kind === "sys" ? " sys" : ""));
    row.appendChild(el("span", "c-t", clock()));
    if (kind === "sys") {
      const m = el("span", "c-m");
      for (const [t, c] of spec.segs || [[spec.text || "", null]]) seg(m, t, c);
      row.appendChild(m);
    } else {
      row.appendChild(el("span", "c-s", spec.src || ""));
      row.appendChild(el("span", "c-g", spec.tag || ""));
      const m = el("span", "c-m");
      for (const [t, c] of spec.segs || [[spec.text || "", null]]) seg(m, t, c);
      row.appendChild(m);
      row.appendChild(el("span", "c-x" + (spec.status ? " " + spec.status[1] : ""), spec.status ? spec.status[0] : ""));
    }
    w.appendChild(row);
    if (spec.detail || spec.full) {
      row.classList.add("more");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", "false");
      const box = el("div", "ll-detail");
      box.id = "ld-" + (++detailSeq);
      box.hidden = true;
      row.setAttribute("aria-controls", box.id);
      w.appendChild(box);
      let built = false;
      let single = false;                                 // true only for a click on this row, not for expand all
      const set = (open) => {
        if (open && !built) {
          built = true;
          if (spec.detail) box.appendChild(buildDetail(spec.detail));
          else box.appendChild(el("pre", "ll-full", spec.full));
        }
        box.hidden = !open;
        row.setAttribute("aria-expanded", String(open));
        w.classList.toggle("open", open);
        if (open && single) w.scrollIntoView({ block: "nearest" });
      };
      w._set = set;
      const toggle = () => { single = true; set(box.hidden); single = false; };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    }
    return w;
  }

  function setAll(open) {
    for (const w of body().querySelectorAll(".lw")) if (w._set) w._set(open);
  }

  function record(ev) {
    if (S.cur && ev) S.cur.events.push({ t_ms: Math.round(performance.now() - S.cur.t0), event: ev });
  }

  function syncControls() {
    const b = body();
    b.classList.toggle("wrap", S.wrap);
    b.dataset.filter = S.filter;
    const w = $("log-wrap"); w.textContent = "[wrap: " + (S.wrap ? "on" : "off") + "]"; w.setAttribute("aria-pressed", String(S.wrap));
    $("log-filter").textContent = "[filter: " + S.filter + "]";
  }

  // ---------------------------------------------------------------- resizable pane (drag the top edge)
  const H_KEY = "tatl.logHeight", H_MIN = 160;
  const hMax = () => Math.max(H_MIN, Math.round(window.innerHeight * 0.75));
  function setHeight(px, save) {
    const h = Math.max(H_MIN, Math.min(hMax(), Math.round(px)));
    document.documentElement.style.setProperty("--log-h", h + "px");
    const g = $("lv-grip");
    g.setAttribute("aria-valuemin", String(H_MIN)); g.setAttribute("aria-valuemax", String(hMax())); g.setAttribute("aria-valuenow", String(h));
    if (save) { try { localStorage.setItem(H_KEY, String(h)); } catch (_) { /* storage blocked */ } }
    return h;
  }
  function wireGrip() {
    const g = $("lv-grip"), view = $("logview");
    let saved = NaN;
    try { saved = parseInt(localStorage.getItem(H_KEY), 10); } catch (_) { /* storage blocked */ }
    if (isFinite(saved)) setHeight(saved, false);
    let startY = 0, startH = 0, active = false;
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      active = true; startY = e.clientY; startH = view.getBoundingClientRect().height;
      g.setPointerCapture(e.pointerId); g.classList.add("drag"); document.body.classList.add("resizing");
      e.preventDefault();
    });
    g.addEventListener("pointermove", (e) => { if (active) setHeight(startH + (startY - e.clientY), false); });
    const end = (e) => {
      if (!active) return;
      active = false; g.classList.remove("drag"); document.body.classList.remove("resizing");
      try { g.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
      setHeight(view.getBoundingClientRect().height, true);
    };
    g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
    g.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      setHeight(view.getBoundingClientRect().height + (e.key === "ArrowUp" ? 24 : -24), true);
    });
    window.addEventListener("resize", () => {
      if (view.offsetHeight > 0 && document.documentElement.style.getPropertyValue("--log-h")) setHeight(view.getBoundingClientRect().height, false);
    });
  }

  A.logs = {
    init() {
      wireGrip();
      $("log-wrap").addEventListener("click", () => { S.wrap = !S.wrap; syncControls(); });
      $("log-filter").addEventListener("click", () => { S.filter = FILTERS[(FILTERS.indexOf(S.filter) + 1) % FILTERS.length]; syncControls(); });
      $("log-expand").addEventListener("click", () => setAll(true));
      $("log-collapse").addEventListener("click", () => setAll(false));
      $("log-save").addEventListener("click", () => A.logs.download());
      $("log-clear").addEventListener("click", () => A.logs.clear());
      syncControls(); emptyNote();
    },

    /** Start a new run block. Returns its number. */
    beginRun(info) {
      const n = ++S.runNo;
      S.cur = { n, info, t0: performance.now(), events: [] };
      S.runs.push(S.cur);
      const parts = [`run ${n}`];
      if (info.manifest) parts.push(`team=${info.manifest}`);
      parts.push(info.mode, info.backend, `preset=${info.preset}`);
      if (info.mode === "defended") parts.push(`guards=${info.guardModel}`, `B=${info.budget}`);
      parts.push(`goal=${info.goalToken}`);
      push(makeLine({ kind: "sys", segs: [[parts.join("  "), "hd"]] }));
      return n;
    },

    /** An agent line: kind "agent" (IN / OUT) or "guard". */
    line(spec, ev) { push(makeLine(spec)); record(ev); },

    /** A plain system line (notices, errors). */
    note(text, ev) { push(makeLine({ kind: "sys", text })); record(ev); },

    endRun(text, ev) {
      const n = S.cur ? S.cur.n : S.runNo;
      push(makeLine({ kind: "sys", segs: [[`== run ${n} finished: `, "hd"], ...text, [" ==", "hd"]] }));
      record(ev);
      S.cur = null;
    },

    clear() {
      S.runs = []; S.cur = null; S.runNo = 0; S.lines = 0;
      body().replaceChildren(); emptyNote();
    },

    download() {
      const out = {
        exported: new Date().toISOString(),
        runs: S.runs.map((r) => ({ run: r.n, ...r.info, events: r.events })),
      };
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const a = el("a"); a.href = URL.createObjectURL(blob); a.download = "mas-attack-lab-log.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    lineCount: () => S.lines,
    runCount: () => S.runNo,
  };
})(window.App);
