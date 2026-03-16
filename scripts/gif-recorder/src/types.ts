/**
 * Type definitions for the GIF recorder spec format.
 *
 * A spec YAML file describes a sequence of steps to automate in VS Code.
 * Each step can be a command, click, keystroke, wait, or screenshot capture.
 */

/** Top-level spec file structure */
export interface Spec {
  /** Human-readable name of the demo (used as default output filename) */
  name: string;
  /** Output GIF filename (without extension). Defaults to kebab-case of name. */
  output?: string;
  /**
   * Path to a shared defaults YAML file (relative to this spec file).
   * Top-level non-steps keys are merged in; values defined in this spec take precedence.
   * Consumed and removed by loadSpec() — not present at runtime.
   *
   * Step sequences can be shared via `type: include` steps (expanded at load time by
   * loadSpec()). Include steps are never passed to executeStep(); they are replaced
   * inline with the steps from the referenced file before execution begins.
   */
  defaults?: string;
  /** VS Code window size */
  window: {
    width: number;
    height: number;
  };
  /** GIF playback frame delay in milliseconds (default: 80) */
  frameDelay?: number;
  /** GIF output scale factor 0.0–1.0 (default: 1.0) */
  scale?: number;
  /**
   * If true, hover over each clickable element and capture hover + mousedown frames
   * before the click, so viewers can see which button is being targeted.
   * Default: false
   */
  hoverBeforeClick?: boolean;
  /**
   * Milliseconds to hold on the last frame before the GIF loops back to the start.
   * Achieved by duplicating the final frame. Default: 0
   */
  loopDelay?: number;
  /** Ordered list of steps to execute */
  steps: Step[];
}

/** Union of all step types */
export type Step =
  | CommandStep
  | ClickStep
  | AriaClickStep
  | WebviewClickStep
  | WebviewScrollStep
  | TypeStep
  | KeyStep
  | KeyHintStep
  | DelayStep
  | ScreenshotStep
  | ScrollStep
  | HoverStep
  | EnsureCollapsedStep
  | EnsureExpandedStep
  | SetupSidebarStep
  | DragStep
  | DebugWebviewStep
  | DebugTreeStep
  | AdbLaunchAppStep
  | AdbShellStep
  | AdbEnsureEmulatorStep;

/** Common fields shared by all steps */
interface BaseStep {
  /** Optional human-readable label shown as a caption on the frame */
  caption?: string;
  /**
   * How long to display this frame in the GIF output, in milliseconds.
   * The frame is duplicated (hold / frameDelay) times so it stays on screen longer.
   * When omitted, the frame is shown for one frameDelay period.
   */
  hold?: number;
  /** Whether to capture a screenshot frame after this step (default: true) */
  capture?: boolean;
}

/**
 * Open the VS Code Command Palette and execute a named command.
 * Equivalent to pressing F1, typing the command name, and pressing Enter.
 */
export interface CommandStep extends BaseStep {
  type: 'command';
  /** The command label as it appears in the command palette, e.g. "View: Toggle Panel" */
  command: string;
}

/**
 * Click a DOM element by CSS selector in the main VS Code window.
 */
export interface ClickStep extends BaseStep {
  type: 'click';
  /** CSS selector targeting the element to click */
  selector: string;
  /** If true, perform a double-click instead of a single click */
  double?: boolean;
  /**
   * Capture one frame showing the CSS :active (pressed) state before releasing
   * the mouse.  Intended for use after a `hover` step has already revealed and
   * positioned the pointer over the target button — the mouse is not moved
   * again, only mousedown → screenshot → mouseup is performed.
   * A captureFrame is automatically provided even when `capture: false` is set,
   * so the pressed-state frame is recorded without also recording a result frame.
   * Default: true
   */
  showPress?: boolean;
  /**
   * Bypass Playwright actionability checks (visible, stable, etc.) and dispatch
   * the click event directly to the element.
   *
   * Use this for hover-revealed inline action buttons in VS Code tree items:
   * these buttons are `display:none` by default and only become visible while
   * the parent row is CSS-hovered.  After hovering the row (which reveals the
   * button), a force click fires the event regardless of the computed style.
   *
   * Typically used together with `showPress: false` and `capture: false`:
   *   - type: hover
   *     selector: ".monaco-list-row[aria-label*='Session 1']"
   *     caption: "Hover row to reveal controls"
   *   - type: click
   *     selector: ".monaco-list-row[aria-label*='Session 1'] [aria-label='Start Session']"
   *     showPress: false
   *     force: true
   *     capture: false
   *
   * Default: false
   */
  force?: boolean;
}

