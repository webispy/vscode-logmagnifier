/**
 * Composer: adds caption overlays to frames and assembles the final GIF.
 *
 * Strategy:
 *   1. For each frame, composite a semi-transparent caption bar at the bottom
 *      using `sharp` + SVG text overlay.
 *   2. Assemble the annotated PNG frames into an animated GIF using `gifski`
 *      (preferred, high quality) or `ffmpeg` as a fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import sharp from 'sharp';
import { FrameMeta } from './runner';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ComposeOptions {
  /** GIF frame delay in milliseconds (default: 80) */
  frameDelay?: number;
  /** Output scale factor 0.0–1.0 (default: 1.0) */
  scale?: number;
  /** Caption bar height in px (default: 36) */
  captionBarHeight?: number;
  /** Caption font size in px (default: 14) */
  captionFontSize?: number;
}

/**
 * Annotate each frame with its caption and assemble into an animated GIF.
 *
 * @param frames   Ordered list of { path, caption } objects
 * @param output   Absolute path for the output .gif file
 * @param options  Composer options
 */
export async function composeGif(
  frames: FrameMeta[],
  output: string,
  options: ComposeOptions = {}
): Promise<void> {
  const {
    frameDelay = 80,
    scale = 1.0,
    captionBarHeight = 36,
    captionFontSize = 14,
  } = options;

  const annotatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-annotated-'));

  try {
    console.log(`  Annotating ${frames.length} frames…`);
    const annotatedPaths: string[] = [];

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const outPath = path.join(annotatedDir, `frame_${String(i).padStart(4, '0')}.png`);

      await annotateFrame(frame, outPath, { captionBarHeight, captionFontSize, scale });
      annotatedPaths.push(outPath);
    }

    console.log(`  Assembling GIF…`);

    if (isAvailable('gifski')) {
      await assembleWithGifski(annotatedPaths, output, { frameDelay });
    } else if (isAvailable('ffmpeg')) {
      await assembleWithFfmpeg(annotatedDir, output, { frameDelay });
    } else {
      throw new Error(
        'Neither gifski nor ffmpeg found.\n' +
        'Install gifski: brew install gifski  (macOS) / cargo install gifski  (other)\n' +
        'Install ffmpeg: brew install ffmpeg  (macOS) / apt install ffmpeg    (Linux)'
      );
    }
  } finally {
    fs.rmSync(annotatedDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Frame annotation
// ---------------------------------------------------------------------------

interface AnnotateOptions {
  captionBarHeight: number;
  captionFontSize: number;
  scale: number;
}

async function annotateFrame(
  frame: FrameMeta,
  outPath: string,
  opts: AnnotateOptions
): Promise<void> {
  const { captionBarHeight, captionFontSize, scale } = opts;

  const img = sharp(frame.path);
  const meta = await img.metadata();
  const srcWidth = meta.width ?? 1280;
  const srcHeight = meta.height ?? 800;

  const targetWidth = Math.round(srcWidth * scale);
  const targetHeight = Math.round(srcHeight * scale);

  // Scale the source image first
  let pipeline = img.resize(targetWidth, targetHeight, { kernel: 'lanczos3' });

  if (frame.caption && frame.caption.trim()) {
    const barSvg = buildCaptionSvg(frame.caption.trim(), targetWidth, captionBarHeight, captionFontSize);
    const barPng = await sharp(Buffer.from(barSvg)).png().toBuffer();

    pipeline = pipeline.composite([
      { input: barPng, gravity: 'south', blend: 'over' },
    ]) as ReturnType<typeof sharp>;
  }

  await pipeline.png().toFile(outPath);
}

/**
 * Build an SVG caption bar with a semi-transparent dark background.
 */
function buildCaptionSvg(
  caption: string,
  width: number,
  height: number,
  fontSize: number
): string {
  const escaped = caption
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="rgba(0,0,0,0.72)" rx="0"/>
  <text
    x="${width / 2}"
    y="${height / 2 + fontSize * 0.35}"
    font-family="'SF Mono', 'Consolas', 'Menlo', monospace"
    font-size="${fontSize}px"
    font-weight="500"
    fill="#e8e8e8"
    text-anchor="middle"
    dominant-baseline="middle"
  >${escaped}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// GIF assembly — gifski (preferred, high quality)
// ---------------------------------------------------------------------------

interface AssembleOptions {
  frameDelay: number;
}

async function assembleWithGifski(
  frames: string[],
  output: string,
  opts: AssembleOptions
): Promise<void> {
  const fps = Math.round(1000 / opts.frameDelay);
  const args = ['--fps', String(fps), '--output', output, ...frames];

  console.log(`    $ gifski --fps ${fps} --output <output> [${frames.length} frames]`);
  await execFileAsync('gifski', args);
}

// ---------------------------------------------------------------------------
// GIF assembly — ffmpeg fallback (two-pass with palette for quality)
// ---------------------------------------------------------------------------

async function assembleWithFfmpeg(
  frameDir: string,
  output: string,
  opts: AssembleOptions
): Promise<void> {
  const fps = Math.round(1000 / opts.frameDelay);
  const inputPattern = path.join(frameDir, 'frame_%04d.png');
  const palettePath = path.join(os.tmpdir(), `palette-${Date.now()}.png`);

  try {
    // Pass 1: generate optimized palette
    const paletteArgs = [
      '-y',
      '-framerate', String(fps),
      '-i', inputPattern,
      '-vf', 'palettegen=stats_mode=diff',
      palettePath,
    ];
    console.log(`    $ ffmpeg [palette pass]`);
    await execFileAsync('ffmpeg', paletteArgs);

    // Pass 2: encode GIF using the palette
    const gifArgs = [
      '-y',
      '-framerate', String(fps),
      '-i', inputPattern,
      '-i', palettePath,
      '-lavfi', 'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      output,
    ];
    console.log(`    $ ffmpeg [gif encode pass]`);
    await execFileAsync('ffmpeg', gifArgs);
  } finally {
    fs.rmSync(palettePath, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAvailable(cmd: string): boolean {
  try {
    cp.execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function execFileAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    cp.execFile(cmd, args, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed:\n${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}
