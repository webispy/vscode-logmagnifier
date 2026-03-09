/**
 * Main runner: reads a YAML spec, launches VS Code via Playwright Electron API,
 * executes each step, captures frames, and hands off to the composer for GIF generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { _electron as electron, Page } from 'playwright';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { Spec, Step, FrameMeta } from './types';
import { composeGif } from './composer';

interface AppHandle {
  firstWindow(): Promise<Page>;
  resize(width: number, height: number): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('Usage: ts-node src/runner.ts <spec.yaml>');
    process.exit(1);
  }

  const spec = loadSpec(specPath);
  const outputName = spec.output ?? toKebabCase(spec.name);
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-frames-'));

  console.log(`▶ Recording "${spec.name}"`);
  console.log(`  Frames dir: ${framesDir}`);

  let app: AppHandle | undefined;
  try {
    app = await launchVSCode(spec);
    const page = await app.firstWindow();

    // Give VS Code time to fully initialize.
    // VS Code overwrites the window size during its startup sequence, so we
    // re-apply the target dimensions AFTER it has fully settled to guarantee
    // every captured screenshot is exactly spec.window pixels.
    await page.waitForLoadState('domcontentloaded');
    await delay(3000);
    await app.resize(spec.window.width, spec.window.height);
    await delay(300);

    const frames: FrameMeta[] = [];
    let frameIndex = 0;

    for (const step of spec.steps) {
      console.log(`  → [${step.type}]${'caption' in step && step.caption ? ' ' + step.caption : ''}`);

      // delay steps just pause — no capture, no further processing
      if (step.type === 'delay') {
        await delay(step.ms);
        continue;
      }

      const caption = step.caption ?? '';
      const shouldCapture = step.capture !== false;

      // Callback for intermediate frame captures (e.g. during typed text animation)
      const captureFrame = shouldCapture
        ? async (cap: string) => {
            const framePath = path.join(framesDir, `frame_${String(frameIndex).padStart(4, '0')}.png`);
            await page.screenshot({ path: framePath, type: 'png' });
            frames.push({ path: framePath, caption: cap });
            frameIndex++;
          }
        : undefined;

      await executeStep(page, step, captureFrame, spec.hoverBeforeClick ?? false);

      const stepDelay = step.delay ?? 0;
      if (stepDelay > 0) {
        await delay(stepDelay);
      }

      if (shouldCapture) {
        const framePath = path.join(framesDir, `frame_${String(frameIndex).padStart(4, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png' });
        frames.push({ path: framePath, caption });
        frameIndex++;

        // Duplicate the frame to hold it on screen longer in the GIF
        if (step.hold && step.hold > 0) {
          const holdFrames = Math.max(0, Math.round(step.hold / (spec.frameDelay ?? 80)) - 1);
          for (let i = 0; i < holdFrames; i++) {
            frames.push({ path: framePath, caption });
          }
        }
      }
    }

    console.log(`  ✓ Captured ${frames.length} frames`);

    // Duplicate the last frame to create a pause before the GIF loops
    if (spec.loopDelay && spec.loopDelay > 0 && frames.length > 0) {
      const extraFrames = Math.round(spec.loopDelay / (spec.frameDelay ?? 80));
      const lastFrame = frames[frames.length - 1];
      for (let i = 0; i < extraFrames; i++) {
        frames.push({ path: lastFrame.path, caption: lastFrame.caption });
      }
      console.log(`  + ${extraFrames} loop-pause frames (${spec.loopDelay}ms)`);
    }

    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const outputPath = path.join(repoRoot, 'resources', 'demo', `${outputName}.gif`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    await composeGif(frames, outputPath, {
      frameDelay: spec.frameDelay ?? 80,
      scale: spec.scale ?? 1.0,
    });

    console.log(`  ✓ GIF saved: ${outputPath}`);
  } finally {
    if (app) {
      await app.close();
    }
    // Clean up temp frames
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Spec loading
// ---------------------------------------------------------------------------

function loadSpec(specPath: string): Spec {
  const raw = fs.readFileSync(path.resolve(specPath), 'utf-8');
  return yaml.load(raw) as Spec;
}

// ---------------------------------------------------------------------------
// VS Code launch
// ---------------------------------------------------------------------------

async function launchVSCode(spec: Spec): Promise<AppHandle> {
  // Resolve paths relative to this script
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const extensionPath = repoRoot;
  const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
  const workspaceDir = path.join(fixturesDir, 'workspace');

  // Create an isolated user-data directory for a clean VS Code session
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-gif-'));

  // Pre-populate extension globalStorage with runbook fixtures so the tree
  // loads without manual setup.
  const storageDir = path.join(
    userDataDir,
    'User',
    'globalStorage',
    'webispy.logmagnifier',
    'runbooks'
  );
  const runbookFixtures = path.join(fixturesDir, 'runbook');
  if (fs.existsSync(runbookFixtures)) {
    copyRecursive(runbookFixtures, storageDir);
  }

  // Write minimal VS Code settings to reduce noise and suppress blocking prompts
  const settingsDir = path.join(userDataDir, 'User');
  fs.mkdirSync(settingsDir, { recursive: true });

  // Create an empty extensions directory to ensure system extensions aren't loaded
  const extDir = path.join(userDataDir, 'extensions');
  fs.mkdirSync(extDir, { recursive: true });

  // User-level settings (trust, telemetry, updates) that must apply globally.
  // UI/visual settings live in fixtures/workspace/.vscode/settings.json.
  const userSettingsSrc = path.join(fixturesDir, 'user-settings.json');
  fs.copyFileSync(userSettingsSrc, path.join(settingsDir, 'settings.json'));

  // Also write a trustedFolders entry in the globalStorage trust database
  // so VS Code's trust subsystem considers the workspace trusted from the start.
  writeTrustDatabase(userDataDir, workspaceDir);

  // Download (or reuse cached) a clean VS Code — same approach as `npm test`.
  // The binary is cached in ~/.vscode-test/ so subsequent runs are instant.
  console.log(`  Downloading / locating VS Code stable (cached in ~/.vscode-test/)…`);
  const vscodePath = await downloadAndUnzipVSCode('stable');
  console.log(`  VS Code: ${vscodePath}`);
  console.log(`  Extension: ${extensionPath}`);
  console.log(`  User data: ${userDataDir}`);

  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  console.log(`  Launching VS Code via Playwright Electron API…`);
  const electronApp = await electron.launch({
    executablePath: vscodePath,
    args: [
      `--extensionDevelopmentPath=${extensionPath}`,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=1',
      workspaceDir,
    ],
    env: { ...launchEnv, ELECTRON_ENABLE_LOGGING: '0' },
  });

  const page = await electronApp.firstWindow();

  // Resize the actual Electron BrowserWindow via main-process API.
  // This is the only reliable way to control the OS window size — using
  // setViewportSize alone leaves the Electron window at its default
  // dimensions, producing stale-pixel artifacts at the edges.
  const { width: winWidth, height: winHeight } = spec.window;
  await electronApp.evaluate(
    ({ BrowserWindow }, { w, h }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setContentSize(w, h);
    },
    { w: winWidth, h: winHeight }
  );
  await delay(500);

  // Dismiss blocking dialogs and clean up unwanted UI panels.
  // These run concurrently in the background so they don't block the caller.
  dismissTrustDialogIfPresent(page).catch(() => { /* non-fatal */ });
  dismissGitPopupIfPresent(page).catch(() => { /* non-fatal */ });

  // Idempotent cleanup — safe to call multiple times
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  return {
    firstWindow: async () => page,
    resize: async (w: number, h: number) => {
      await electronApp.evaluate(
        ({ BrowserWindow }, { w, h }) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (win) win.setContentSize(w, h);
        },
        { w, h }
      );
    },
    close: async () => {
      await electronApp.close();
      cleanup();
    }
  };
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

