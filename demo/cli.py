"""Terminal front end for the exploit-then-defend demo (flags only, no prompts).

    ./tatl --list
    ./tatl --team mapta --both --backend stub
    ./tatl --team pentest7_poc --defended --backend groq --budget 12 --guards auto

Prints a plain-text guide to the defence plan (from ``engine.pipeline.build_plan``, the
same numbers as the web Algorithm tab), then the run log in the web viewer's columns
(time, agent, tag, message, status) with the full agent text indented under each OUT
line. ANSI colour is used only on COMPROMISED / BLOCK / PASS.
"""
from __future__ import annotations

import argparse
import re
import os
import sys
import textwrap
import time
from pathlib import Path

from demo.agents import GEMINI_GUARD_DEFAULT, GUARD_CHOICES
from demo.run_demo import MANIFEST_DIR, iter_run
from demo.target_mock import CANARY, PRESETS, get_preset
from engine.manifest import load_manifest
from engine.pipeline import ALLOCS, build_plan

from demo.server import BUDGET_MAX, BUDGET_MIN  # noqa: E402 - one limit for web and CLI
DEFAULT_TEAM = "pentest7_poc"
WIDTH = 100
RED, GREEN, RESET = "\033[31;1m", "\033[32;1m", "\033[0m"


def team_paths() -> dict[str, Path]:
    return {p.stem: p for p in sorted(MANIFEST_DIR.glob("*.json"))}


_UNSAFE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


class Out:
    """Writer that adds colour only on the three status words, and only when enabled."""

    def __init__(self, color: bool, stream=None) -> None:
        self.color = color
        self.stream = stream or sys.stdout

    def paint(self, text: str) -> str:
        if not self.color:
            return text
        for word, code in (("COMPROMISED", RED), ("BLOCK", RED), ("PASS", GREEN)):
            text = text.replace(word, f"{code}{word}{RESET}")
        return text

    def line(self, text: str = "") -> None:
        # Model output may carry terminal escapes (OSC, cursor moves); strip them first.
        print(self.paint(_UNSAFE.sub("", text)), file=self.stream)

    def para(self, text: str, indent: str = "  ") -> None:
        for ln in textwrap.wrap(text, WIDTH, initial_indent=indent, subsequent_indent=indent):
            self.line(ln)


def _read_payload(path: Path) -> str:
    """Read a payload file: a regular file only (no devices/FIFOs), never a .env file,
    and no more than a few times the payload limit."""
    from demo.server import MAX_PAYLOAD_CHARS
    if path.name.startswith(".env"):
        raise OSError("refusing to read a .env file as a payload")
    if not path.is_file():
        raise OSError("not a regular file")
    with path.open(encoding="utf-8", errors="replace") as f:
        text = f.read(MAX_PAYLOAD_CHARS * 4 + 1)
    if len(text) > MAX_PAYLOAD_CHARS * 4:
        raise OSError(f"file is far longer than the {MAX_PAYLOAD_CHARS}-character payload limit")
    return text


