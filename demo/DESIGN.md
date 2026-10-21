# DESIGN.md - Animated Explainer GUI (visual spec)

Stack: plain HTML/CSS/JS, inline SVG, d3 v7 (layout maths only), GSAP 3.14 (+MotionPath, DrawSVG, Flip). Offline, no web fonts, no build.
Audience: academic panel, projector 1920x1080 (must also hold at 1366x768). Tone: calm research lab, light theme, no glow, no neon, no gradients except the coin and the ContextWipe sweep.
Rule zero: **colour is never the only signal.** Every state has colour + icon + pattern/label (see 2.2).

---
## 1. Layout grid

Single page, `100vw x 100vh`, `overflow:hidden`, CSS grid rows `header / stage / caption / controller / strip`. Log drawer is an overlay (does not reflow the stage).

| Region | 1920x1080 | 1366x768 | Notes |
|---|---|---|---|
| Header | 72 | 52 | Title left (22px/700), step counter "Step 6 / 13" right, 1px bottom border `--line` |
| Stage (SVG) | 728 (flex) | 484 (flex) | `<svg viewBox="0 0 1600 640" preserveAspectRatio="xMidYMid meet">` centred, bg `--stage-bg`. Scale 1.1375 @1080p, 0.756 @768p |
| Caption bar | 120 | 92 | Max text width 1400px/1100px, centred, vertically centred, 2 lines max |
| Step controller | 64 | 50 | 14 dots + Prev / Play / Next |
| Control strip | 56 | 44 | Speed slider, toggles (Reduce motion, Show labels, Log), Reset step, Restart |
| Log drawer (collapsed) | 40 tab | 32 tab | Tab sits on the strip's right edge |
| Log drawer (open) | 360 tall overlay | 260 tall overlay | Slides up from bottom over the stage, `--log-bg`, 240ms |

Horizontal page padding 40px (1080p) / 24px (768p). SVG internal minimum text is **18 units** (= 20.5px @1080p, 13.6px @768p). Never put text under 18u; icons >= 24u.
Stage grid in SVG units: 1600 x 640. Safe margin 40. Zones: target website x 40-200; agents x 280-1500; legend/pot area y 540-620.

Network layout (fixed layered, d3 only for scales/links): website (110,320); recon (360,130), scan_web (360,320), scan_net (360,510); analysis (700,320); exploit (1000,320); orchestrator (1280,230); reporter (1500,430). Node base size 168 x 76, r12.

---
## 2. Colour tokens (CSS custom properties on `:root`)

Contrast ratios are against the stated background, WCAG 2.1.

### 2.1 Neutrals
```
--bg:#F6F7F9;          --stage-bg:#FFFFFF;     --surface:#FFFFFF;
--ink:#16202D;  /* 16:1 on white */            --ink-2:#44505F; /* 8:1 */
--ink-3:#5F6B7A; /* 5.3:1, captions-of-captions only */
--line:#D3D9E0;        --grid:#E9EDF2;         --shadow:0 1px 2px rgba(22,32,45,.12);
--focus:#1D4ED8;   /* 3px outline + 2px offset on every focusable */
```
### 2.2 Agent states (fill / stroke / glyph + non-colour cue)
| Token | Fill | Stroke+text | Contrast (stroke on fill) | Non-colour cue |
|---|---|---|---|---|
| `--st-idle` | #EEF1F5 | #7A8594 | 3.4:1 (graphic) | no ring, plain role icon |
| `--st-active` | #E0F3F7 | #0E7490 | 5.1:1 | 3u dashed ring rotating + "..." glyph |
| `--st-clean` | #E2F4EA | #17744F | 5.6:1 | solid ring + check badge (bottom-right) |
| `--st-compromised` | #FBE4E4 | #B42318 | 5.9:1 | diagonal hatch (45deg, 6u pitch, 1.5u lines, `#B42318` @25%) + bug "!" badge + node shake 2 frames |
| `--st-blocked` | #EDE7FA | #5B34B8 | 7.2:1 | shield-with-X badge, double ring |
| `--st-entry` | #FDEBDB | #B45309 | 4.7:1 | dashed outer ring + inward arrow badge, "EXPOSED" tag |
| `--st-critical` | #FFF3C4 | #8A5A00 | 5.6:1 | 5-point star top-left + 4u thick stroke, "HOLDS CREDENTIALS" tooltip |
Blue is reserved for focus/shields; purple only for blocked. Compromised vs clean differ in hatch, badge shape (! vs check) and ring style, so deuteranopia/protanopia/greyscale remain distinguishable.