type CaptureFrame = (caption: string) => Promise<void>;

async function executeStep(
  page: Page,
  step: Step,
  captureFrame?: CaptureFrame,
  hoverBeforeClick = false
): Promise<void> {
  switch (step.type) {
    case 'command':
      await executeCommand(page, step.command);
      break;

    case 'click': {
      const el = page.locator(step.selector).first();
      if (step.double) {
        await el.dblclick({ position: { x: 10, y: 10 }, timeout: 5000 });
      } else if (hoverBeforeClick && captureFrame) {
        await clickWithInteraction(el, page, captureFrame, step.caption ?? '');
      } else {
        await el.click({ position: { x: 10, y: 10 }, timeout: 5000 });
      }
      break;
    }

    case 'aria-click': {
      const el = page.getByRole(
        step.role as Parameters<Page['getByRole']>[0],
        { name: new RegExp(step.name, 'i') }
      ).first();
      if (hoverBeforeClick && captureFrame) {
        await clickWithInteraction(el, page, captureFrame, step.caption ?? '');
      } else {
        await el.click({ position: { x: 10, y: 10 }, timeout: 5000 });
      }
      break;
    }

    case 'webview-click': {
      // VS Code webviews have a double-iframe structure:
      //   outer: iframe.webview.ready (the webview host iframe)
      //   inner: iframe (the actual extension webview content)
      const outerFrame = page.frameLocator('iframe.webview.ready');
      const innerFrame = outerFrame.frameLocator(step.innerFrame ?? 'iframe');
      const el = innerFrame.locator(step.selector).first();
      if (hoverBeforeClick && captureFrame) {
        await clickWithInteraction(el, page, captureFrame, step.caption ?? '');
      } else {
        await el.click({ timeout: 8000 });
      }
      break;
    }

    case 'webview-scroll': {
      const outerFrame = page.frameLocator('iframe.webview.ready');
      const innerFrame = outerFrame.frameLocator(step.innerFrame ?? 'iframe');
      const scrollSteps = Math.max(1, step.steps ?? 1);
      const stepY = step.deltaY / scrollSteps;
      const stepX = (step.deltaX ?? 0) / scrollSteps;

      for (let i = 0; i < scrollSteps; i++) {
        await innerFrame.locator('html').evaluate(
          (el, { dx, dy }) => el.scrollBy(dx, dy),
          { dx: stepX, dy: stepY }
        );
        // Capture intermediate frames to animate the scroll in the GIF,
        // except the last step (captured by the main loop)
        if (i < scrollSteps - 1 && captureFrame) {
          await delay(50);
          await captureFrame(step.caption ?? '');
        }
      }
      break;
    }

    case 'type': {
      const every = step.captureEvery;
      if (every && every > 0 && captureFrame) {
        // Type in chunks, capturing a frame after each chunk to animate typing in the GIF
        const text = step.text;
        for (let i = 0; i < text.length; i += every) {
          await page.keyboard.type(text.slice(i, i + every), { delay: 50 });
          // Capture after every chunk except the last (main loop handles the final frame)
          if (i + every < text.length) {
            await captureFrame(step.caption ?? '');
          }
        }
      } else {
        await page.keyboard.type(step.text, { delay: 50 });
      }
      break;
    }

    case 'key':
      for (let i = 0; i < (step.repeat ?? 1); i++) {
        await page.keyboard.press(step.key);
        if ((step.repeat ?? 1) > 1) { await delay(100); }
      }
      break;

    case 'wait':
      await delay(step.ms);
      break;

    case 'screenshot':
      // No-op here; the frame is captured after every step by the loop above.
      // This step type is just a marker to force a frame capture.
      break;

    case 'scroll': {
      const scrollEl = page.locator(step.selector).first();
      await scrollEl.evaluate(
        (el, { dx, dy }) => el.scrollBy(dx, dy),
        { dx: step.deltaX ?? 0, dy: step.deltaY }
      );
      break;
    }

    case 'hover':
      await page.locator(step.selector).first().hover({ timeout: 5000 });
      break;

    case 'ensure-collapsed': {
      // Click the element only if aria-expanded="true" (i.e. currently expanded).
      // Skips the click if the section is already collapsed, preventing accidental expansion.
      const header = page.locator(step.selector).first();
      await header.waitFor({ state: 'visible', timeout: 5000 });
      const expanded = await header.getAttribute('aria-expanded');
      if (expanded === 'true') {
        await header.click({ position: { x: 10, y: 10 }, timeout: 5000 });
      } else {
        console.log(`    (already collapsed — skipping click)`);
      }
      break;
    }

    case 'ensure-expanded': {
      const header = page.locator(step.selector).first();
      await header.waitFor({ state: 'visible', timeout: 5000 });
      const expanded = await header.getAttribute('aria-expanded');
      if (expanded !== 'true') {
        await header.click({ position: { x: 10, y: 10 }, timeout: 5000 });
      } else {
        console.log(`    (already expanded — skipping click)`);
      }
      break;
    }

    case 'delay':
      // Handled in the main loop before executeStep is called — should not reach here
      break;

    default: {
      const _exhaustive: never = step;
      console.warn(`  ⚠ Unknown step type: ${(_exhaustive as Step).type}`);
    }
  }
}

