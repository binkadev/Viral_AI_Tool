# Curated skill stack for Viral AI Tool

Checked on **2026-09-30** using GitHub repository metadata.

This file documents external skill repositories that are useful as design, engineering, accessibility, or security references. They are references only; their source is not copied into this repository unless a compatible license and a clear need are confirmed.

| Repository | Why it is useful here | GitHub signal checked |
|---|---|---|
| `anthropics/skills` | Official Agent Skills collection. The `frontend-design` skill is especially useful for avoiding generic AI-looking UI and improving typography, layout, copy, and critique. | ~179k stars, active, not archived |
| `vercel-labs/agent-skills` | Official Vercel skills. `web-design-guidelines` is useful for UI review and interaction/accessibility checks. | ~31.7k stars, active, not archived |
| `obra/superpowers` | Strong development methodology for planning, implementation, testing, review, and maintaining quality across long-running coding tasks. | ~293k stars, MIT, active |
| `plugin87/ux-ui-agent-skills` | Broad UX/UI reference with WCAG, ARIA, i18n, text expansion, design tokens, and component guidance. | ~1.5k stars, MIT, active |
| `superdesigndev/superdesign-skill` | Focused visual-design skill for improving design direction and avoiding generic generated interfaces. | ~619 stars, MIT, active |
| `ptn1411/skill` | Useful selectively for defensive Electron security review and supply-chain auditing. Do not import the repository wholesale because many skills target reverse engineering or bypass-oriented workflows that are unrelated to this product. | ~210 stars, active; repository-level license not declared |

## What Viral AI Tool adopts

### Visual design

From the design-focused repositories:

- one clear visual hierarchy rather than repeated equal-weight cards;
- restrained motion;
- direct product copy;
- sentence case for most UI copy;
- visible focus states;
- intentional spacing and typography;
- avoid decorative labels that do not convey information.

### Localization

From i18n/accessibility guidance:

- externalize all strings;
- support text expansion;
- use locale-aware formatting when dates/currency are added;
- use UTF-8 end to end;
- prefer logical CSS properties for future layout work;
- avoid fixed widths for essential translated controls.

### Electron and dependency security

From defensive audit practices:

- isolate renderer from Node.js;
- expose only narrow preload APIs;
- validate IPC payloads;
- do not put secrets in renderer code;
- audit dependencies and install scripts;
- commit the lockfile;
- keep download/render operations separated from the renderer process.

## Repositories reviewed

- https://github.com/anthropics/skills
- https://github.com/vercel-labs/agent-skills
- https://github.com/obra/superpowers
- https://github.com/plugin87/ux-ui-agent-skills
- https://github.com/superdesigndev/superdesign-skill
- https://github.com/ptn1411/skill