### 2.3 Structure and mechanisms
```
--gate:#334155;        --gate-label-bg:#FFFFFF;   /* 9.9:1 */ --gate-wave:#B42318 @ 18% fill (blast radius, hatched too)
--coin:#F2B705;        --coin-edge:#8A6100;        --pot:#FFF8E1;  --pot-edge:#C99A12;
--shield:#1D4ED8;      --shield-fill:#DCE6FB;      --shield-text:#FFFFFF on --shield (6.7:1)
--pass:#17744F;        --block:#5B34B8;            /* chips also carry check/X glyph */
--token:#D92D20;       --token-trail:#D92D20 @ 0->35% opacity   --edge:#8A94A3;  --edge-hot:#B42318
--website:#2B2F36 fill, #FFFFFF text (14:1), skull-free: use "globe + warning triangle"
--bar-none:#B42318  --bar-equal:#B45309  --bar-risk:#17744F   /* bars also differ by hatch: diagonal / dots / solid */
```
Bag column tints (soft, 8 cycle, each labelled "B1..Bn" so tint is decorative):
`#E8F1FB #EAF6EE #FFF4DE #F4EAF8 #E3F4F2 #FDEBE0 #EEF0FA #F3F1E4`; column border `--grid`, dashed.

### 2.4 Log (dark panel; text #E5E7EB on `--log-bg:#0F172A` = 14:1)
```
--log-bg:#0F172A; --log-row-alt:#131D33; --log-line:#25324D; --log-text:#E5E7EB; --log-dim:#94A3B8 (6.9:1)
SYSTEM #9CA3AF  glyph "gear"      AGENT  #7DD3FC glyph "dot"
GUARD  #A5B4FC  glyph "shield"    BLOCK  #D8B4FE glyph "X"
INFECT #FCA5A5  glyph "bug"       CLEAN  #86EFAC glyph "check"
ERROR  #FDBA74  glyph "triangle!"          /* all >= 9:1 on --log-bg; chip text = level word, never colour alone */
```

---
## 3. Typography
```
--font: system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;
--mono: ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;
```
| Role | 1080p | 768p | Weight |
|---|---|---|---|
| Title slide H1 (SVG) | 72u | 72u | 700, letter-spacing -0.01em |
| Header title | 22px | 18px | 700 |
| **Caption** | **32px / 1.3** | **26px / 1.3** | 500, `--ink`; key terms 700 |
| Step-1 subline | 22px | 18px | 400 `--ink-2` |
| SVG node label | 22u | 22u | 600 |
| SVG secondary label / chip | 18u | 18u | 600 |
| Score badge number | 20u | 20u | 700 tabular-nums |
| Big counters (rho, B) | 44u | 44u | 700 tabular-nums |
| Results value labels | 28u | 28u | 700 |
| Controls | 16px | 14px | 600 |
| Log message | 15px mono | 13px mono | 400, line-height 1.45 |
Caption rules: sentence case, <= 2 sentences, <= 22 words each, jargon defined in-line in parentheses once. Fade text change 200ms.

---
## 4. Components

All SVG, drawn with 2u strokes, round caps/joins, 24x24 icon grid unless stated.

