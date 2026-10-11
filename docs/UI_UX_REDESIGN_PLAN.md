# UI/UX Redesign Plan

This document defines the commercial visual pass for Viral AI Tool after the Automation MVP implementation.

## Direction

The product should feel like a professional desktop production console rather than a demo dashboard or internal wizard. The visual system takes inspiration from the dense, settings-first production flow used by MoneyPrinterTurbo while preserving Viral AI Tool's own editable Studio, Automation stages, project state, and desktop architecture.

## Product principles

- Keep one authoritative workflow: Automation produces editable project state and Studio remains the editor.
- Prefer dense, scannable production controls over oversized marketing surfaces.
- Use restrained motion and purposeful emphasis; avoid decorative movement that competes with work.
- Keep hierarchy explicit: page context, production stage, settings, primary action, status, result.
- Keep all existing functionality and data attributes stable; this pass should not rewrite business logic.
- Maintain keyboard focus visibility, reduced-motion behavior, responsive layouts, and dark/light theme compatibility.

## Visual hierarchy

1. App shell: compact title bar, calmer sidebar, crisp top bar, consistent spacing.
2. Automation: production-console layout with grouped Script / Video / Audio settings, provider health, stage tabs, sticky run action, editable outputs.
3. Studio: flatter workstation chrome, stronger preview/timeline separation, clearer inspector and track hierarchy.
4. Shared controls: consistent radius, border, elevation, hover, pressed and focus states.
5. Feedback: clear success/warning/error states without excessive glow or gradients.

## Acceptance

- No navigation, Automation, Studio, playback, timeline, persistence or export behavior may be removed.
- No second editor or pipeline may be introduced.
- UI remains usable at 1280px wide and scales upward cleanly.
- Reduced motion removes non-essential animation.
- Existing regression suites stay applicable.