/**
 * Click an element located by its ARIA role and accessible name.
 * More resilient to layout changes than CSS selectors.
 *
 * When `scope` is provided the search is limited to the subtree matched by
 * that CSS selector, which is essential for disambiguation when two UI areas
 * contain elements with the same role + name (e.g. the sidebar activity-bar
 * button and the bottom-panel tab both have aria-label "LogMagnifier").
 *
 *   - type: aria-click        # click the PANEL LogMagnifier tab, not the sidebar one
 *     role: tab
 *     name: LogMagnifier
 *     scope: ".panel"
 */
export interface AriaClickStep extends BaseStep {
  type: 'aria-click';
  /** ARIA role (e.g. "button", "treeitem", "tab") */
  role: string;
  /** Accessible name of the element (case-insensitive regex match) */
  name: string;
  /**
   * Optional CSS selector to limit the aria search to a subtree.
   * When omitted the entire page is searched (existing behaviour).
   */
  scope?: string;
}

/**
 * Click an element inside a VS Code Webview panel.
 * Uses Playwright's frameLocator to pierce the double-iframe boundary.
 */
export interface WebviewClickStep extends BaseStep {
  type: 'webview-click';
  /** CSS selector inside the inner webview iframe */
  selector: string;
  /**
   * Optional: additional inner iframe selector if the webview uses a nested iframe.
   * Defaults to 'iframe' (first iframe inside the webview).
   */
  innerFrame?: string;
  /**
   * Optional CSS selector to scope the outer iframe search to a specific container.
   * Use when multiple webviews are visible simultaneously (e.g. sidebar webview and
   * panel webview) and you need to target the one inside a particular area.
   *
   * Example — target the bookmark webview in the bottom panel:
   *   outerScope: ".part.panel"
   *
   * When omitted the first `iframe.webview.ready` in the page is used.
   */
  outerScope?: string;
}

/**
 * Scroll the content inside a VS Code Webview panel.
 * Uses frameLocator to reach the inner iframe document, then calls scrollBy().
 */
export interface WebviewScrollStep extends BaseStep {
  type: 'webview-scroll';
  /** Pixels to scroll vertically (positive = down, negative = up) */
  deltaY: number;
  /** Pixels to scroll horizontally (positive = right, negative = left, default: 0) */
  deltaX?: number;
  /**
   * Number of incremental steps to split the scroll into.
   * Each step captures a frame, producing a smooth scroll animation in the GIF.
   * Default: 1 (instant scroll, single frame)
   */
  steps?: number;
  /** Inner frame selector (default: 'iframe') */
  innerFrame?: string;
}

/**
 * Type text into the currently focused element.
 */
export interface TypeStep extends BaseStep {
  type: 'type';
  /** The text to type */
  text: string;
  /**
   * If set, capture a GIF frame every N characters while typing.
   * This makes the typing appear animated rather than appearing all at once.
   * Omit or set to 0 for the default behavior (single frame after completion).
   */
  captureEvery?: number;
}

/**
 * Press one or more keyboard keys.
 * Supports combinations like "Control+Shift+P", "Escape", "Enter", "F1".
 */
export interface KeyStep extends BaseStep {
  type: 'key';
  /** Key or key combination in Playwright format (e.g. "Control+Shift+P", "Enter") */
  key: string;
  /** Number of times to press the key (default: 1) */
  repeat?: number;
}

/**
 * Show a keyboard shortcut hint frame, press the key, then optionally wait for the UI.
 *
 * Replaces the three-step pattern:
 *   - type: screenshot  (hint caption + hold)
 *   - type: key         (capture: false)
 *   - type: delay       (settle)
 *
 * The hint frame is captured BEFORE the key is pressed, so the viewer sees the
 * shortcut annotation while the editor is still in its original state.
 * The `hold` duplicates that frame so it stays visible long enough to read.
 * After pressing, `settle` gives the UI time to react before the next step runs.
 */
export interface KeyHintStep {
  type: 'key-hint';
  /** Caption shown on the hint frame, e.g. "⌨  Cmd + P — Quick Open" */
  caption?: string;
  /** The Playwright key combo to press, e.g. "Meta+p", "Control+Meta+J" */
  key: string;
  /**
   * Milliseconds to hold the hint frame before pressing the key.
   * The frame is duplicated (hold / frameDelay) times. Default: 1200
   */
  hold?: number;
  /**
   * Milliseconds to wait after pressing the key for the UI to respond.
   * Use when the action opens a panel or dialog that takes time to appear.
   * Default: 0
   */
  settle?: number;
}