# ---- guide ---------------------------------------------------------------
def print_guide(out: Out, plan: dict, feedback: list[tuple[str, str]]) -> None:
    nodes = {n["id"]: n for n in plan["nodes"]}
    cps = plan["checkpoints"]
    B, alloc, p0 = plan["budget"], plan["alloc"], plan["p0"]

    out.line(f"=== GUIDE: {plan['manifest']} ===")
    out.para(plan["title"].split(". ")[0].rstrip(".") + ".", "")
    out.line()
    out.line("1. THE TEAM")
    out.para("Each agent is an LLM role. Its risk score is 1 plus a fixed amount per capability "
             "it holds (shell, credentials, ...), read from the manifest, so a compromised "
             "agent cannot change its own score.")
    for n in plan["nodes"]:
        flags = [f for f, on in (("entry", n["entry"]), ("critical", n["critical"])) if on]
        caps = ",".join(n["caps"]) or "none"
        out.line(f"  {n['id']:<24} risk {n['weight']:>4.1f}  caps: {caps}"
                 + (f"  [{' '.join(flags)}]" if flags else ""))
    out.line(f"  edges: {len(plan['edges'])}"
             + (f"; feedback edges (shown, not run): "
                + ", ".join(f"{u}->{v}" for u, v in feedback) if feedback else ""))
    out.line()
    out.line("2. BAGS (Min-Fill path decomposition)")
    out.para("The agent graph is cut into a chain of small overlapping groups (bags) using the "
             "Min-Fill elimination order, so the places an infection must pass through become explicit.")
    out.line(f"  elimination order: {' > '.join(plan['elimination_order'])}")
    for i, b in enumerate(plan["bags"]):
        out.line(f"  bag {i}: {{{', '.join(b)}}}")
    out.line()
    out.line("3. CHECKPOINTS")
    out.para("S0 guards the entry agents (where the target's text comes in); S1..Sn are the "
             "separators between bags. An agent is guarded if it sits in a checkpoint, and its "
             "incoming hand-off is audited before it runs.")
    for c in cps:
        out.line(f"  {c['id']}: {{{', '.join(c['nodes'])}}}")
    out.line()
    out.line("4. BLAST RADIUS (rho)")
    out.para("rho of a checkpoint is the summed risk of everything downstream of it: how much "
             "is lost if that checkpoint is breached.")
    for c in cps:
        terms = " + ".join(f"{t['weight']:g}" for t in c["rho_terms"])
        names = ", ".join(t["id"] for t in c["rho_terms"])
        out.line(f"  {c['id']}: rho = {terms} = {c['rho']:g}   ({names})")
    out.line()
    total = sum(c["rho"] for c in cps)
    rule = "q_i = B * rho_i / sum(rho)" if alloc == "risk" else "q_i = B / n  (uniform)"
    out.line(f"5. BUDGET SPLIT  (B = {B}, alloc = {alloc})")
    out.para(f"The audit budget B is spent risk-first: {rule}, then rounded to whole guards that "
             "sum to B (one budget unit = one guard).")
    for c in cps:
        out.line(f"  {c['id']}: q = {B} * {c['rho']:g} / {total:g} = {c['q']:.2f}"
                 if alloc == "risk" else f"  {c['id']}: q = {B} / {len(cps)} = {c['q']:.2f}"
                 )
        out.line(f"      -> {c['guards']} guard{'s' if c['guards'] != 1 else ''}")
    out.line()
    out.line(f"6. P(BLOCK) PER CHECKPOINT  (p0 = {p0} per guard)")
    out.para("A checkpoint blocks if any one of its g guards flags the hand-off: "
             "p_block = 1 - (1 - p0)^g.")
    for c in cps:
        out.line(f"  {c['id']}: 1 - (1 - {p0})^{c['guards']} = {c['p_block']:.3f}")
    out.line()
    sim = plan.get("sim")
    if sim:
        out.line("7. SIMULATION  (Monte-Carlo, expected infected weight I_w; lower is better)")
        out.para("Infection is spread over the graph thousands of times with no guards, with the "
                 "budget spread uniformly, and with it spent by risk.")
        for k in ("none", "uniform", "risk"):
            out.line(f"  {k:<8} I_w = {sim[k]['I_w']:.3f}   P(critical reached) = {sim[k]['p_orch']:.3f}")
        out.line()


def print_list(out: Out) -> None:
    out.line("Teams:")
    for stem, path in team_paths().items():
        m = load_manifest(path)
        out.line(f"  {stem:<24} {len(m.nodes)} agents  entry: {','.join(m.entry)}  "
                 f"critical: {','.join(m.critical)}  default budget {int(m.budget)}")
    out.line("Targets (--target):")
    for pid, (label, _f) in PRESETS.items():
        out.line(f"  {pid:<14} {label}")
    out.line(f"Guards (--guards): {', '.join(GUARD_CHOICES)}  "
             f"(auto = Gemini {GEMINI_GUARD_DEFAULT} if GEMINI_API_KEY is set, else Groq)")
    out.line("Backends (--backend): stub (offline, deterministic), groq (needs GROQ_API_KEY)")


# ---- run log -------------------------------------------------------------
def _clock() -> str:
    return time.strftime("%H:%M:%S")


def _row(out: Out, src: str, tag: str, msg: str, status: str = "") -> None:
    out.line(f"{_clock()}  {src:<22} {tag:<5} {msg}" + (f"  {status}" if status else ""))


