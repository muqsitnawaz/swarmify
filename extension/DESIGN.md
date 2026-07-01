---
version: alpha
name: "Swarmify"
description: "The Integrated Agents Environment (IAE). A VS Code / Cursor extension that turns the editor into a factory floor for orchestrating Claude, Codex, Gemini, and Cursor in parallel. Visual language: an industrial terminal console — black canvas, neon-green readouts, embossed metal controls."

colors:
  # Brand — lime-400, the agents-cli landing palette
  brand: "#a3e635"
  brand-600: "#84cc16"
  brand-700: "#65a30d"
  brand-50: "#f7fee7"
  brand-100: "#ecfccb"
  brand-ring: "rgba(163,230,53,0.25)"
  # Logo / legacy accent — coral from the rush bird mark
  coral: "#e85d5d"

  # Dark theme (canonical "Terminal Console")
  bg: "#0a0a0a"
  bg-panel: "#141414"
  bg-sunken: "#050505"
  bg-inset: "#1a1a1a"
  bg-recessed: "#0f0f0f"
  border: "rgba(255,255,255,0.08)"
  border-strong: "rgba(255,255,255,0.15)"
  border-subtle: "rgba(255,255,255,0.04)"
  text: "#E7E5E4"
  text-muted: "#A8A29E"
  text-dim: "#6E6A63"
  text-faint: "#44403C"

  # Status readouts
  status-pending: "#D4A72C"
  status-running: "#22C55E"
  status-failed: "#EF4444"
  status-idle: "#6B7280"

  # Agent identity accents
  agent-claude: "#a3e635"
  agent-codex: "#1a1a1a"
  agent-gemini: "#4A7DFF"
  agent-opencode: "#0a0a0a"
  agent-cursor: "#0a0a0a"
  agent-shell: "#84cc16"

typography:
  # Sans — Geist. Mono — Geist Mono. 13px base.
  heading:
    fontFamily: "Geist, -apple-system, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Geist, -apple-system, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.005em"
  # Stamped panel lettering — uppercase mono, wide tracking
  label:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, monospace"
    fontSize: "9.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.1em"
  readout:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.03em"

rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  full: "9999px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"

shadows:
  emboss: "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.6)"
  inset: "inset 0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.3)"
  raised: "0 1px 0 rgba(255,255,255,0.04), 0 2px 4px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)"

components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 {spacing.md}"
  button-secondary:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    boxShadow: "{shadows.raised}"
  panel:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.md}"
    boxShadow: "{shadows.emboss}"
    padding: "{spacing.md} 14px"
  keycap:
    backgroundColor: "{colors.bg-inset}"
    typography: "{typography.readout}"
    rounded: "{rounded.xs}"
    borderColor: "{colors.border-strong}"
  badge:
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    boxShadow: "{shadows.inset}"
    textTransform: "uppercase"
---

## Overview

Swarmify is a control room, not a document. Text editors became IDEs when coding got complex; now that agents do the coding, the environment evolves again into an **IAE** — an Integrated Agents Environment where you orchestrate ten Claudes, Codexes, and Geminis at once. The interface has to hold that scale without collapsing into noise.

So the product is dressed as an **industrial terminal console**: a black canvas, neon-green LED readouts, and metal controls that look stamped, beveled, and physically pressable. Every surface reads as a piece of hardware on a factory floor — panels are embossed, buttons depress on click, status lives in glowing indicator LEDs, and labels are laser-etched in uppercase monospace. The feeling to evoke is *mission control under load*: dense, legible, tactile, calm. Nothing decorative earns its place; every glow, bevel, and readout is a status signal.

The design system is defined canonically in `ui/settings/components/mission-control/design-system.css` (the `.theme-dark` / `.theme-light` token blocks) and consumed across the Factory Floor dashboard, the unified agents list, and the topbar/statusbar shell.

## Colors

The brand is **lime-400** (`#a3e635`) — the same neon-green as the agents-cli landing palette. It is the single accent that means "active, selected, live." Use it sparingly; on a black canvas one lime element pulls the eye instantly, and that is the whole point.

