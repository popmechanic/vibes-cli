---
globs:
  - components/Auth*/**
  - components/BrutalistCard/**
  - components/LabelContainer/**
  - skills/*/template.delta.html
description: Auth component conventions and Amber's design constraints
---

# Auth Components

The `components/` directory contains TypeScript source-of-truth components. Templates are directly informed by these.

## AuthPopUp vs AuthScreen

| Aspect | AuthPopUp | AuthScreen |
|--------|-----------|------------|
| Visibility | Modal (isOpen/onClose props) | Always visible (gate) |
| Close button | Yes (dismissible) | No (must complete auth) |
| Content | Hardcoded buttons | Flexible `children` prop |
| Use case | Optional auth prompt (vibes) | Required auth gate (sell/SaaS) |

## Style Consistency

When creating or modifying auth components, match these values from AuthPopUp:
- `getButtonsContainerStyle`: `gap: "1rem"`, `maxWidth: "400px"`
- `getContainerStyle`: `minHeight: "500px"`, `gap: "2rem"`
- Animations: `shredCard`, `collapseToLine` keyframes

## Preserving Amber's Work

Never modify the original component files without explicit request. Bug fixes to HiddenMenuWrapper (CSS variable fixes, button resets) are acceptable. Design changes require discussion.
