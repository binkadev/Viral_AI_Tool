# Viral AI Tool — Agent Guidelines

These project rules keep the desktop app visually consistent, bilingual, accessible, and safe to ship.

## Product direction

Viral AI Tool is a Windows-first Electron desktop application for video workflows: import, analyze, localize, voice, subtitle, render, automate, and publish.

The app must feel like a professional creator workstation, not a generic SaaS dashboard.

## Design rules

Use these references as guidance, not as vendored source code:

- Anthropic `frontend-design`: make visual choices specific to the product, avoid generic AI-generated card layouts, use restrained motion, and keep copy direct.
- Vercel `web-design-guidelines`: review interaction, focus states, keyboard usability, form semantics, and interface clarity.
- plugin87 `ux-ui-agent-skills`: use externalized strings, test text expansion, preserve accessibility, and keep i18n concerns in the architecture.
- Superdesign skill: use for visual critique and design-system exploration when a page needs a stronger visual direction.
- Superpowers: use for planning, implementation discipline, review, and regression-minded changes.
- ptn1411/skill: use only defensive Electron and supply-chain audit concepts. Do not import offensive/bypass-oriented skills into this project.

## Localization

The production UI supports:
- `vi` — Vietnamese
- `en` — English

Requirements:
- All user-facing strings must live in `renderer/i18n.js`.
- Never introduce mojibake or non-UTF-8 encoded text.
- Keep `<meta charset="utf-8">`.
- Persist locale choice in localStorage.
- Do not concatenate translated sentence fragments.
- UI must tolerate at least 40% text expansion.
- Prefer logical CSS properties for new layout code.

## Typography

Use the Windows system stack:

```css
font-family:
  "Segoe UI Variable Text",
  "Segoe UI Variable",
  "Segoe UI",
  "Noto Sans",
  Arial,
  sans-serif;
```

For display text:

```css
font-family:
  "Segoe UI Variable Display",
  "Segoe UI Variable",
  "Segoe UI",
  Arial,
  sans-serif;
```

This avoids runtime font downloads and provides reliable Vietnamese diacritics on Windows.

## Electron security baseline

Keep:
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- a narrow preload bridge
- no renderer access to Node.js
- no arbitrary shell command bridge
- validate all future IPC payloads

When adding packages, prefer pinned dependencies and keep lockfiles committed.

## Definition of done

A UI change is done when:
- both VI and EN render correctly;
- Vietnamese diacritics display correctly;
- focus-visible states work;
- no essential control relies on hover only;
- no user-facing string is hard-coded outside the locale layer;
- app still starts with `npm start`.


## Selection controls

Do not replace multi-choice settings with hidden binary toggles.

When a control has more than two meaningful options:
- show the current value;
- show a downward chevron;
- open an explicit option list;
- preserve keyboard focus and selected state.

This applies to language, appearance, motion, interface size, model, voice, target language, export format, and other configuration controls.

The default visual direction is **Aurora Light**: bright glass surfaces with colorful creator-tool accents. Large visual-direction changes require explicit user approval before implementation.