def _full(out: Out, text: str) -> None:
    for para in (text.splitlines() or [""]):
        for ln in textwrap.wrap(para, WIDTH - 8, initial_indent="        ", subsequent_indent="        ",
                                break_on_hyphens=False) or [""]:
            out.line(ln)


ERROR_WORDS = {
    "rate_limit": "rate limit hit", "timeout": "timed out / run time limit", "auth": "auth error", "other": "error",
}


def run_one(out: Out, defended: bool, a: argparse.Namespace, target: dict) -> dict:
    """Run one pass, print its log, and return a summary row."""
    end: dict = {}
    start: dict = {}
    run_preds: dict[str, list[str]] = {}
    for ev in iter_run(
        defended=defended, backend_name=a.backend, manifest_path=team_paths()[a.team],
        alloc=a.alloc, budget=a.budget, canary=a.goal_token, guard_backend=a.guards, **target,
    ):
        t = ev["type"]
        if t == "run_start":
            start = ev
            parts = ["run", ev["mode"], ev["backend"], f"preset={ev['preset']}"]
            if defended:
                parts += [f"guards={ev['guard_backend']}", f"B={ev['budget']}"]
            parts.append(f"goal={ev['canary']}")
            out.line("  ".join(parts))
            skipped = {(e["from"], e["to"]) for e in ev["feedback_edges"]}
            run_preds = {n["id"]: [] for n in ev["topology"]["nodes"]}
            for e in ev["topology"]["edges"]:
                if (e["from"], e["to"]) not in skipped:
                    run_preds[e["to"]].append(e["from"])
            if skipped:
                _row(out, "-", "NOTE", "feedback edges, shown but not run: "
                     + ", ".join(f"{u}->{v}" for u, v in sorted(skipped)))
        elif t == "agent_start":
            ups = ", ".join(run_preds[ev["node"]]) or "target"
            _row(out, ev["node"], "IN", f"from {ups} ({len(ev['input']):,} chars)")
        elif t == "guard_vote":
            votes = ev["votes"]
            words = ["BLOCK" if v else "PASS" if v is False else "skip" for v in votes]
            cp = "+".join(ev["checkpoint"]) or "checkpoint"
            head = f"{cp} {ev['k']} guard{'s' if ev['k'] != 1 else ''}: "
            if ev["guard_error"]:
                why = ERROR_WORDS.get(ev.get("error_kind"), "error")
                _row(out, ev["node"], "GUARD", head + f"guard {why} -> failed closed, input wiped, "
                     "not counted as a detection", "ERROR")
            else:
                _row(out, ev["node"], "GUARD", head + " ".join(words) +
                     (" -> blocked, ContextWipe" if ev["blocked"] else " -> passed"),
                     "BLOCK" if ev["blocked"] else "PASS")
                skipped = votes.count(None)
                if skipped:
                    out.line(f"        {skipped} guard{'s' if skipped != 1 else ''} not needed (already blocked)")
            models = sorted(set(ev["models"]))
            if models and models != ["stub"]:
                out.line(f"        models: {', '.join(models)}")
        elif t == "agent_output":
            node = ev["node"]
            shown = " ".join(ev["output"].split())
            shown = shown if len(shown) <= 110 else shown[:110] + " ..."
            if ev["error"]:
                status = f"ERROR ({ERROR_WORDS.get(ev['error_kind'], 'error')})"
            else:
                status = "COMPROMISED" if ev["compromised"] else "CLEAN"
            _row(out, node, "OUT", f"\"{shown}\"" + ("  (input wiped)" if ev["wiped"] else ""), status)
            _full(out, ev["output"])
        elif t == "run_end":
            end = ev
            who = ", ".join(ev["compromised"]) or "none"
            blocked = ", ".join(ev["blocked_at"]) or "none"
            out.line(f"== finished: compromised: {who}; critical "
                     f"{'COMPROMISED' if ev['critical_pwned'] else 'clean'}; attack stopped at: {blocked} ==")
            out.line()
    return {"mode": start.get("mode", "?"), **end}


