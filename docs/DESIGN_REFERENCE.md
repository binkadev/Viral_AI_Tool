# Viral AI Tool — UI/UX direction

Updated: 2026-09-30

## Chosen direction

**Aurora Light = Bright Glass Studio + Colorful Creator Studio**

Goals:
- professional desktop workstation;
- bright, low-fatigue surfaces instead of a heavy black dashboard;
- restrained glass effects;
- colorful functional accents;
- motion that communicates state;
- user-controlled appearance, motion, interface size, and language.

## References researched

### Raycast

References:
- https://www.raycast.com/blog/a-fresh-look-and-feel
- https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast
- https://manual.raycast.com/settings
- https://manual.raycast.com/themes

Useful ideas adopted:
- fast / simple / delightful interaction principle;
- desktop-native feeling even when the UI uses web technology;
- compact controls and clear action hierarchy;
- appearance and interface-size preferences;
- theme changes are explicit user choices.

### OpenCreator

Repository:
- https://github.com/krillinai/OpenCreator

Useful ideas adopted:
- creator-first workspace rather than a generic SaaS dashboard;
- visual creator tools grouped by task;
- localized interface;
- shared desktop/web state architecture;
- video translation and download workflows as first-class tools.

### AI Video Production Editor

Repository:
- https://github.com/LudwigKienle/ai-video-production-editor

Useful ideas adopted:
- production-workstation mental model;
- visible processing phases;
- activity/progress as part of the main UI;
- creator workflows should feel like a studio, not a form collection.

### shadcn/ui

References:
- https://ui.shadcn.com/docs/components/aria/select
- https://ui.shadcn.com/docs/components/aria/combobox

Useful ideas adopted:
- explicit option lists for choices;
- visible chevron on selection controls;
- keyboard/focus semantics;
- do not hide multiple choices behind a binary toggle.

## Current design tokens

Aurora Light:
- background: #F4F7FC
- surface: white / translucent white
- primary: #7367F0
- sky: #4FB7FF
- mint: #35C995
- coral: #FF8D68
- pink: #EF6E9C
- amber: #F2C457

Typography:
- Segoe UI Variable Text
- Segoe UI Variable Display
- Segoe UI fallback
- UTF-8 throughout

## Motion system

Balanced default:
- page enter transition;
- active sidebar indicator;
- progress shimmer;
- subtle ambient gradient motion;
- processing badge pulse;
- workflow activity line;
- animated voice waveform;
- modal/popover enter;
- button sheen;
- drop-zone feedback.

User can select:
- Balanced
- Expressive
- Reduced motion

`prefers-reduced-motion` is always respected.

## Selection UX rule

Whenever a setting has more than two meaningful choices, use a dropdown/select/combobox with:
- current value visible;
- downward chevron;
- full option list;
- selected state/checkmark where appropriate.

Example: Language is not a VI/EN toggle. It opens a menu listing:
- Tiếng Việt
- English

The same rule applies to theme, motion, interface size, model, voice, target language, export format, and similar controls.
