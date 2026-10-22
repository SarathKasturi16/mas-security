/* Agent output log viewer: a plain terminal-style transcript of every run in the Attack lab.
 * One line per event in fixed-width columns, click a line to expand its full text, run history
 * is kept so run 1 and run 2 read one after the other. Data only ever goes through textContent. */
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
    if (spec.full) {
      row.classList.add("more");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", "false");
      const pre = el("pre", "ll-full", spec.full);
      pre.hidden = true;
      w.appendChild(pre);
      const toggle = () => {
        const open = pre.hidden;
        pre.hidden = !open;
        row.setAttribute("aria-expanded", String(open));
        w.classList.toggle("open", open);
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    }
    return w;
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

  A.logs = {
    init() {
      $("log-wrap").addEventListener("click", () => { S.wrap = !S.wrap; syncControls(); });
      $("log-filter").addEventListener("click", () => { S.filter = FILTERS[(FILTERS.indexOf(S.filter) + 1) % FILTERS.length]; syncControls(); });
      $("log-save").addEventListener("click", () => A.logs.download());
      $("log-clear").addEventListener("click", () => A.logs.clear());
      syncControls(); emptyNote();
    },

    /** Start a new run block. Returns its number. */
    beginRun(info) {
      const n = ++S.runNo;
      S.cur = { n, info, t0: performance.now(), events: [] };
      S.runs.push(S.cur);
      const parts = [`run ${n}`, info.mode, info.backend, `preset=${info.preset}`];
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
