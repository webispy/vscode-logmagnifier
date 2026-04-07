/**
 * Main runner: reads a YAML spec, launches VS Code via Playwright Electron API,
 * executes each step, captures frames, and hands off to the composer for GIF generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { execFileSync, spawn } from 'child_process';
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

      // adb-ensure-emulator: setup-only step — no VS Code interaction, no frame capture
      if (step.type === 'adb-ensure-emulator') {
        await ensureAdbEmulator(step.avd, {
          package: step.package,
          device: step.device,
          sdcard: step.sdcard,
          bootTimeout: step.bootTimeout,
        });
        continue;
      }

      // adb-launch-app: launch an app's main launcher activity via `am start`
      if (step.type === 'adb-launch-app') {
        console.log(`  Launching app "${step.package}"…`);
        execFileSync('adb', [
          'shell', 'am', 'start',
          '-a', 'android.intent.action.MAIN',
          '-c', 'android.intent.category.LAUNCHER',
          '-p', step.package,
        ], { stdio: 'pipe' });
        const waitMs = step.wait ?? 2000;
        if (waitMs > 0) await delay(waitMs);
        console.log(`  ✓ "${step.package}" launched`);
        continue;
      }

      // adb-shell: run an adb shell command, then optionally wait
      if (step.type === 'adb-shell') {
        execFileSync('adb', ['shell', ...step.args], { stdio: 'pipe' });
        if (step.wait && step.wait > 0) {
          await delay(step.wait);
        }
        continue;
      }

      // key-hint: capture a hint frame first, hold it, press the key, then settle
      if (step.type === 'key-hint') {
        const hintCaption = step.caption ?? '';
        const hintPath = path.join(framesDir, `frame_${String(frameIndex).padStart(4, '0')}.png`);
        await page.screenshot({ path: hintPath, type: 'png' });
        frames.push({ path: hintPath, caption: hintCaption });
        frameIndex++;

        const holdMs = step.hold ?? 1200;
        const holdFrames = Math.max(0, Math.round(holdMs / (spec.frameDelay ?? 80)) - 1);
        for (let i = 0; i < holdFrames; i++) {
          frames.push({ path: hintPath, caption: hintCaption });
        }

        await page.keyboard.press(step.key);

        if (step.settle && step.settle > 0) {
          await delay(step.settle);
        }
        continue;
      }

      const caption = step.caption ?? '';
      const shouldCapture = step.capture !== false;

      // Provide a capture callback when:
      //   - the step's result frame should be recorded (shouldCapture), OR
      //   - the step has a caption but capture is suppressed (capture: false) — in this
      //     case hover + press interaction frames are still recorded via the callback so
      //     the viewer can see the button being targeted, even though no result frame
      //     follows.  Setup steps (no caption, capture: false) pass undefined and skip
      //     all frame capture.
      const makeCaptureFrame = () => async (cap: string) => {
        const framePath = path.join(framesDir, `frame_${String(frameIndex).padStart(4, '0')}.png`);
        await page.screenshot({ path: framePath, type: 'png' });
        frames.push({ path: framePath, caption: cap });
        frameIndex++;
      };

      const captureFrame = (shouldCapture || caption !== '')
        ? makeCaptureFrame()
        : undefined;

      // For showPress click steps with no caption and capture: false, still need a
      // captureFrame to record the :active state.
      const effectiveCaptureFrame =
        step.type === 'click' && step.showPress !== false && !captureFrame
          ? makeCaptureFrame()
          : captureFrame;

      await executeStep(page, step, effectiveCaptureFrame, spec.hoverBeforeClick ?? false);

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
  const specDir = path.dirname(path.resolve(specPath));
  const raw = fs.readFileSync(path.resolve(specPath), 'utf-8');
  const spec = yaml.load(raw) as Record<string, unknown> & { steps: unknown[] };

  // Merge shared defaults — spec values take precedence over defaults
  if (typeof spec.defaults === 'string') {
    const defaultsPath = path.resolve(specDir, spec.defaults);
    const defaults = yaml.load(fs.readFileSync(defaultsPath, 'utf-8')) as Record<string, unknown>;
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in spec)) {
        spec[key] = value;
      }
    }
    delete spec.defaults;
  }

  // Expand `type: include` steps inline before execution
  spec.steps = expandIncludes(spec.steps ?? [], specDir);

  return spec as unknown as Spec;
}

/**
 * Recursively expand `type: include` steps, replacing each with the step list
 * from the referenced YAML file. The resolved path is relative to `baseDir`.
 */
