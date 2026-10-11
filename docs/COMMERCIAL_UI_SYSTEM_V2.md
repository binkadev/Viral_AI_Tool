# Viral AI Tool — Commercial UI System V2

Status: **implementation checkpoint on `feat/commercial-ui-system-v2`; desktop visual acceptance pending**.

This document records the visual/UX contract for the commercial desktop app so later feature work does not drift back into prototype styling.

## 1. Product character

Viral AI Tool is a Windows-first creator workstation, not a generic SaaS dashboard and not a direct clone of MoneyPrinterTurbo.

MoneyPrinterTurbo is used only as a workflow-density reference: configuration is visible, generation state is obvious, and users retain control of Script → Media → Audio/Subtitles → Output. Viral AI Tool keeps its own Project, Editor, Job, Playback and provider-neutral architecture.

## 2. Architecture invariants

Visual work must not change these owners:

- one Project Model;
- one existing Studio editor;
- one player / playback clock;
- one canonical job system;
- provider-neutral Automation domain objects;
- editable intermediate Script, Scene, Asset, Voice and Composition results;
- renderer never owns provider secrets.

The final CSS layers are presentation-only. Existing IDs, `data-*` contracts, state objects and event ownership remain authoritative.

## 3. Typography contract

Use only the project Windows system stacks defined in `AGENTS.md` / `styles.css`:

- body/control: Segoe UI Variable Text stack;
- display headings: Segoe UI Variable Display stack.

Default `comfortable` scale:

| Role | Token | Size |
| --- | --- | ---: |
| Caption/helper | `--type-caption` | 11px |
| Meta/secondary | `--type-meta` | 12px |
| Body | `--type-body` | 13px |
| Control | `--type-control` | 13px |
| Card title | `--type-card-title` | 14px |
| Section title | `--type-section` | 17px |
| Page title | `--type-page` | 23px |

Rules:

- do not reintroduce 7–10px product copy in production surfaces;
- technical metadata may be compact only when genuinely non-essential;
- Vietnamese diacritics must have sufficient line height;
- text containers must tolerate VI/EN expansion;
- `compact` and `large` interface modes continue to use existing type tokens rather than page-local font sizes.

## 4. Density and geometry

Commercial default is dense-but-readable, comparable to a desktop production console:

- standard input/button height: 40px at comfortable scale;
- control radius: 8px;
- major panel radius: about 10–12px;
- app sidebar: about 244px comfortable;
- use thin borders and hierarchy before shadows/glow;
- no giant landing-page hero inside work surfaces;
- no excessive nested cards;
- keep primary actions visually obvious and secondary actions quiet.

## 5. Premium Dark direction

Midnight remains the default commercial appearance:

- near-black neutral application background;
- slightly raised neutral panels;
- restrained violet-blue accent for active/primary state;
- green/warning/danger reserved for semantic state;
- gradients are subtle and functional, not decorative;
- ambient effects are low-opacity background character only.

Light appearances stay supported through existing theme variables.

## 6. Automation UX

Automation is a production console rather than an internal engineering wizard.

### Brief / Script

- compact Automation header;
- provider readiness visible;
- grouped Script / Video / Audio & Subtitle setup;
- primary generation action in one clear run bar;
- generated Script remains editable.

### Scene Planner

- left navigator + right inspector;
- scene list uses readable 11–13px hierarchy;
- narration, visual intent and search terms remain directly editable;
- previous/next/save actions remain visible.

### Assets

- scene navigator + asset inspector;
- batch state is visible without dominating the page;
- provider/media/file health uses semantic status styling;
- replacing one asset remains an explicit bounded action.

### Timeline / Voice / Export

- V1 / SUB / A1 state remains visible;
- Voice provider status and scene coverage are readable;
- export progress/result is commercial-facing and does not expose internal engine names;
- existing `Mở trong Studio` / `Quay lại Automation` navigation ownership is preserved.

## 7. Studio UX

Studio keeps approved editor geometry and behavior. V2 standardizes visual hierarchy only:

- preview remains visually dominant;
- inspector tabs and controls follow shared type/control tokens;
- timeline labels, timestamps, clips and transcript text meet readability floors;
- no second timeline or playback clock;
- Source / Translation workstation stays synchronized with player time;
- focus-visible and selection state remain explicit.

## 8. Home / Dashboard / Settings / feedback

- Home behaves like a workstation entry screen, not a marketing landing page;
- Dashboard prioritizes real current project/account data over decorative metrics;
- Settings rows use consistent 12–13px hierarchy and 40px controls;
- toast/modal copy is readable and calm;
- drag/drop feedback is clear but does not pulse indefinitely;
- destructive and recoverable actions stay differentiated by existing product guardrails.

## 9. Motion and accessibility

- hover/press feedback is short and subtle;
- no new decorative animation loops in final commercial layers;
- `prefers-reduced-motion` and app `data-motion="reduced"` must disable non-essential transitions;
- keyboard focus must remain visible;
- essential controls must not rely on hover only;
- layout must remain usable at narrower desktop widths and with text expansion.

## 10. Final visual layers

Loaded after legacy/project CSS so they own the final presentation without rewriting business modules:

1. `core-commercial-ui-system-v2.css` — global shell, typography, controls, shared surfaces;
2. `core-commercial-pages-v2.css` — Home, Dashboard, Settings, cards, modal/toast/drop feedback;
3. `core-automation-commercial-v2.css` — Scene/Asset/Voice/Composition/Export workstation;
4. `core-studio-commercial-v2.css` — Studio timeline, transcript, inspector and player information chrome.

## 11. Acceptance checkpoint

Before merging:

- run `test:core-commercial-ui-system-v2`;
- run Automation targeted regressions;
- run `test:core-commercial`;
- verify `npm start` at 1920×1080 and a narrower desktop window;
- check VI and EN;
- check comfortable/compact/large sizes;
- check Midnight and both light appearances;
- check Reduced Motion;
- verify Automation Brief → Timeline and Studio return navigation;
- verify play/pause/seek/transcript/timeline remain synchronized;
- verify the local smoke `npm run pack` still succeeds;
- take runtime screenshots before approval.

Do not merge this visual branch until the desktop screenshots and interactions are explicitly accepted.
