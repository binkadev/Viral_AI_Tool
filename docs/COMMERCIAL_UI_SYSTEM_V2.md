# Viral AI Tool — Commercial UI System V2

Status: **implementation checkpoint on `feat/commercial-ui-system-v2`; desktop visual acceptance pending**.

This document records the visual/UX contract for the commercial desktop app so later feature work does not drift back into prototype styling.

## 1. Product character

Viral AI Tool is a Windows-first creator workstation, not a generic SaaS dashboard and not a direct clone of MoneyPrinterTurbo.

MoneyPrinterTurbo is used only as a workflow-density reference: configuration is visible, generation state is obvious, and users retain control of Script → Media → Audio/Subtitles → Output. Viral AI Tool keeps its own Project, Editor, Job, Playback and provider-neutral architecture.

### Global benchmark set

Use the strongest ideas from mature global products and design systems, never visual cloning:

- **Apple HIG** — clarity, agency, recoverability, concise hierarchy and brief purposeful motion;
- **Microsoft Fluent 2** — platform-natural layout, spacing as hierarchy, functional/natural/consistent motion, top-level navigation through quick fades rather than theatrical slides;
- **Adobe Spectrum** — coherent tokenized typography, states, components and motion across professional creative applications;
- **Raycast** — one obvious focal action, consolidated action/status feedback, fast keyboard-first productivity and reduced UI chrome;
- **Linear** — context-aware command patterns, compact information density and predictable keyboard/mouse navigation;
- **Runway** — creative generation flows expose intermediate media decisions instead of hiding everything behind one opaque job;
- **Descript** — transcript/media editing stays close to the actual editable content rather than turning the editor into a settings dashboard;
- **Figma** — semantic design tokens and motion values are systems, not one-off page effects.

The intended result is a premium creator workstation that feels fast, controlled and crafted on Windows. It should not visually impersonate any of these products.

### Vietnamese design-system reference

For the commercial pass, use CyberSkill Global Design System (`cyberskill-official/design`) as a Vietnamese product-design reference, not as vendored code or a brand to copy. Useful principles:

- Vietnamese-first copy and line-height are first-class requirements;
- enterprise-grade surfaces favour hierarchy, contrast and direct wording over decorative effects;
- body copy must remain clearly readable on dark surfaces;
- focus state must stay visible;
- primary targets should be comfortably clickable;
- status must be communicated with words as well as colour;
- dark mode should use restrained elevation, borders and semantic colour instead of glow-heavy decoration.

Adapt these principles to Viral AI Tool's existing typography and brand colours. Do not copy CyberSkill's identity or mascot system.

## 2. Architecture invariants

Visual work must not change these owners:

- one Project Model;
- one existing Studio editor;
- one player / playback clock;
- one canonical job system;
- provider-neutral Automation domain objects;
- editable intermediate Script, Scene, Asset, Voice and Composition results;
- renderer never owns provider secrets.

The final visual layers must not create a second workflow engine, second playback clock or second project truth. Existing IDs, `data-*` contracts, state objects and event ownership remain authoritative.

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

For wide Windows desktops:

- do not center a narrow workstation inside a wide content area and leave large dead gutters;
- Automation consumes the available work area after page padding;
- use a persistent workflow rail on the left and one active working surface on the right;
- Timeline may use a narrow Voice inspector beside the main Composition workspace when enough width is available;
- collapse back to a horizontal stage rail on narrower windows.

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

### Global state vs current view

Project progress and the stage the user is currently reviewing are different concepts and must not contradict each other.

- project progress may be complete while the user intentionally revisits Brief, Script or Scenes;
- reopening a project defaults to the highest relevant stage unless the user explicitly selected an earlier stage during the same session;
- completing Script, Scene Plan or Assets automatically advances only when doing so preserves user context;
- each stage reports `Đang xem`, `Đã xong`, `Sẵn sàng` or `Chưa mở` independently;
- stale downstream data must move the user back to the earliest valid recovery point without deleting accepted upstream work.

### Brief / Script

- compact Automation header;
- provider readiness visible but visually secondary;
- grouped Script / Video / Audio & Subtitle setup;
- content settings are primary; output configuration stacks in a narrower side column on wide screens;
- primary generation action appears once in one clear action bar;
- generated Script remains editable.

### Scene Planner

- persistent workflow rail at wide desktop width;
- scene navigator + right inspector inside the active stage;
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
- on wide desktops, Voice becomes a side inspector rather than another full-width banner;
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

Motion is a navigation/feedback system, not decoration.

- stage transitions use a brief old-content fade/settle followed by a new-content fade/translate, preserving spatial continuity;
- large top-level surfaces do not slide across the whole app;
- button hover/press feedback is short and tactile;
- completion/status changes use colour, text and small local motion rather than confetti or continuous glow;
- users never wait for an animation before they can act;
- no decorative animation loops in final commercial layers;
- `prefers-reduced-motion` and app `data-motion="reduced"` disable non-essential transitions;
- keyboard focus remains visible;
- essential controls never rely on hover only;
- layout remains usable at narrower desktop widths and with VI/EN text expansion.

## 10. Final visual layers

Loaded after legacy/project CSS so they own final presentation without rewriting business modules:

1. `core-commercial-ui-system-v2.css` — global shell, typography, controls and shared surfaces;
2. `core-commercial-pages-v2.css` — Home, Dashboard, Settings, cards, modal/toast/drop feedback;
3. `core-management-commercial-v2.css` — management/workflow legacy surfaces;
4. `core-automation-commercial-v2.css` — base Automation workstation surfaces;
5. `core-studio-commercial-v2.css` — Studio timeline, transcript, inspector and player information chrome;
6. `core-automation-experience-v3.css` — final Automation layout, hierarchy, active-stage canvas and view-transition motion.

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
- verify reopening a completed project lands on the relevant current stage instead of showing a contradictory Brief state;
- verify manually revisiting an earlier completed stage remains possible without mutating project truth;
- verify Automation Brief → Timeline and Studio return navigation;
- verify play/pause/seek/transcript/timeline remain synchronized;
- verify the local smoke `npm run pack` still succeeds;
- take runtime screenshots before approval.

Do not merge this visual branch until the desktop screenshots and interactions are explicitly accepted.
