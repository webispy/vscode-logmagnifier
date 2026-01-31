---
trigger: always_on
---

# Commit Message Guidelines

## Format

Follow the Linux kernel commit message style:
```
<subsystem>: <brief description>

<detailed explanation>
```

## Rules

### Subject Line (First Line)
- **Format**: `<subsystem>: <brief description>`
  - Exception: Release commits (e.g., `Release v1.5.4`) do not require a subsystem prefix.
- **Length**: Maximum 60 characters
- **Style**: Imperative mood, lowercase after prefix, no period
- **Examples**:
  - `ui: add dark mode support`
  - `net: fix connection timeout issue`
  - `build: update gradle dependencies`
  - `Release v1.5.4`

### Body (Detailed Explanation)
- **Mandatory**: Commit body must NOT be empty
- **Content**: 
  - Explain what and why, not how
  - Wrap at 72 characters per line
  - Describe the problem and rationale for the change

## Examples

### ✅ Good
```
auth: implement biometric authentication

Add fingerprint and face recognition support for user login.
This improves security and provides password-less authentication.
Falls back to password when biometric hardware is unavailable.
```

```
perf: optimize definition lookup and reduce memory churn

This patch improves the performance of the definition lookup (Command+Hover)
feature by eliminating redundant operations and reducing memory pressure.
```

```
ui: enhance filter tree icons with theme awareness

Refine the filter tree view to provide clearer visual distinction between enabled
and disabled states.

1. Filter Groups:
   - Enabled: Displays a theme-aware folder icon.
   - Disabled: Displays a dimmed folder icon with a slashed overlay.

2. Filter Items:
   - Disabled: Now displays an explicit 'OFF' text icon for immediate
     recognition.

To support these dynamic SVG icons, a theme change listener has been
added to ensure icon colors update immediately when the VS Code color
theme transitions.

Key changes:
- Implement dynamic SVG generation for groups and disabled items.
- Replace static ThemeIcons with dynamic SVGs in FilterTreeView.ts.
- Add onDidChangeActiveColorTheme listener in extension.ts to trigger
  tree view refresh on theme changes.
```

### ❌ Bad
```
fix bug
```
No subsystem prefix, no body
```
ui: update login screen
```
Missing body explanation

## Validation

Commits will be rejected if:
- Subject line exceeds 60 characters
- Body is empty or whitespace only
- Missing `<subsystem>:` prefix format (except for Release commits)