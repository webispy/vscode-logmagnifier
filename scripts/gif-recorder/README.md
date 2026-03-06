# GIF Recorder

Automated animated GIF generator for LogMagnifier VS Code extension demos.

Driven by YAML spec files that describe step-by-step interactions. Uses the
[Playwright Electron API](https://playwright.dev/docs/api/class-electron) to
launch a clean, isolated VS Code instance (downloaded automatically via
`@vscode/test-electron`, cached in `~/.vscode-test/`) with the extension
loaded, then captures frames and assembles them into a polished GIF with
caption overlays.

---

## Prerequisites

| Tool | Install |
|------|---------|
| Node.js ≥ 18 | [nodejs.org](https://nodejs.org) |
| `gifski` (recommended) | `brew install gifski` |
| `ffmpeg` (fallback) | `brew install ffmpeg` |

> **No system VS Code required.** A clean VS Code stable build is downloaded
> automatically on first run and cached in `~/.vscode-test/`.

---

## Quick Start

```bash
# Install dependencies
cd scripts/gif-recorder
npm install

# Record the Runbook demo
npm run record:runbook

# Record any spec
npm run record specs/runbook.yaml
```

The output GIF is written to `resources/demo/<spec-output>.gif` in the
repository root.

---

## Writing a Spec

Specs are YAML files in the `specs/` directory. Each file defines:

```yaml
name: My Feature Demo      # Human-readable title
output: my-feature         # Output filename (without .gif)
window:
  width: 1280
  height: 800
frameDelay: 100            # ms between GIF frames (100 = 10 fps)
scale: 0.85                # Resize factor for smaller file size
steps:
  - type: command
    command: "LogMagnifier: Open Runbook"
    caption: "Open the Runbook panel"
    delay: 800

  - type: webview-click
    selector: "button.run-btn[data-block-id='block_0']"
    caption: "▶ Execute a shell block"
    delay: 1500

  - type: screenshot
    caption: "Real-time output streamed from the shell"
```

### Step Types

| Type | Description |
|------|-------------|
| `command` | Open command palette and execute a command by label |
| `click` | Click a DOM element by CSS selector |
| `aria-click` | Click by ARIA role + accessible name (more resilient) |
| `webview-click` | Click inside a VS Code Webview's inner iframe |
| `type` | Type text into the focused element |
| `key` | Press a keyboard key or shortcut (e.g. `Control+Shift+P`) |
| `wait` | Pause for a fixed duration |
| `screenshot` | Force a frame capture (no interaction) |
| `scroll` | Scroll a container element |
| `hover` | Hover over an element (shows tooltips / hover states) |

### Common Fields (all steps)

| Field | Default | Description |
|-------|---------|-------------|
| `caption` | `""` | Text shown in the caption bar at the bottom of the frame |
| `delay` | `300` | Milliseconds to wait after the action before capturing |
| `capture` | `true` | Set to `false` to skip capturing a frame for this step |

---

## Fixtures

The `fixtures/` directory provides:

- **`workspace/`** — the VS Code workspace folder opened during recording.
  Add any files you want visible in the Explorer here.

- **`workspace/.vscode/settings.json`** — workspace-level VS Code settings
  applied during recording (e.g. disable minimap, breadcrumbs).

- **`runbook/`** — pre-populated Runbook storage. Contents are copied into
  `<userDataDir>/User/globalStorage/webispy.logmagnifier/runbooks/` before
  VS Code launches, so runbook groups and files appear immediately in the tree
  without any manual setup during the recording.

---

## Architecture

```
runner.ts
  └── launchVSCode()      — launches VS Code via Playwright Electron API
  └── executeStep()       — dispatches each YAML step to the right action
  └── captures frames     — screenshot after each step
  └── composeGif()        — delegates to composer.ts

composer.ts
  └── annotateFrame()     — adds caption bar overlay using sharp + SVG
  └── assembleWithGifski()— gifski CLI for high-quality GIF (preferred)
  └── assembleWithFfmpeg()— ffmpeg two-pass palette GIF (fallback)
```