**Agent node** (`<g class="agent" data-state data-w>`): rect 168x76 r12, 2.5u stroke `--st-*`; drop `--shadow`. Left: role icon in 28u slot at (18,24). Label centred-right (x=60,y=34) 22u/600, e.g. "scan_web". Sub-label (y=58) 18u state word ("Safe", "Compromised", "Blocked"). State ring: rect r16 outset 6u, 3u stroke (style per 2.2). Score badge: circle r17 at top-right (168,0), fill `--ink`, number white 20u, ring 2u white. Critical star: 5-point star r11 at (0,0) top-left, fill `--st-critical` stroke #8A5A00. State badge: circle r12 bottom-right, glyph 16u white on state colour. Size scaling by risk: `scale = 0.8 + 0.05*(w-1)` (w1=0.80, w10=1.25), anchored on centre.
Role icons: recon = magnifier (circle r6 at 10,10 + line 15,15->21,21); scan_web = globe (circle r9, vertical ellipse rx4, horizontal line); scan_net = 3 dots (4,18 / 12,5 / 20,18) joined by lines; analysis = 3 bars (rects h6/12/18); exploit = lightning bolt polygon (13,2 5,13 11,13 9,22 19,9 13,9); orchestrator = hub: centre circle r3 + 4 spokes to circles r2 at corners; reporter = page (rect 5,3 14x18 r2) + 3 lines.

**Target-website node**: browser window 150x110 r10, fill `--website`, top bar 20u with 3 dots, body shows globe icon + amber warning triangle (3 pts, "!") and label "hostile site" 18u white. Hidden instruction: a faint `<!-- ... -->` strip of 14-char monospace text at 0.5 opacity revealed in step 2 (dashed outline pulse).

**Edge**: path `--edge` 2.5u, arrowhead marker 10x10. States: default; `.hot` `--edge-hot` 4u (token on it); `.cut` (blocked) dashed 6/6 `--block` with small X at midpoint; `.dim` 25% opacity. Drawn with DrawSVG (0%->100%).

**Attack token**: circle r11 `--token`, white "!" 16u, 2u white outline; trail = 6 fading circles r11->4 along path (or `stroke-dasharray` tail 80u, width 8u, opacity .35). Shatter: 10 shards (triangles 6-10u) fly radially 60u, rotate +-180deg, fade, 500ms.

**Capability chip**: pill h30 r15, fill white, 2u stroke `--ink-2`, text 18u/600 e.g. "shell +2", "credentials +2", "network +1", "files +1"; leading 14u icon. Weight pill suffix coloured by weight: +1 `--ink-2`, +2 `--st-critical` stroke. Arrival: absorbed into node (scale 1->0.2, opacity 0) while badge counter ticks.

**Bag column**: rect 150 x 400 (full stage height minus margin), tint from 2.3, header "B1" 18u/700 centred at top, subtle 1u dashed borders. Columns evenly spaced across x 120-1480.

**Agent pill (interval view)**: rect h40 r20, x spans its first..last column, fill `--st-*`, 2u stroke, label inside left 18u/600 (white-on-dark never; use `--ink`), mini role icon 20u, score badge r12 at right end. Rows stacked y spacing 56, ordered by first column.

**Gate**: vertical bar 10u wide, full column-boundary height, `--gate`, rounded caps; label tab at top: rect 56x32 r8 white, stroke `--gate`, text "S1" 20u/700, padlock-open icon 14u. Entry gate S0 at x=left edge, with arrow-in glyph. Blast wave: rect filled `--gate-wave` @18% + 45deg hatch, sweeps from gate to the right edge, edge line 3u `--st-compromised`.
**Counter rho**: card 190x84 white, stroke `--line`, label "Blast radius (rho)" 18u, value 44u "= 4 agents".

**Coin**: circle r14, fill `--coin`, stroke `--coin-edge` 2u, inner "1" 16u/700 `--coin-edge`; light highlight arc (white 40%, 2u, upper-left). Pot: open jar path 220x150, fill `--pot`, stroke `--pot-edge` 3u, label "Budget B = 10" 22u/700. Ghost "equal split": coins at 35% opacity, dashed circles, label "Equal split".

**Shield**: path (0,-26 L22,-18 V4 C22,16 10,24 0,28 C-10,24 -22,16 -22,4 V-18 Z), fill `--shield-fill`, stroke `--shield` 3u; count number 24u/700 `--shield` centred; caption below "catches 88%" 18u/600. Coin->shield morph: Flip, 600ms.

**Guard vote chip**: pill 96x34 r17, "PASS" = white fill, 2.5u `--pass` stroke, check icon + "PASS"; "BLOCK" = solid `--block` fill, white text 18u/700, X icon. Row of k chips fans out above the guarded agent, 12u gap, index "G1..Gk" in 14u superscript (decorative).