**Brand**
- `brand` (`#a3e635`) — primary accent: active tab, selected row, primary button, live throughput. Pair with `brand-ring` (`rgba(163,230,53,0.25)`) for focus glows.
- `brand-600` (`#84cc16`) / `brand-700` (`#65a30d`) — hover and pressed depths of the primary button.

**Coral** (`#e85d5d`) is the legacy logo accent (the rush-bird mark) and still surfaces as `--primary` in `index.css` and in a few selected-state fills. Treat lime as the system brand and coral as the mark color only; do not introduce new coral UI.

**Surfaces** (dark theme, canonical) run a five-step depth ladder from black up:
- `bg` (`#0a0a0a`) — the canvas.
- `bg-sunken` (`#050505`) / `bg-recessed` (`#0f0f0f`) — wells: recessed inputs, tab tracks, gauges. Anything the eye should read as *below* the surface.
- `bg-panel` (`#141414`) — raised panels, cards, the topbar and statusbar.
- `bg-inset` (`#1a1a1a`) — keycaps and the lightest raised chrome.

**Text** is a four-step warm-gray hierarchy: `text` (`#E7E5E4`) for primary, `text-muted` (`#A8A29E`) for body, `text-dim` (`#6E6A63`) for labels and metadata, `text-faint` (`#44403C`) for timestamps and separators.

**Status** never relies on color alone — each state carries a shape (LED dot, badge, gauge) and a word:
- `status-running` (`#22C55E`) — green, with a glow. The healthy default.
- `status-pending` (`#D4A72C`) — amber. Queued / waiting on approval.
- `status-failed` (`#EF4444`) — red, with a glow.
- `status-idle` (`#6B7280`) — gray, no glow.

**Agent identity** colors tag which model owns a terminal or row: Claude → lime (`#a3e635`), Gemini → blue (`#4A7DFF`), Codex / OpenCode / Cursor → near-black on light, inverting to white in dark, Shell → lime-600 (`#84cc16`).

A light theme (`.theme-light`) mirrors every token on a warm stone canvas (`#E8E6E1`) for users on light OS settings; the theme is chosen from the system `prefers-color-scheme`.

## Typography

Two families, no more. **Geist** for interface text, **Geist Mono** for anything that reads as machine output — labels, badges, keycaps, readouts, timestamps, agent activity. The mono/sans split *is* the information hierarchy: prose is human, monospace is the machine talking back.

Base size is a dense **13px** at `line-height: 1.45` with a hair of negative tracking (`-0.005em`) and Geist's stylistic sets on (`cv11, ss01, ss03`). The UI is information-dense by design — resist the urge to inflate it.

- **heading** — panel and section titles; 13px, weight 700.
- **body** — default prose, agent output, list rows; 13px, weight 400.
- **label** — stamped panel lettering: 9.5px Geist Mono, weight 600, `letter-spacing: 0.1em`, UPPERCASE. Section headers, badges, tab labels, kind chips.
- **readout** — recessed LED-style displays: 11px Geist Mono, `letter-spacing: 0.03em`, optionally lime with a text-glow when live.

Numbers that update in place use `font-variant-numeric: tabular-nums` so counters don't jitter.

## Layout

The signature view is the **Factory Floor** — a fixed three-pane grid: a 300px control column, a fluid center stream, and a 360px detail rail (`grid-template-columns: 300px 1fr 360px`). The unified agents view splits `minmax(320px, 30%) 1fr`. The app shell is a `grid-template-rows: auto 1fr auto` sandwich: topbar (46px), body, statusbar (26px).

Spacing is small and consistent — the scale is `4 / 8 / 12 / 16 / 24px`. Panel padding is `12px 14px`, list rows `6–8px`, pane heads `10px 14px`. Panes divide with `2px` structural borders (heavier than the `1px` hairlines used inside a panel) so the floor reads as bolted-together modules, not floating cards.

Scrollbars are thin (6px) and themed to match the recessed wells.

## Elevation & Depth

