/**
 * Scale diagnostic test.
 *
 * Part 1 — Composer isolation: creates a known-size PNG (1280×800),
 *          feeds it to compose() at several scales, reads resulting GIF dimensions.
 *
 * Part 2 — Screenshot probe: launches VS Code the same way runner.ts does,
 *          takes a raw screenshot, and reports its pixel dimensions.
 *
 * This separates "is the composer scaling correctly?" from
 * "are the raw screenshots the expected size?".
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import sharp from 'sharp';
import { compose } from './composer';
import { FrameMeta } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read GIF dimensions from the GIF89a / GIF87a header (bytes 6–9, little-endian). */
function readGifDimensions(gifPath: string): { width: number; height: number } {
  const buf = fs.readFileSync(gifPath);
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return { width, height };
}

/** Read PNG dimensions via sharp metadata. */
async function readPngDimensions(pngPath: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(pngPath).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

// ---------------------------------------------------------------------------
// Part 1 — Composer isolation test
// ---------------------------------------------------------------------------

async function testComposer() {
  console.log('═══════════════════════════════════════════════════');
  console.log('Part 1: Composer isolation test');
  console.log('═══════════════════════════════════════════════════');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-test-'));
  const srcPng = path.join(tmpDir, 'source.png');

  // Create a solid 1280×800 PNG
  await sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 40, g: 44, b: 52 } },
  }).png().toFile(srcPng);

  const srcDim = await readPngDimensions(srcPng);
  console.log(`  Source PNG: ${srcDim.width}×${srcDim.height}`);

  const scales = [0.5, 0.85, 1.0, 1.25];
  let allPass = true;

  for (const scale of scales) {
    const outGif = path.join(tmpDir, `test_${scale}.gif`);
    const frames: FrameMeta[] = [
      { path: srcPng, caption: 'test' },
      { path: srcPng, caption: 'test' },
    ];

    // compose() appends the extension, so strip it for the base path
    const outBase = outGif.replace(/\.gif$/, '');
    await compose(frames, outBase, { format: 'gif', frameDelay: 300, scale });

    const dim = readGifDimensions(outGif);
    const expectW = Math.round(1280 * scale);
    const expectH = Math.round(800 * scale);
    const pass = dim.width === expectW && dim.height === expectH;
    allPass = allPass && pass;

    console.log(
      `  scale=${scale.toFixed(2)} → ${dim.width}×${dim.height}` +
      ` (expected ${expectW}×${expectH}) ${pass ? '✓' : '✗ FAIL'}`
    );
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(allPass ? '\n  ✓ All composer tests passed\n' : '\n  ✗ Composer tests FAILED\n');
  return allPass;
}

// ---------------------------------------------------------------------------
// Part 2 — Screenshot probe (launches VS Code, captures raw screenshot)
// ---------------------------------------------------------------------------