**ContextWipe effect**: full-node-width white sweep (rect, linear gradient white 0->95%->0, 120u wide) moving left->right across the guarded agent in 500ms; then agent tint reverts to `--st-clean` with check; label tag "ContextWipe: memory cleared" 18u in a pill under the node for 1.8s.

**Verdict banner**: pill 360x56 r28 centred above agent. ALLOWED: white, `--pass` stroke, check. BLOCKED: `--block` fill, white text "BLOCKED - attack stopped" 22u/700, X icon. Pops with scale .9->1, 250ms.

**Budget bars** (step 8): horizontal bars under gates, height 22, 2u stroke, value labels at bar end (18u/700 "6", "1", "3"); baseline at 0.
**Results bar chart** (step 13): 3 vertical bars, width 180, gap 90, chart 760x440, left axis with 0 baseline (2u `--ink`), gridlines at 0,0.1,...0.5 in `--grid`, y tick labels 18u, y axis title "Chance the orchestrator is compromised" 18u rotated. Bars: no defence `--bar-none` + diagonal hatch, equal split `--bar-equal` + dot pattern, risk split `--bar-risk` solid. Value label 28u/700 directly above each bar ("0.447", "0.067", "0.030"), category label 22u below. Annotation arrow from bar 1 to bar 3 "15x lower" 22u. No 3D, no shadows, no legend needed (direct labels). Bars grow from zero baseline.

**Step dots**: 14 buttons 18x18 circle (hit target 32x32), done = filled `--ink`, current = filled `--shield` + 3u ring, upcoming = 2u `--line` stroke. `aria-label="Step N: title"`; hover tooltip title. Connected by 1px line.
**Caption**: `<p role="status" aria-live="polite">`, white bar, 4u left accent in current step colour.
**Buttons**: h48 (1080p) / 40 (768p), r10, 2px `--ink-2` border, white; primary Play/Pause filled `--ink` white text (16:1), min width 120; icons 20px + text label always; disabled opacity .4 with line-through not required. Hover bg `--bg`; active translateY(1px). Keys: Right/Space = Next, Left = Prev, P = play/pause, L = log, R = reduce motion.
**Sliders/toggles**: speed slider 0.5x-2x (step .25, track 6px `--line`, thumb 24px `--ink`, value label "1.0x"). Toggle: 48x26 pill, on = `--ink` with check glyph, off = `--line` with dash glyph; label text beside. Native `<input type=checkbox role=switch>` styled.

**Log row** (mono, h30, grid `76px 92px 120px 1fr 24px`): time `HH:MM:SS.mmm` `--log-dim` | level chip (pill h20, 1.5px border in level colour, glyph + WORD 12px/700, text in level colour) | source chip (pill, `--log-line` bg, agent name) | message `--log-text`, ellipsis | chevron. Expand -> JSON/details block, `--log-row-alt`, 13px mono, left border 3px in level colour, max-height 180 scroll. Row enter: slide 8px + fade 160ms. Auto-scroll on, pauses when user scrolls (pill "Jump to latest").
**Log filters + search**: top bar h44: level toggle chips (7, multi-select, pressed = filled with level colour at 20% + glyph), source dropdown, search input (240px, placeholder "Search messages", `/` focuses, highlights matches with `#FDE68A` bg + `#111` text), count "128 / 342", Clear and Copy buttons.

---
## 5. Motion language (GSAP)

