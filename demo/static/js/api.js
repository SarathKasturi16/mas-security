/* Backend access: JSON endpoints + SSE stream, with recorded fallback (replay/replay.js). */
(function (A) {
  "use strict";

  async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    let body = null;
    try { body = await r.json(); } catch (_) { /* non-JSON error page */ }
    if (!r.ok) {
      const e = new Error((body && body.error) || ("HTTP " + r.status));
      e.http = r.status;
      throw e;
    }
    return body;
  }

  const rec = () => window.__REPLAY__ || null;

  A.api = {
    /** [{id,title,nodes}] */
    async manifests() {
      try { return await getJSON("/api/manifests"); }
      catch (e) {
        if (e.http || !rec()) throw e;
        A.api.offline = true;
        return rec().manifests;
      }
    },

    /** Full plan for manifest/budget/alloc. Falls back to the recorded pentest7 plan if the server is down. */
    async plan(manifest, budget, alloc) {
      const q = new URLSearchParams({ manifest, budget: String(budget), alloc });
      try { return await getJSON("/api/plan?" + q.toString()); }
      catch (e) {
        const r = rec();
        if (e.http || !r || manifest !== "pentest7_poc" || budget !== 10) throw e;
        A.api.offline = true;
        return JSON.parse(JSON.stringify(r.plans[alloc]));
      }
    },

    /** [{id,label,text,injected}] mock-target presets for the Attack lab. */
    targets() { return getJSON("/api/targets"); },

    /**
     * Start a run with POST /api/run and read the SSE frames from the response body.
     * `o`: {mode, backend, manifest, alloc, budget, guardModel, seed, goalToken, preset | payload}.
     * Callbacks: onEvent(obj), onDone(), onRefused(status, message)  (HTTP error, sent before any stream),
     * onUnreachable() (no HTTP answer at all), onError(message) (the stream broke part-way).
     * Returns {close()}.
     */
    stream(o, cb) {
      const ctrl = new AbortController();
      let ended = false;
      const body = {
        mode: o.mode, backend: o.backend, alloc: o.alloc, budget: o.budget,
        guard_model: o.guardModel, seed: o.seed, goal_token: o.goalToken,
      };
      if (o.manifest) body.manifest = o.manifest;
      if (typeof o.payload === "string") body.payload = o.payload; else body.preset = o.preset;
      const finish = (fn) => { if (!ended) { ended = true; fn(); } };

      (async () => {
        let r;
        try {
          r = await fetch("/api/run", {
            method: "POST", signal: ctrl.signal,
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify(body),
          });
        } catch (_) { finish(() => { if (!ctrl.signal.aborted) cb.onUnreachable(); }); return; }
        if (!r.ok) {
          let j = null; try { j = await r.json(); } catch (_) { /* not JSON */ }
          finish(() => cb.onRefused(r.status, (j && j.error) || ("HTTP " + r.status)));
          return;
        }
        let sawDone = false;
        const frame = (txt) => {
          let name = "message";
          const data = [];
          for (const line of txt.split("\n")) {
            if (line.startsWith("event:")) name = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          }
          if (name === "done") { sawDone = true; return; }
          if (!data.length) return;
          let ev; try { ev = JSON.parse(data.join("\n")); } catch (_) { return; }
          if (ev && typeof ev === "object" && !ended) cb.onEvent(ev);
        };
        try {
          const rd = r.body.getReader(), dec = new TextDecoder();
          let buf = "";
          // Normalise on the whole buffer so a "\r\n" split across two chunks is still one newline.
          const drain = () => {
            buf = buf.replace(/\r\n/g, "\n");
            let i;
            while ((i = buf.indexOf("\n\n")) !== -1) { frame(buf.slice(0, i)); buf = buf.slice(i + 2); }
          };
          for (;;) {
            const { value, done } = await rd.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            drain();
          }
          buf += dec.decode();                       // flush a trailing partial multi-byte sequence
          drain();
          if (buf.trim()) frame(buf);
        } catch (_) {
          finish(() => { if (!ctrl.signal.aborted) cb.onError("The connection to /api/run was interrupted before the run completed."); });
          return;
        }
        finish(() => (sawDone ? cb.onDone() : cb.onError("The event stream ended before the run completed.")));
      })();

      return { close() { ended = true; ctrl.abort(); } };
    },

    /** Recorded events for a mode (array) or null. */
    recorded(mode) { const r = rec(); return r && r[mode] ? r[mode] : null; },
  };
})(window.App);
