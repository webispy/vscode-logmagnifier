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
  | DragStep;

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
}

/**
 * Click an element located by its ARIA role and accessible name.
 * More resilient to layout changes than CSS selectors.
 */
export interface AriaClickStep extends BaseStep {
  type: 'aria-click';
  /** ARIA role (e.g. "button", "treeitem", "tab") */
  role: string;
  /** Accessible name of the element (exact text match) */
  name: string;
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

/** Metadata for a single captured frame (used by runner → composer pipeline) */
export interface FrameMeta {
  /** Absolute path to the captured PNG frame */
  path: string;
  /** Caption text to overlay on the frame */
  caption: string;
}
