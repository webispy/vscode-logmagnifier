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
  /** VS Code window size */
  window: {
    width: number;
    height: number;
  };
  /** GIF playback frame delay in milliseconds (default: 80) */
  frameDelay?: number;
  /** GIF output scale factor 0.0–1.0 (default: 1.0) */
  scale?: number;
  /** Ordered list of steps to execute */
  steps: Step[];
}

/** Union of all step types */
export type Step =
  | CommandStep
  | ClickStep
  | AriaClickStep
  | WebviewClickStep
  | TypeStep
  | KeyStep
  | WaitStep
  | ScreenshotStep
  | ScrollStep
  | HoverStep
  | EnsureCollapsedStep
  | EnsureExpandedStep;

/** Common fields shared by all steps */
interface BaseStep {
  /** Optional human-readable label shown as a caption on the frame */
  caption?: string;
  /** Milliseconds to wait after performing this step before capturing (default: 300) */
  delay?: number;
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
 * Type text into the currently focused element.
 */
export interface TypeStep extends BaseStep {
  type: 'type';
  /** The text to type */
  text: string;
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
 * Wait for a fixed duration without interacting.
 * Useful for letting animations complete or processes finish.
 */
export interface WaitStep extends BaseStep {
  type: 'wait';
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
 * Hover over an element (useful for showing tooltips or hover states).
 */
export interface HoverStep extends BaseStep {
  type: 'hover';
  /** CSS selector of the element to hover */
  selector: string;
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

/** Metadata for a single captured frame (used by runner → composer pipeline) */
export interface FrameMeta {
  /** Absolute path to the captured PNG frame */
  path: string;
  /** Caption text to overlay on the frame */
  caption: string;
}