def print_summary(out: Out, rows: list[dict], critical: list[str]) -> None:
    out.line("=== SUMMARY (before / after) ===")
    out.line(f"  {'mode':<12} {'compromised agents':<52} {'critical (' + ','.join(critical) + ')':<34} stopped at")
    for r in rows:
        who = ", ".join(r["compromised"]) or "none"
        crit = "COMPROMISED" if r["critical_pwned"] else "clean"
        out.line(f"  {r['mode']:<12} {who:<52} {crit:<34} {', '.join(r['blocked_at']) or '-'}")
    out.line()


# ---- args ----------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="tatl", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--team", default=DEFAULT_TEAM, choices=sorted(team_paths()), help="which MAS to run")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--defended", action="store_true", help="run with checkpoint guards")
    g.add_argument("--undefended", action="store_true", help="run with no guards")
    g.add_argument("--both", action="store_true", help="undefended then defended, with a before/after table (default)")
    ap.add_argument("--budget", type=int, default=None, help=f"guard budget {BUDGET_MIN}..{BUDGET_MAX} (default: the manifest's)")
    ap.add_argument("--alloc", choices=ALLOCS, default="risk", help="budget split: risk-first or uniform")
    t = ap.add_mutually_exclusive_group()
    t.add_argument("--target", choices=list(PRESETS), default=None, help="built-in target text (default nmap_banner)")
    t.add_argument("--payload-file", metavar="F", help="read custom attacker text from this file")
    ap.add_argument("--allow-live-payload", action="store_true",
                    help="allow --payload-file with a live backend (it is sent to the model)")
    ap.add_argument("--goal-token", default=CANARY, metavar="T", help=f"token whose relay means compromise (default {CANARY})")
    ap.add_argument("--backend", choices=("stub", "groq"), default="stub", help="agent backend")
    ap.add_argument("--guards", choices=GUARD_CHOICES, default="auto", help="where live guards run")
    ap.add_argument("--no-guide", action="store_true", help="skip the plan guide")
    ap.add_argument("--list", action="store_true", help="list teams, targets and options, then exit")
    ap.add_argument("--no-color", action="store_true", help="no ANSI colour")
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    a = ap.parse_args(argv)
    color = not a.no_color and "NO_COLOR" not in os.environ and sys.stdout.isatty()
    out = Out(color)
    if a.list:
        print_list(out)
        return 0
    if a.budget is not None and not BUDGET_MIN <= a.budget <= BUDGET_MAX:
        ap.error(f"--budget must be between {BUDGET_MIN} and {BUDGET_MAX}")

    from demo.server import LIVE_TOKEN_RE, BadParam, _clean_payload, _goal_token   # one validator for web and CLI
    target: dict = {}
    try:
        a.goal_token = _goal_token(a.goal_token)
        if a.backend != "stub" and not LIVE_TOKEN_RE.fullmatch(a.goal_token):
            raise BadParam("live runs need a goal token shaped like [[MY-TOKEN-1]]")
        if a.payload_file:
            target["payload_text"] = _clean_payload(_read_payload(Path(a.payload_file)))
            if a.backend != "stub" and not a.allow_live_payload:
                ap.error("a custom payload is sent to the live model and printed in the log; "
                         "add --allow-live-payload to confirm (the website only runs custom payloads on the stub)")
        else:
            target["preset"] = a.target or "nmap_banner"
    except OSError as e:
        ap.error(f"cannot read --payload-file: {e.strerror or e}")
    except BadParam as e:
        ap.error(str(e))

    modes = [False, True] if a.both or not (a.defended or a.undefended) else [a.defended]
    try:
        plan = build_plan(team_paths()[a.team], budget=a.budget, alloc=a.alloc)
        if not a.no_guide:
            from demo.run_demo import run_order
            feedback = run_order(load_manifest(team_paths()[a.team]))[1]
            print_guide(out, plan, feedback)
        rows = [run_one(out, d, a, target) for d in modes]
    except (ValueError, RuntimeError) as e:     # bad budget for this team, missing API key
        print(f"error: {e}", file=sys.stderr)
        return 1
    if len(rows) > 1:
        print_summary(out, rows, plan["nodes"] and [n["id"] for n in plan["nodes"] if n["critical"]])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