| Kind | Duration | Ease | Notes |
|---|---|---|---|
| Entrance (nodes, edges, labels) | 0.5s | `power2.out` | from y+12, opacity 0; stagger 0.08s; edges DrawSVG 0.6s `power1.inOut`, stagger 0.05 |
| State change (colour) | 0.35s | `power1.inOut` | fill/stroke tween + badge pop `back.out(2)` 0.25s |
| Morph / layout (Flip, step 5, 9) | 0.9s | `power3.inOut` | Flip.from with `absolute:true`; stagger 0.06 |
| Token travel per edge | 0.9s | `power1.inOut` | MotionPath along edge; hold 0.15s at node while it turns red; full 7-agent chain < 8s |
| Chip/coin fly | 0.7s | `power2.inOut` | arc via MotionPath curviness 1.2; stagger 0.12 |
| Emphasis pulse | 0.8s x2, yoyo | `sine.inOut` | scale 1->1.06 + ring opacity .4->1; entry agents step 2 loop 3x then stop |
| Wave (blast radius) | 1.4s | `power1.in` then linear | per-agent colour hit at its x-position |
| Block impact | shield flash 0.12s white + scale 1.25 -> 1 over 0.3s `back.out(3)`; token shatter 0.5s `power3.out`; screen shake **none** (node shake 4u x 2, 0.15s) |
| ContextWipe | 0.5s | `power2.inOut` | then revert tint 0.4s |
| Caption swap | out 0.15s / in 0.25s | `none` | |
| Step transition | outgoing elements fade 0.3s, incoming starts at +0.2s | | step timeline total <= 6s excluding live steps |
Keep subtle: no bounce > `back.out(2)`, no looping animation except the active-ring spin (4s linear) and entry pulse; no parallax, no glow/blur filters (projector banding, perf). Max 60 animated nodes. Speed slider = `gsap.globalTimeline.timeScale()`.
Every step = one paused GSAP timeline `build(stepN)`; Prev jumps to the end state of N-1 (`progress(1)`) then reverses visibly only if Prev is pressed once; Reset step rebuilds.
**prefers-reduced-motion** (and Reduce-motion toggle): no travel/Flip/shatter/wave/shake/pulse; replace with 0.2s cross-fade to end state; token shown as static red marker on the edge with a numbered sequence (1,2,3) ; ContextWipe = static label; spin stops; Play auto-advance still works with a 2s dwell per sub-beat. Default the toggle from the media query.

---
## 6. Per-step frames

Presenter always clicks **Next** (or Right arrow) unless noted. Caption <= 2 short sentences.

| # | On screen | Animation | Caption | Click |
|---|---|---|---|---|
| 0 Title | White stage, H1 "Stopping a Prompt-Injection Worm in AI Agent Teams" (centre, 56u), subtitle name/guide/institute 28u, faint 7-node network watermark @8% | Title fade-up 0.8s, watermark edges draw | "Can one poisoned web page take over a whole team of AI helpers?" | Start (primary button "Begin") |
| 1 The team | 7 agents in layered layout, idle, edges with arrows; legend row (role icons) bottom | Nodes stagger in L->R, edges DrawSVG; orchestrator and reporter labelled | "Seven AI agents work as a team on a security test. Each one passes its findings to the next." | Next |
| 2 The threat | Website node enters far left; dashed edges to recon, scan_web, scan_net (entry style, "EXPOSED" tags); hidden-text strip revealed | Website slides in; 3 entry agents pulse 3x (orange ring) | "The target website is hostile. It hides a secret instruction (a *prompt injection*) in the page the first three agents read." | Next |
| 3 Why dangerous | Same view; token appears at website | Token travels each edge in order (0.9s/edge), each agent flips to compromised (hatch + bug badge); orchestrator gets star + "has the passwords" label; all red for 1.5s hold, then cross-fade reset to idle | "The hidden instruction spreads from agent to agent until the one holding the credentials (passwords) is taken over." | Next |
| 4 Risk scores | Chips tray at bottom: "shell +2", "credentials +2", "network +1", "files +1" | Chips fly into agents per capability (stagger .12), badge counts tick up, node scales 0.8-1.25; orchestrator & exploit get largest | "Each agent gets a risk score from 1 to 10 for what it can do. Bigger means more dangerous if taken over." | Next |
| 5 Linearize | Network morphs to columns B1..Bn with pills | Flip: nodes -> pills, edges fade, columns fade in with tints | "We lay the team out in a line. Each agent is a bar covering the steps (*bags*) where it is active." | Next |
| 6 Checkpoints | Pill diagram | Boundaries shared by agents highlight, then gate bars grow (S1, S2) with tabs; S0 grows at far left with arrow-in | "A checkpoint (*gate*) sits where agents hand work to each other. S0 guards the door from the outside world." | Next |
| 7 Blast radius | Gates, rho counter | Pick S1: wave sweeps right, downstream pills hatch red, rho ticks "= 4 agents"; repeat S2 (rho = 2) then S0 (rho = 7); waves reset between | "If an attack gets past a gate, everything after it is exposed. Earlier gates protect more agents." | Next (optionally click a gate to replay) |
| 8 Budget | Pot with 10 coins, ghost row "Equal split" over gates, bars | Ghost coins appear dashed (3/3/4); then "Risk split" coins fly to gates 6/1/3; bars grow | "We only have 10 guards to spend. Putting more where the damage would be biggest beats splitting evenly." | Next |
| 9 Guards | Coins at gates | Flip morph coin -> shield, count 6 / 1 / 3 beside gates; "catches 88%" label fades in under strongest | "Each spent coin is one more independent checker (*guard*). With 6 guards, about 88% of attacks are caught." | Next |
| 10 Back to network | Network layout again, shields on guarded agents (count in shield) | Reverse Flip pills -> nodes, shields ride along; unguarded stay plain | "Back on the real team: shields mark the agents with guards. These are the ones that check incoming messages." | Next |
| 11 Live undefended | Network, log drawer auto-opens at 40% (user can close); header badge "Live run - NO defence" (stroke `--st-compromised`) | Token follows real events from backend (SSE); agents turn compromised in event order; log rows stream with INFECT chips; elapsed timer | "A real run with no protection. The attack reaches the orchestrator and the whole team is taken over." | Press **Run** (primary, replaces Next until done) |
| 12 Live defended | Same, badge "Live run - DEFENDED" (stroke `--st-clean`) | At guarded agent: k vote chips fan out (stagger .1) PASS/BLOCK; any BLOCK -> shield flash, token shatters, ContextWipe sweep, banner "BLOCKED - attack stopped"; downstream agents stay clean with check badges; log shows GUARD/BLOCK/CLEAN rows | "Now the guards vote on each message. If any guard says BLOCK, the message is thrown away and the agent's memory is wiped." | Press **Run** |
| 13 Numbers | Bar chart (section 4), axis, annotation | Bars grow from 0 sequentially (0.8s each, stagger .25), values count up, "15x lower" arrow draws | "Chance the key agent is taken over: 44.7% with no defence, 6.7% with equal guards, 3.0% with our risk-based split." | None (end); Restart available |