Depth is the core mechanic — this is a console of physical parts, so **everything is either raised or recessed**, never flat. Three named shadow recipes carry it:

- **emboss** (`inset 0 1px 0 bevel-light, inset 0 -1px 0 bevel-dark`) — the default panel treatment. A top highlight + bottom shadow that reads as a stamped metal face.
- **raised** — a drop shadow + hairline ring for buttons, chips, and cards that sit *above* the surface and can be pressed.
- **inset** — a deep inner shadow for wells: recessed inputs, tab tracks, gauges, badges. Anything the surface is carved *into*.

Interaction is physical: pressable controls `transform: translateY(1px)` and swap `raised` → `inset` on `:active`, so a click looks and feels like depressing a real key. Status LEDs and live values add a colored `box-shadow` glow (and matching `text-shadow`) so "running" literally emits light.

## Shapes

Corners are tight and mechanical, on a `3 / 4 / 6 / 8 / 10px` radius scale — smaller than typical web UI, because hardware has crisp edges:
- `rounded-xs` (3px) — badges, keycaps, small chips, LED readouts.
- `rounded-sm` (4px) — buttons, inputs, list rows.
- `rounded-md` (6px) — panels, menus, tab groups.
- `rounded-lg` (8px) — larger cards and popovers.
- `rounded-full` — LED status dots and avatars only.

Avatars and agent chips are near-square (2–4px radius), riveted with an inner highlight — badges, not bubbles.

## Components

### Buttons
- **Primary** — solid lime, white text, a hard bottom edge (`0 2px 0 brand-700`) so it looks like a physical key. Uppercase mono label. One per context.
- **Secondary** — panel-fill with a `raised` shadow and strong border.
- **Ghost** — transparent, muted text, fills on hover. For low-priority actions.
- **Danger** — red-tinted; fills solid red on hover for destructive intent.

All buttons are 28px tall (24px for `.sm`), uppercase Geist Mono, and depress (`translateY(1px)` + `inset`) on click.

### Status indicators
- **LED dot** (8px circle) — running pulses with a double glow; pending/failed carry a single glow; idle is dim. The canonical at-a-glance signal.
- **Badge** — recessed uppercase mono pill with a status-tinted fill and a text-glow for live states (`RUNNING`, `MERGED`, `OPEN`, `FAILED`).
- **Gauge** — a segmented (dashed) fill bar in the recessed well, colored by health (running/warn/danger).

### Keycaps (`kbd`)
Physical keycap chips render every shortcut: mono, bordered, with a stacked bottom-shadow that reads as a pressable key. Keyboard-first is a product pillar — shortcuts appear inline everywhere they apply.

### Panels & readouts
Sections are embossed panels with a mono UPPERCASE header and a hairline underline. Live values render in recessed **readout** displays that glow lime when active.

### Tabs, chips, toggles
Tabs are stamped-metal switches in a recessed track; the active tab lifts to a raised panel face. The toggle is a rocker switch (square knob, inset track) that fills lime when on. Chips are raised mono selectors that recess when active.

## Do's and Don'ts

**Do:**
- Keep lime for "live / selected / primary" only — one dominant accent per view.
- Signal every status with shape *and* word *and* color (LED + label + tint), never color alone.
- Use Geist Mono for machine output and Geist for prose — the split is the hierarchy.
- Make interactive controls physical: raised at rest, inset + `translateY(1px)` on press.
- Stay dense. 13px base, small radii, tight spacing — the floor holds many agents at once.
- Use `tabular-nums` for any counter that updates in place.

**Don't:**
- Introduce new coral UI — coral is the legacy logo mark; lime is the system brand.
- Use emojis, icons-as-decoration, or any ornamental flair (hard rule: this codebase forbids emojis everywhere).
- Add toast notifications — success is silent, errors show inline near the action (hard rule).
- Flatten surfaces — every element is raised or recessed; a shadowless card looks broken here.
- Mix rounded-full with the sharp radius scale outside of LED dots and avatars.
- Inflate type or spacing to "breathe" — density is the design, not a compromise.