async function testScreenshot() {
  console.log('═══════════════════════════════════════════════════');
  console.log('Part 2: Raw screenshot dimensions');
  console.log('═══════════════════════════════════════════════════');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { _electron: electron } = await import('playwright');
  const { downloadAndUnzipVSCode } = await import('@vscode/test-electron');

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
  const workspaceDir = path.join(fixturesDir, 'workspace');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-scale-test-'));
  const extDir = path.join(userDataDir, 'extensions');
  fs.mkdirSync(extDir, { recursive: true });

  // Minimal user settings
  const settingsDir = path.join(userDataDir, 'User');
  fs.mkdirSync(settingsDir, { recursive: true });
  const userSettingsSrc = path.join(fixturesDir, 'user-settings.json');
  if (fs.existsSync(userSettingsSrc)) {
    fs.copyFileSync(userSettingsSrc, path.join(settingsDir, 'settings.json'));
  }

  const vscodePath = await downloadAndUnzipVSCode('stable');

  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const TARGET_W = 1280;
  const TARGET_H = 800;

  console.log(`  Target content size: ${TARGET_W}×${TARGET_H}`);
  console.log(`  Launching VS Code…`);

  const electronApp = await electron.launch({
    executablePath: vscodePath,
    args: [
      `--extensionDevelopmentPath=${repoRoot}`,
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

  // ── Probe A: right after firstWindow ──
  const setContentSize = async (w: number, h: number) => {
    await electronApp.evaluate(
      ({ BrowserWindow }, { w, h }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.setContentSize(w, h);
      },
      { w, h }
    );
  };

  await setContentSize(TARGET_W, TARGET_H);
  await delay(500);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-test-'));
  const ssA = path.join(tmpDir, 'probe_A_early.png');
  await page.screenshot({ path: ssA, type: 'png' });
  const dimA = await readPngDimensions(ssA);
  console.log(`\n  Probe A (early, before VS Code init):`);
  console.log(`    Screenshot: ${dimA.width}×${dimA.height}`);

  // Read DPR and viewport from the page
  const infoA = await page.evaluate('({ dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight })') as { dpr: number; innerW: number; innerH: number };
  console.log(`    DPR=${infoA.dpr}  innerWidth=${infoA.innerW}  innerHeight=${infoA.innerH}`);

  // ── Wait for VS Code to fully initialize ──
  console.log(`\n  Waiting 4s for VS Code to initialize…`);
  await page.waitForLoadState('domcontentloaded');
  await delay(4000);

  // ── Probe B: after VS Code init, before resize ──
  const ssB = path.join(tmpDir, 'probe_B_post_init.png');
  await page.screenshot({ path: ssB, type: 'png' });
  const dimB = await readPngDimensions(ssB);
  console.log(`  Probe B (after VS Code init, before resize):`);
  console.log(`    Screenshot: ${dimB.width}×${dimB.height}`);

  const infoB = await page.evaluate('({ dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight })') as { dpr: number; innerW: number; innerH: number };
  console.log(`    DPR=${infoB.dpr}  innerWidth=${infoB.innerW}  innerHeight=${infoB.innerH}`);

  // ── Probe C: after setContentSize re-applied ──
  await setContentSize(TARGET_W, TARGET_H);
  await delay(500);

  const ssC = path.join(tmpDir, 'probe_C_post_resize.png');
  await page.screenshot({ path: ssC, type: 'png' });
  const dimC = await readPngDimensions(ssC);
  console.log(`\n  Probe C (after setContentSize re-applied):`);
  console.log(`    Screenshot: ${dimC.width}×${dimC.height}`);

  const infoC = await page.evaluate('({ dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight })') as { dpr: number; innerW: number; innerH: number };
  console.log(`    DPR=${infoC.dpr}  innerWidth=${infoC.innerW}  innerHeight=${infoC.innerH}`);

  // ── Probe D: with explicit Playwright viewport override ──
  await page.setViewportSize({ width: TARGET_W, height: TARGET_H });
  await delay(300);

  const ssD = path.join(tmpDir, 'probe_D_setViewportSize.png');
  await page.screenshot({ path: ssD, type: 'png' });
  const dimD = await readPngDimensions(ssD);
  console.log(`\n  Probe D (after page.setViewportSize):`);
  console.log(`    Screenshot: ${dimD.width}×${dimD.height}`);

  const infoD = await page.evaluate('({ dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight })') as { dpr: number; innerW: number; innerH: number };
  console.log(`    DPR=${infoD.dpr}  innerWidth=${infoD.innerW}  innerHeight=${infoD.innerH}`);

  // ── Summary ──
  console.log(`\n  ─── Summary ───`);
  console.log(`  Expected screenshot size: ${TARGET_W}×${TARGET_H}`);
  console.log(`  Probe A (early):          ${dimA.width}×${dimA.height} ${dimA.width === TARGET_W ? '✓' : '✗'}`);
  console.log(`  Probe B (post-init):      ${dimB.width}×${dimB.height} ${dimB.width === TARGET_W ? '✓' : '✗'}`);
  console.log(`  Probe C (re-setContent):  ${dimC.width}×${dimC.height} ${dimC.width === TARGET_W ? '✓' : '✗'}`);
  console.log(`  Probe D (setViewport):    ${dimD.width}×${dimD.height} ${dimD.width === TARGET_W ? '✓' : '✗'}`);

  await electronApp.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return dimC.width === TARGET_W;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const composerOk = await testComposer();
  const screenshotOk = await testScreenshot();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Final result');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Composer: ${composerOk ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Screenshot: ${screenshotOk ? '✓ PASS' : '✗ FAIL'}`);

  if (!composerOk || !screenshotOk) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