/**
 * Pause execution for a fixed duration. Does NOT capture a frame by default.
 *
 * Use this as an explicit step between actions to let the UI settle before
 * the next screenshot, making the timing intent visible in the YAML.
 *
 *   - type: webview-click
 *       selector: "button.play-btn"
 *       caption: "▶ Play"
 *   - type: delay
 *       ms: 1500          # wait for output to stream in
 *   - type: screenshot
 *       caption: "Output"
 *       hold: 2000
 */
export interface DelayStep {
  type: 'delay';
  /** Duration in milliseconds */
  ms: number;
}

/**
 * Capture a screenshot frame explicitly.
 * Use when you want a frame without any preceding interaction.
 */
export interface ScreenshotStep extends BaseStep {
  type: 'screenshot';
}

/**
 * Scroll inside a scrollable container.
 */
export interface ScrollStep extends BaseStep {
  type: 'scroll';
  /** CSS selector of the element to scroll within */
  selector: string;
  /** Pixels to scroll vertically (positive = down, negative = up) */
  deltaY: number;
  /** Pixels to scroll horizontally (positive = right, negative = left, default: 0) */
  deltaX?: number;
}

/**
 * Drag an element by a relative offset.
 *
 * Intended for resize handles (sashes) and other draggable UI controls.
 * The mouse is moved to the centre of the matched element, held down,
 * moved by (deltaX, deltaY) over `steps` intermediate positions, then
 * released.  Using multiple steps produces a smooth drag that VS Code's
 * split-view layout engine can track in real time.
 *
 * Typical use — expand a sidebar section by dragging its lower sash down:
 *   - type: drag
 *     selector: ".sidebar .monaco-sash.horizontal"
 *     deltaY: 100
 *     capture: false
 */
export interface DragStep extends BaseStep {
  type: 'drag';
  /** CSS selector of the element to drag (e.g. a resize sash) */
  selector: string;
  /** Pixels to drag horizontally (positive = right, default: 0) */
  deltaX?: number;
  /** Pixels to drag vertically (positive = down, default: 0) */
  deltaY?: number;
  /**
   * Number of intermediate mouse-move positions between start and end.
   * More steps produce a smoother drag. Default: 10
   */
  steps?: number;
}

/**
 * Hover over an element (useful for showing tooltips or hover states).
 */
export interface HoverStep extends BaseStep {
  type: 'hover';
  /** CSS selector of the element to hover */
  selector: string;
  /**
   * Skip Playwright's visibility / actionability checks and move the mouse
   * directly to the element.  Useful for hover-to-reveal patterns where the
   * target button only becomes visible after the mouse arrives (i.e. the
   * button is hidden until hover but will appear once the pointer is over it).
   * Default: true
   */
  force?: boolean;
}

/**
 * Collapse a VS Code sidebar section (pane) only if it is currently expanded.
 *
 * Reads the `aria-expanded` attribute on the matched element before clicking.
 * - If `aria-expanded="true"` → clicks to collapse.
 * - If `aria-expanded="false"` or attribute absent → skips the click (already collapsed).
 *
 * Use this instead of a plain `click` step when the initial expanded/collapsed
 * state of a section is unknown, to avoid accidentally expanding a section that
 * is already closed.
 */
export interface EnsureCollapsedStep extends BaseStep {
  type: 'ensure-collapsed';
  /** CSS selector targeting the collapsible section header (e.g. a `.pane-header`) */
  selector: string;
}

/**
 * Expand a VS Code sidebar section (pane) only if it is currently collapsed.
 *
 * Reads the `aria-expanded` attribute on the matched element before clicking.
 * - If `aria-expanded="false"` → clicks to expand.
 * - If `aria-expanded="true"` → skips the click (already expanded).
 */
export interface EnsureExpandedStep extends BaseStep {
  type: 'ensure-expanded';
  /** CSS selector targeting the collapsible section header (e.g. a `.pane-header`) */
  selector: string;
}

/**
 * Set the expand/collapse state for multiple VS Code sidebar sections in one step.
 *
 * Sections listed in `expanded` are ensured expanded; those in `collapsed` are ensured
 * collapsed. Sections not listed are left in their current state.
 *
 * Section names use the short form without the trailing " Section" suffix:
 *   expanded: [Quick Access, Word Filters]
 *   collapsed: [Workflows, Regex Filters, ADB Devices, Runbook]
 *
 * This replaces a sequence of individual `ensure-expanded` / `ensure-collapsed` steps,
 * making sidebar setup in the SETUP block concise and self-documenting.
 */
export interface SetupSidebarStep extends BaseStep {
  type: 'setup-sidebar';
  /** Section names to ensure are expanded (e.g. ["Quick Access", "Word Filters"]) */
  expanded?: string[];
  /** Section names to ensure are collapsed (e.g. ["Workflows", "Regex Filters"]) */
  collapsed?: string[];
}