function expandIncludes(steps: unknown[], baseDir: string): Step[] {
  const result: Step[] = [];
  for (const step of steps) {
    const s = step as Record<string, unknown>;
    if (s.type === 'include') {
      if (typeof s.file !== 'string') {
        throw new Error(`include step missing required "file" field`);
      }
      const includePath = path.resolve(baseDir, s.file);
      const included = yaml.load(fs.readFileSync(includePath, 'utf-8')) as unknown[];
      result.push(...expandIncludes(included, path.dirname(includePath)));
    } else {
      result.push(s as unknown as Step);
    }
  }
  return result;
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
      } else if (step.showPress !== false && captureFrame) {
        // Mouse is already positioned over the element by a preceding hover step.
        // Capture the :active (pressed) CSS state, then release to fire the click.
        await page.mouse.down();
        await delay(80);
        await captureFrame(step.caption ?? '');
        await delay(80);
        await page.mouse.up();
      } else if (hoverBeforeClick && captureFrame) {
        await clickWithInteraction(el, page, captureFrame, step.caption ?? '');
      } else {
        // force: true bypasses visibility checks — needed for hover-revealed inline
        // action buttons in VS Code tree items (display:none until parent row hovered).
        await el.click({ position: { x: 10, y: 10 }, timeout: 5000, force: step.force ?? false });
      }
      break;
    }

    case 'aria-click': {
      // When `scope` is set, limit the search to that CSS subtree so
      // duplicate role+name elements in different UI areas don't collide
      // (e.g. sidebar vs bottom-panel tabs that share the same aria-label).
      const container = step.scope ? page.locator(step.scope) : page;
      const el = container.getByRole(
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
      // VS Code 1.101+ renders panel webviews via Service Worker.
      // SW frames appear in page.frames() with vscode-webview:// URLs.
      // Their child frames (active-frame) contain the actual extension HTML.
      //
      // Frame references go stale quickly — always re-query page.frames() fresh.
      // Click is dispatched via frame.evaluate(el.click()) to bypass Playwright's
      // pointer-event actionability checks ("html intercepts pointer events").

      // When outerScope is set, collect matching DOM iframe names to filter SW frames.
      // VS Code sets the DOM iframe's `name` to the same ID as the Playwright frame name.
      let allowedFrameNames: Set<string> | null = null;
      if (step.outerScope) {
        const domNames = await page.evaluate((scope: string) => {
          return Array.from(document.querySelectorAll(`${scope} iframe`))
            .map(f => (f as HTMLIFrameElement).name)
            .filter(Boolean);
        }, step.outerScope);
        if (domNames.length > 0) allowedFrameNames = new Set(domNames);
      }

      // Returns the child frame that contains the target element, or null.
      // Always called fresh to avoid stale frame references.
      const findFrame = async (): Promise<import('playwright').Frame | null> => {
        for (const swFrame of page.frames()) {
          if (!swFrame.url().startsWith('vscode-webview://') || !swFrame.url().includes('/index.html')) continue;
          if (allowedFrameNames && !allowedFrameNames.has(swFrame.name())) continue;
          for (const f of [swFrame, ...swFrame.childFrames()]) {
            const has = await f.evaluate(
              (sel: string) => !!document.querySelector(sel), step.selector
            ).catch(() => false);
            if (has) return f;
          }
        }
        return null;
      };

      // Hover + press frames: VS Code's SW webview overlay intercepts real pointer events,
      // so page.mouse.move() cannot trigger CSS :hover inside the child frame.
      // Instead, apply VS Code list theme variables directly via element.style to
      // replicate the hover/active appearance, then restore before dispatching the click.
      if (captureFrame) {
        const frame = await findFrame();
        if (frame) {
          // Apply hover styles
          await frame.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return;
            el.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
            const btn = el.querySelector('.remove-btn') as HTMLElement | null;
            if (btn) btn.style.visibility = 'visible';
          }, step.selector).catch(() => {});
          await delay(80);
          await captureFrame(step.caption ?? '');   // hover frame

          // Apply active/press styles (slightly stronger highlight)
          await frame.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) el.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground)';
          }, step.selector).catch(() => {});
          await delay(80);
          await captureFrame(step.caption ?? '');   // press frame

          // Restore styles before clicking
          await frame.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return;
            el.style.backgroundColor = '';
            const btn = el.querySelector('.remove-btn') as HTMLElement | null;
            if (btn) btn.style.visibility = '';
          }, step.selector).catch(() => {});
        }
      }

      // Re-find frame and click (frame may have refreshed during hover phase).
      // Retry up to 3 times to handle transient detachment.
      let clicked = false;
      for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
        if (attempt > 0) await delay(300);
        const frame = await findFrame();
        if (!frame) continue;
        clicked = await frame.evaluate(
          (sel: string) => { (document.querySelector(sel) as HTMLElement | null)?.click(); return true; },
          step.selector
        ).catch(() => false);
      }

      // Pass 2: DOM iframe fallback (sidebar webviews that still use DOM iframes)
      if (!clicked) {
        const outerSel = step.outerScope ? `${step.outerScope} iframe.webview.ready` : 'iframe.webview.ready';
        const innerFrame = page.frameLocator(outerSel).frameLocator(step.innerFrame ?? 'iframe');
        await innerFrame.locator(step.selector).first().click({ timeout: 8000 });
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

    case 'drag': {
      const dragEl = page.locator(step.selector).first();
      await dragEl.waitFor({ state: 'visible', timeout: 5000 });
      const box = await dragEl.boundingBox();
      if (!box) {
        console.warn(`    ⚠ drag: could not get bounding box for "${step.selector}"`);
        break;
      }
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await delay(50);
      await page.mouse.move(
        startX + (step.deltaX ?? 0),
        startY + (step.deltaY ?? 0),
        { steps: step.steps ?? 10 }
      );
      await delay(50);
      await page.mouse.up();
      break;
    }

    case 'hover': {
      const hoverEl = page.locator(step.selector).first();
      // Scroll into view first — after drag/resize ops the element may be
      // outside the visible viewport even though it exists in the DOM.
      await hoverEl.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await hoverEl.hover({ timeout: 5000, force: step.force !== false });
      break;
    }

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

    case 'setup-sidebar': {
      // Build an ordered list: expanded sections first, then collapsed sections.
      // Within each group, preserve the order listed in the spec.
      const entries: Array<{ name: string; expand: boolean }> = [
        ...(step.expanded ?? []).map(name => ({ name, expand: true })),
        ...(step.collapsed ?? []).map(name => ({ name, expand: false })),
      ];
      for (const { name, expand } of entries) {
        const selector = `role=button[name='${name} Section']`;
        const header = page.locator(selector).first();
        await header.waitFor({ state: 'visible', timeout: 5000 });
        const isExpanded = await header.getAttribute('aria-expanded');
        if (expand && isExpanded !== 'true') {
          await header.click({ position: { x: 10, y: 10 }, timeout: 5000 });
        } else if (!expand && isExpanded === 'true') {
          await header.click({ position: { x: 10, y: 10 }, timeout: 5000 });
        } else {
          console.log(`    (${name} Section: already ${expand ? 'expanded' : 'collapsed'} — skipping click)`);
        }
      }
      break;
    }

    case 'debug-webview': {
      const scopePrefix = step.scope ? `${step.scope} ` : '';

      // 1. List every iframe in the scope (class, src, title)
      const allIframes = await page.locator(`${scopePrefix}iframe`).all();
      console.log(`  [debug] iframes found in "${scopePrefix.trim() || 'page'}": ${allIframes.length}`);
      for (let i = 0; i < allIframes.length; i++) {
        const cls  = await allIframes[i].getAttribute('class') ?? '(none)';
        const src  = await allIframes[i].getAttribute('src')   ?? '(none)';
        const name = await allIframes[i].getAttribute('name')  ?? '(none)';
        console.log(`  [debug]   [${i}] class="${cls}"  src="${src}"  name="${name}"`);
      }

      // 2. List all Playwright frames (URL + name)
      const frames = page.frames();
      console.log(`  [debug] Playwright frames total: ${frames.length}`);
      for (const f of frames) {
        console.log(`  [debug]   frame url="${f.url()}"  name="${f.name()}"`);
      }

      // 3. Dump HTML from child frames of SW webview frames (actual extension content)
      // The SW frame (vscode-webview://…/index.html) hosts VS Code's webview shell;
      // the real extension HTML lives in its child frame (active-frame / fake.html).
      // When scope is set, filter to SW frames whose name matches DOM iframes in that scope.
      let debugAllowedNames: Set<string> | null = null;
      if (step.scope) {
        const names = await page.evaluate((scope: string) =>
          Array.from(document.querySelectorAll(`${scope} iframe`))
            .map(f => (f as HTMLIFrameElement).name).filter(Boolean)
        , step.scope);
        if (names.length > 0) debugAllowedNames = new Set(names);
      }
      const debugSwFrames = page.frames().filter(f => {
        if (!f.url().startsWith('vscode-webview://') || !f.url().includes('/index.html')) return false;
        return !debugAllowedNames || debugAllowedNames.has(f.name());
      });
      console.log(`  [debug] vscode-webview index.html frames: ${debugSwFrames.length}`);
      for (const swFrame of debugSwFrames) {
        const children = swFrame.childFrames();
        if (children.length === 0) {
          console.log(`  [debug] SW frame name="${swFrame.name()}" has no child frames`);
          continue;
        }
        for (let ci = 0; ci < children.length; ci++) {
          const child = children[ci];
          try {
            const html = await child.locator('body').innerHTML({ timeout: 3000 });
            console.log(`  [debug] SW child[${ci}] url="${child.url()}" HTML (${html.length} chars):\n${html}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`  [debug] SW child[${ci}] url="${child.url()}" HTML failed: ${msg}`);
          }
        }
      }
      break;
    }

    case 'debug-tree': {
      // Dump all visible .monaco-list-row aria-labels to the console so that
      // the correct selectors can be identified during development.
      const scopePrefix = step.scope ? `${step.scope} ` : '';
      const labels = await page.evaluate((sel: string) => {
        return Array.from(document.querySelectorAll(sel))
          .map((el, i) => `  [${i}] aria-label="${el.getAttribute('aria-label')}"  data-index="${el.getAttribute('data-index')}"`)
          .join('\n');
      }, `${scopePrefix}.monaco-list-row`);
      console.log(`  [debug-tree] monaco-list-rows in "${scopePrefix.trim() || 'page'}":\n${labels || '  (none found)'}`);
      break;
    }

    case 'add-text-filter-group': {
      const groupSel = `.monaco-list-row[aria-label*='${step.group}']`;

      // Hover an element, capture hover frame, then capture press (:active) frame and release.
      // Replicates the hover step + showPress click pattern from the YAML runner.
      const hoverAndClick = async (selector: string, hoverCaption: string) => {
        await page.locator(selector).first().hover({ force: true });
        if (captureFrame) await captureFrame(hoverCaption);
        await delay(200);
        await page.mouse.down();
        await delay(80);
        if (captureFrame) await captureFrame(hoverCaption);
        await delay(80);
        await page.mouse.up();
      };

      // Type text in chunks, capturing a frame after each chunk to animate typing.
      const typeAnimated = async (text: string, caption: string) => {
        const every = 5;
        for (let i = 0; i < text.length; i += every) {
          await page.keyboard.type(text.slice(i, i + every), { delay: 50 });
          if (i + every < text.length && captureFrame) {
            await captureFrame(caption);
          }
        }
      };

      // 1. Create the group
      await page.locator("[aria-label='Text Filters Section']").first().hover({ force: true });
      await delay(300);
      await hoverAndClick("[aria-label='Add Text Filter Group']", `Hover header → Add Text Filter Group`);
      await delay(600);
      await typeAnimated(step.group, `Naming the group`);
      await page.keyboard.press('Enter');
      await delay(800);
      if (captureFrame) await captureFrame(`Group '${step.group}' created`);

      // 2. Add each pattern
      for (const word of step.words) {
        const addWordSel = `${groupSel} [aria-label='Add Text Filter']`;
        await page.locator(groupSel).first().hover({ force: true });
        await delay(300);
        await hoverAndClick(addWordSel, `Hover group row → Add Text Filter`);
        await delay(500);
        await typeAnimated(word, `Add pattern: ${word}`);
        await page.keyboard.press('Enter');
        await delay(600);
        if (captureFrame) await captureFrame(`Add pattern: ${word}`);
      }

      // 3. Enable the group if requested
      if (step.enable) {
        const enableSel = `${groupSel} [aria-label='Enable']`;
        await page.locator(groupSel).first().hover({ force: true });
        await delay(300);
        await hoverAndClick(enableSel, `Enable group — highlights activate`);
        await delay(1200);
      }
      break;
    }

    case 'delay':
    case 'key-hint':
    case 'adb-ensure-emulator':
    case 'adb-launch-app':
    case 'adb-shell':
      // Handled in the main loop before executeStep is called — should not reach here
      break;

    default: {
      const _exhaustive: never = step;
      console.warn(`  ⚠ Unknown step type: ${(_exhaustive as Step).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// ADB emulator helpers
// ---------------------------------------------------------------------------

const SDK_ROOT = path.join(os.homedir(), 'Library', 'Android', 'sdk');
const AVD_MANAGER = path.join(SDK_ROOT, 'cmdline-tools', 'latest', 'bin', 'avdmanager');
const EMULATOR_BIN = path.join(SDK_ROOT, 'emulator', 'emulator');

/**
 * Ensure the named AVD exists and an emulator instance running it is attached.
 *
 * Steps:
 *  1. Check adb devices for an already-running emulator with this AVD name.
 *     If found, return immediately (no-op).
 *  2. Create the AVD with avdmanager if it does not yet exist.
 *  3. Launch the emulator in the background.
 *  4. Poll sys.boot_completed until the device is ready.
 *  5. Unlock the screen.
 */
async function ensureAdbEmulator(
  avd: string,
  opts: {
    package?: string;
    device?: string;
    sdcard?: string;
    bootTimeout?: number;
  } = {}
): Promise<void> {
  const pkg         = opts.package     ?? 'system-images;android-35;google_apis_playstore;arm64-v8a';
  const device      = opts.device      ?? 'pixel_6';
  const sdcard      = opts.sdcard      ?? '512M';
  const bootTimeout = opts.bootTimeout ?? 120_000;

  // 1. Check if an emulator running this AVD is already attached
  const runningSerial = findRunningEmulator(avd);
  if (runningSerial) {
    console.log(`  ✓ Emulator already running (${runningSerial}) — skipping launch`);
    return;
  }

  // 2. Create the AVD if it does not exist
  if (!avdExists(avd)) {
    console.log(`  Creating AVD "${avd}"…`);
    execFileSync(AVD_MANAGER, [
      'create', 'avd',
      '--name', avd,
      '--package', pkg,
      '--device', device,
      '--sdcard', sdcard,
      '--force',
    ], { stdio: 'pipe' });
    console.log(`  ✓ AVD "${avd}" created`);
  } else {
    console.log(`  ✓ AVD "${avd}" already exists`);
  }

  // 3. Launch the emulator in the background
  console.log(`  Launching emulator "${avd}"…`);
  const child = spawn(EMULATOR_BIN, ['-avd', avd, '-no-snapshot', '-gpu', 'host'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // 4. Poll for boot completion
  console.log(`  Waiting for device to boot (timeout: ${bootTimeout}ms)…`);
  const deadline = Date.now() + bootTimeout;
  let booted = false;
  while (Date.now() < deadline) {
    await delay(2000);
    try {
      const out = execFileSync('adb', ['wait-for-device', 'shell', 'getprop', 'sys.boot_completed'], {
        timeout: 5000,
        stdio: 'pipe',
      }).toString().trim();
      if (out === '1') {
        booted = true;
        break;
      }
    } catch {
      // Device not ready yet — keep polling
    }
  }
  if (!booted) {
    throw new Error(`Emulator "${avd}" did not finish booting within ${bootTimeout}ms`);
  }
  console.log(`  ✓ Device booted`);

  // 5. Unlock the screen (wake + dismiss keyguard)
  await delay(1000);
  execFileSync('adb', ['shell', 'input', 'keyevent', '82'], { stdio: 'pipe' }); // MENU — wakes screen
  await delay(500);
  try {
    execFileSync('adb', ['shell', 'wm', 'dismiss-keyguard'], { stdio: 'pipe' });
  } catch {
    // dismiss-keyguard may not be available on all API levels — ignore
  }
  console.log(`  ✓ Screen unlocked`);
}

/**
 * Return the adb serial of the first emulator running the given AVD, or null.
 * Queries each emulator-* device via `adb -s <serial> emu avd name`.
 */
function findRunningEmulator(avd: string): string | null {
  let devicesOut: string;
  try {
    devicesOut = execFileSync('adb', ['devices'], { stdio: 'pipe', timeout: 5000 }).toString();
  } catch {
    return null;
  }

  const serials = devicesOut
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('emulator-') && l.includes('device'))
    .map(l => l.split(/\s+/)[0]);

  for (const serial of serials) {
    try {
      const name = execFileSync('adb', ['-s', serial, 'emu', 'avd', 'name'], {
        stdio: 'pipe',
        timeout: 3000,
      }).toString().split('\n')[0].trim();
      if (name === avd) return serial;
    } catch {
      // emulator may not respond to emu commands yet — skip
    }
  }
  return null;
}

/**
 * Return true if an AVD with the given name exists in ~/.android/avd/.
 */
function avdExists(avd: string): boolean {
  const iniPath = path.join(os.homedir(), '.android', 'avd', `${avd}.ini`);
  return fs.existsSync(iniPath);
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
