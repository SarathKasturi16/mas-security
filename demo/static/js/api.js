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

    runUrl(o) {
      const q = new URLSearchParams({
        mode: o.mode, backend: o.backend, clean: o.clean ? "1" : "0", alloc: o.alloc,
        budget: String(o.budget), guard_model: o.guardModel, seed: String(o.seed),
      });
      return "/api/run?" + q.toString();
    },

    /**
     * Open the SSE stream. Callbacks: onEvent(obj), onDone(), onError(msg).
     * Returns {close()}. Never lets EventSource auto-reconnect (that would restart the run).
     */
    stream(o, cb) {
      const es = new EventSource(A.api.runUrl(o));
      let ended = false;
      const end = () => { ended = true; es.close(); };
      es.onmessage = (e) => {
        let ev; try { ev = JSON.parse(e.data); } catch (_) { return; }
        if (ev && typeof ev === "object") cb.onEvent(ev);
      };
      es.addEventListener("done", () => { if (!ended) { end(); cb.onDone(); } });
      es.onerror = () => { if (!ended) { end(); cb.onError("The event stream to /api/run was interrupted before the run completed."); } };
      return { close() { if (!ended) end(); } };
    },

    /**
     * Why did the event stream fail before any event arrived?
     * -> {reachable:false}                      server does not answer at all (replay is appropriate)
     *    {reachable:true, status, error}        server answered; `error` is its JSON message (or a generic one)
     */
    async diagnose(o) {
      try { await getJSON("/api/manifests"); }
      catch (e) { if (!e.http) return { reachable: false }; }
      const ctrl = new AbortController();
      try {
        const r = await fetch(A.api.runUrl(o), { headers: { Accept: "application/json" }, signal: ctrl.signal });
        if (r.ok) { ctrl.abort(); return { reachable: true, status: r.status, error: "" }; }   // do not consume a started run
        let body = null; try { body = await r.json(); } catch (_) { /* not JSON */ }
        return { reachable: true, status: r.status, error: (body && body.error) || ("HTTP " + r.status) };
      } catch (_) { return { reachable: false }; }
    },

    /** Recorded events for a mode (array) or null. */
    recorded(mode) { const r = rec(); return r && r[mode] ? r[mode] : null; },
  };
})(window.App);