Live steps 11/12: if backend is down, show ERROR log row + banner "Replaying recorded run" and play cached JSON; never blank.

---
## 7. Accessibility and projector checklist

- [ ] Body/caption text >= 7:1; graphics/strokes >= 3:1 (verified against `--stage-bg`).
- [ ] Every state = colour + icon + pattern/label; test with greyscale and deuteranopia simulation.
- [ ] Min on-screen text: 18u in SVG (>= 13.6px at 1366), caption 26px+, log 13px+ (log is secondary).
- [ ] Caption legible from ~10 m: 32px at 1080p, high contrast, never over busy artwork.
- [ ] Keyboard: all controls tabbable, visible 3px `--focus` outline, shortcuts in 5; dots are `<button>`s; Esc closes log.
- [ ] SVG groups have `role="img"` + `aria-label` per step ("Agent exploit: compromised, risk 8"); caption `aria-live=polite`; log is `role="log"` `aria-live=off` (avoid chatter) with a "Announce log" toggle.
- [ ] No flashing > 3 Hz; flash events (shield) <= 1 per second; no full-screen white flash except 0.5s sweep confined to one node.
- [ ] `prefers-reduced-motion` and manual toggle (5); animation never needed to read the final state.
- [ ] Hit targets >= 32px (dots) / 40px (buttons); cursor auto-hides not required, but pointer is large (use system).
- [ ] Projector: light bg #FFFFFF stage, no light-grey text below `--ink-3`, no tints with < 5% lightness difference carrying meaning, tint columns rely on labels not colour; avoid thin (<2u) strokes; test with brightness at 60% and with a 10:1 washed-out filter.
- [ ] Layout verified at 1920x1080, 1366x768, 1280x720; no scrollbars; browser fullscreen (F11) with zoom 100%.
- [ ] Fully offline: no CDN, fonts, or fetches except local backend/`/static/vendor`; works from `file://` for recorded replay.
- [ ] Performance: SVG only, no filters/blur, <= 300 DOM nodes animated, `will-change: transform` on moving groups only, 60fps on integrated GPU.