/**
 * Debug step: dumps webview iframe structure and HTML to the console.
 * Useful for diagnosing webview-click selector issues.
 * Does NOT capture a frame — remove from spec once debugging is done.
 */
export interface DebugWebviewStep extends BaseStep {
  type: 'debug-webview';
  /**
   * CSS selector to scope the iframe search (e.g. ".part.panel").
   * When omitted, searches the entire page.
   */
  scope?: string;
}

/**
 * Debug step: dumps all visible .monaco-list-row aria-labels to the console.
 * Useful for discovering the correct aria-label selectors for tree view items.
 * Does NOT capture a frame — remove from spec once debugging is done.
 *
 * Example:
 *   - type: debug-tree
 *     scope: ".sidebar"
 */
export interface DebugTreeStep extends BaseStep {
  type: 'debug-tree';
  /**
   * CSS selector to scope the search (e.g. ".sidebar").
   * When omitted, searches the entire page.
   */
  scope?: string;
}

/**
 * Launch an app on the connected device via `adb shell monkey`.
 *
 * Sends a single launcher intent to the given package, ensuring the app is
 * running before the next step executes. Use this in the SETUP block to
 * guarantee a target app appears in the ADB Devices target-app picker.
 *
 * Example:
 *   - type: adb-launch-app
 *     package: com.android.settings
 *     wait: 2000
 *     capture: false
 */
export interface AdbLaunchAppStep {
  type: 'adb-launch-app';
  /** Package name of the app to launch (e.g. "com.android.settings") */
  package: string;
  /**
   * Milliseconds to wait after launching before the next step.
   * Give the app time to fully start so it appears in the target-app picker.
   * Default: 2000
   */
  wait?: number;
}

/**
 * Run an `adb shell` command on the connected device.
 *
 * Arguments are passed as an array to avoid shell injection — each element is
 * forwarded as a separate argument to `adb shell`.
 *
 * This step is always setup-only (no frame is captured).
 *
 * Example — navigate to the WiFi settings screen to generate logcat activity:
 *   - type: adb-shell
 *     args: ["am", "start", "-n", "com.android.settings/.wifi.WifiSettings"]
 *     wait: 1500
 */
export interface AdbShellStep {
  type: 'adb-shell';
  /** Arguments forwarded verbatim to `adb shell <args>`. */
  args: string[];
  /**
   * Milliseconds to wait after the command completes before the next step.
   * Default: 0
   */
  wait?: number;
}

/**
 * Ensure an Android emulator is running before the recording begins.
 *
 * Execution order:
 *   1. If an emulator with `avd` is already running → skip everything.
 *   2. If the AVD does not exist → create it with `avdmanager create avd`.
 *   3. Start the emulator in the background (`emulator -avd <name> …`).
 *   4. Poll `adb shell getprop sys.boot_completed` until the device is ready.
 *   5. Unlock the screen (`adb shell input keyevent 82`).
 *
 * This step is always setup-only (no frame is captured).
 *
 * Prerequisites (documented in the spec YAML header):
 *   - Android SDK installed and `adb` on PATH (or `adbPath` set in VS Code settings).
 *   - `avdmanager` available at ~/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager
 *   - `emulator` available at ~/Library/Android/sdk/emulator/emulator
 *   - System image installed for the given `package`.
 *
 * Example:
 *   - type: adb-ensure-emulator
 *     avd: LogMagnifier_Demo
 *     package: "system-images;android-35;google_apis_playstore;arm64-v8a"
 *     device: pixel_6
 *     capture: false
 */
export interface AdbEnsureEmulatorStep {
  type: 'adb-ensure-emulator';
  /** AVD name. If an emulator running this AVD is already attached, this step is a no-op. */
  avd: string;
  /**
   * SDK package identifier used to create the AVD when it does not already exist.
   * Format: "system-images;<api>;<tag>;<abi>"
   * Default: "system-images;android-35;google_apis_playstore;arm64-v8a"
   */
  package?: string;
  /**
   * Device definition to use when creating the AVD (avdmanager --device).
   * Default: "pixel_6"
   */
  device?: string;
  /**
   * SD card size when creating the AVD (avdmanager --sdcard).
   * Default: "512M"
   */
  sdcard?: string;
  /**
   * Maximum milliseconds to wait for the device to finish booting.
   * Default: 120000 (2 minutes)
   */
  bootTimeout?: number;
}

/** Metadata for a single captured frame (used by runner → composer pipeline) */
export interface FrameMeta {
  /** Absolute path to the captured PNG frame */
  path: string;
  /** Caption text to overlay on the frame */
  caption: string;
}