/**
 * Open VS Code command palette and execute a command by label.
 * Gracefully handles cases where the command palette is already open.
 */
async function executeCommand(page: Page, commandLabel: string): Promise<void> {
  // Open command palette
  await page.keyboard.press('F1');
  await delay(400);

  // Clear any pre-existing text and type the command
  const selectAllKey = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';
  await page.keyboard.press(selectAllKey);
  await page.keyboard.type(commandLabel, { delay: 40 });
  await delay(500);

  // Wait for the picker list to show the first item and press Enter
  await page.keyboard.press('ArrowDown');
  await delay(150);
  await page.keyboard.press('Enter');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Hover over an element, capture a hover frame, then simulate mousedown + mouseup
 * so the GIF shows: [hover state] → [pressed state] → [result].
 *
 * Using page.mouse.down/up after hover lets us capture the CSS :active state between
 * press and release, giving viewers a clear visual cue for each button interaction.
 */
async function clickWithInteraction(
  el: import('playwright').Locator,
  page: Page,
  captureFrame: CaptureFrame,
  caption: string
): Promise<void> {
  await el.hover({ timeout: 5000 });
  await delay(150);
  await captureFrame(caption);           // 1. hover state
  await delay(150);
  await page.mouse.down();
  await delay(80);
  await captureFrame(caption);           // 2. pressed (:active) state
  await delay(80);
  await page.mouse.up();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function copyRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Write VS Code's workspace trust database so the fixture workspace is
 * pre-trusted before launch.  VS Code stores trust state in:
 *   <userDataDir>/User/globalStorage/vscode.workspace-trust/trust.json
 *
 * Format (as of VS Code 1.94+):
 *   { "trustedFolders": { "<uri>": { "trustLevel": "Trusted" } } }
 */
function writeTrustDatabase(userDataDir: string, workspacePath: string): void {
  const trustDir = path.join(
    userDataDir,
    'User',
    'globalStorage',
    'vscode.workspace-trust'
  );
  fs.mkdirSync(trustDir, { recursive: true });

  // VS Code uses vscode-file:// URI scheme internally for local paths
  const workspaceUri = `vscode-file://vscode-app${workspacePath.replace(/\\/g, '/')}`;

  const trustDb = {
    trustedFolders: {
      [workspaceUri]: { trustLevel: 'Trusted' },
      // Also trust the raw file:// URI as a fallback
      [`file://${workspacePath.replace(/\\/g, '/')}`]: { trustLevel: 'Trusted' },
    },
  };

  fs.writeFileSync(
    path.join(trustDir, 'trust.json'),
    JSON.stringify(trustDb, null, 2)
  );
}

/**
 * Fallback: if the workspace trust dialog still appears despite the settings,
 * find the "Yes, I trust the authors" button and click it.
 *
 * Polls for up to 8 seconds, then gives up silently.
 */
async function dismissTrustDialogIfPresent(page: Page): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await delay(400);

    // The trust dialog contains a button whose text includes "Trust"
    // Try both possible button labels used across VS Code versions.
    const candidates = [
      page.getByRole('button', { name: /yes, i trust/i }),
      page.getByRole('button', { name: /trust/i }),
    ];

    for (const btn of candidates) {
      if (await btn.count() > 0) {
        console.log('  ⚠ Workspace trust dialog detected — clicking Trust…');
        await btn.first().click();
        return;
      }
    }
  }
}

/**
 * Dismiss the "A git repository was found in the parent folders" notification.
 * Clicks "Never" so it never reappears within this session.
 * Polls for up to 10 seconds (the notification can appear with a delay).
 */
async function dismissGitPopupIfPresent(page: Page): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await delay(500);

    // The notification contains a "Never" button to permanently suppress it
    const neverBtn = page.getByRole('button', { name: 'Never' });
    if (await neverBtn.count() > 0) {
      console.log('  ⚠ Git repository popup detected — clicking Never…');
      await neverBtn.first().click();
      return;
    }

    // Fallback: close button (×) on the notification toast
    const closeBtn = page.locator('.notifications-toasts .notification-toast-container .codicon-notifications-clear');
    if (await closeBtn.count() > 0) {
      await closeBtn.first().click();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
