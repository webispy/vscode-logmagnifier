/**
 * Composer: adds caption overlays to frames and assembles the final output.
 *
 * Supports two output formats:
 *   - **GIF**: assembled via `gifski` (preferred) or `ffmpeg` two-pass palette.
 *   - **MP4**: assembled via `ffmpeg` with H.264 (libx264) encoding.
 *
 * Strategy:
 *   1. For each frame, composite a semi-transparent caption bar at the bottom
 *      using `sharp` + SVG text overlay.
 *   2. Assemble the annotated PNG frames into the requested format(s).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as os from 'os';
import sharp from 'sharp';
import { FrameMeta } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type OutputFormat = 'gif' | 'mp4' | 'both';

export interface ComposeOptions {
  /** Output format: 'gif', 'mp4', or 'both' (default: 'gif') */
  format?: OutputFormat;
  /** Frame delay in milliseconds (default: 80) */
  frameDelay?: number;
  /** Output scale factor 0.0–1.0 (default: 1.0) */
  scale?: number;
  /** Caption bar height in px (default: 36) */
  captionBarHeight?: number;
  /** Caption font size in px (default: 14) */
  captionFontSize?: number;
}

export interface ComposeResult {
  /** Paths to the output files that were generated */
  outputs: string[];
}

/**
 * Annotate each frame with its caption and assemble into the requested
 * output format(s).
 *
 * @param frames   Ordered list of { path, caption } objects
 * @param output   Absolute path for the output file **without** extension.
 *                 The composer appends `.gif` / `.mp4` as needed.
 * @param options  Composer options
 * @returns Paths of the generated output files
 */
export async function compose(
  frames: FrameMeta[],
  output: string,
  options: ComposeOptions = {}
): Promise<ComposeResult> {
  const {
    format = 'gif',
    frameDelay = 80,
    scale = 1.0,
    captionBarHeight = 36,
    captionFontSize = 14,
  } = options;

  const annotatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-annotated-'));

  try {
    console.log(`  Annotating ${frames.length} frames…`);

    const BATCH_SIZE = 8;
    const annotatedPaths: string[] = new Array(frames.length);

    for (let start = 0; start < frames.length; start += BATCH_SIZE) {
      const batch = frames.slice(start, start + BATCH_SIZE);
      await Promise.all(batch.map((frame, j) => {
        const i = start + j;
        const outPath = path.join(annotatedDir, `frame_${String(i).padStart(4, '0')}.png`);
        annotatedPaths[i] = outPath;
        return annotateFrame(frame, outPath, { captionBarHeight, captionFontSize, scale });
      }));
    }

    // Read the actual dimensions of the first annotated frame so we can
    // pass them explicitly to assemblers (prevents silent Retina downscaling).
    const firstMeta = await sharp(annotatedPaths[0]).metadata();
    const outWidth = firstMeta.width ?? 0;
    const outHeight = firstMeta.height ?? 0;

    const outputs: string[] = [];

    if (format === 'gif' || format === 'both') {
      const gifPath = `${output}.gif`;
      console.log(`  Assembling GIF…`);
      await assembleGif(annotatedPaths, annotatedDir, gifPath, { frameDelay, width: outWidth, height: outHeight });
      console.log(`  ✓ GIF saved: ${gifPath}`);
      outputs.push(gifPath);
    }

    if (format === 'mp4' || format === 'both') {
      const mp4Path = `${output}.mp4`;
      console.log(`  Assembling MP4…`);
      await assembleMp4(annotatedDir, mp4Path, { frameDelay, width: outWidth, height: outHeight });
      console.log(`  ✓ MP4 saved: ${mp4Path}`);
      outputs.push(mp4Path);
    }

    return { outputs };
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
    ]);
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
// GIF assembly
// ---------------------------------------------------------------------------

interface AssembleOptions {
  frameDelay: number;
  width: number;
  height: number;
}

async function assembleGif(
  frames: string[],
  frameDir: string,
  output: string,
  opts: AssembleOptions
): Promise<void> {
  if (isAvailable('gifski')) {
    await assembleGifWithGifski(frames, output, opts);
  } else if (isAvailable('ffmpeg')) {
    await assembleGifWithFfmpeg(frameDir, output, opts);
  } else {
    throw new Error(
      'Neither gifski nor ffmpeg found.\n' +
      'Install gifski: brew install gifski  (macOS) / cargo install gifski  (other)\n' +
      'Install ffmpeg: brew install ffmpeg  (macOS) / apt install ffmpeg    (Linux)'
    );
  }
}

/** gifski — preferred, high quality */
async function assembleGifWithGifski(
  frames: string[],
  output: string,
  opts: AssembleOptions
): Promise<void> {
  const fps = Math.round(1000 / opts.frameDelay);
  const args = ['--fps', String(fps)];

  // Pass explicit dimensions so gifski never silently downscales
  // (on Retina displays gifski may halve the output otherwise).
  if (opts.width) args.push('--width', String(opts.width));
  if (opts.height) args.push('--height', String(opts.height));

  args.push('--output', output, ...frames);

  console.log(`    $ gifski --fps ${fps}${opts.width ? ` --width ${opts.width} --height ${opts.height}` : ''} --output <output> [${frames.length} frames]`);
  await execFileAsync('gifski', args);
}

/** ffmpeg fallback — two-pass with palette for quality */
async function assembleGifWithFfmpeg(
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
// MP4 assembly — ffmpeg H.264
// ---------------------------------------------------------------------------

async function assembleMp4(
  frameDir: string,
  output: string,
  opts: AssembleOptions
): Promise<void> {
  if (!isAvailable('ffmpeg')) {
    throw new Error(
      'ffmpeg is required for MP4 output.\n' +
      'Install ffmpeg: brew install ffmpeg  (macOS) / apt install ffmpeg  (Linux)'
    );
  }

  const fps = Math.round(1000 / opts.frameDelay);
  const inputPattern = path.join(frameDir, 'frame_%04d.png');

  // H.264 requires even dimensions — pad if needed
  const scaleFilter = `scale=trunc(iw/2)*2:trunc(ih/2)*2`;

  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', inputPattern,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '23',
    '-preset', 'slower',
    '-movflags', '+faststart',
    '-vf', scaleFilter,
    output,
  ];

  console.log(`    $ ffmpeg -framerate ${fps} -c:v libx264 -crf 23 -preset slower [${opts.width}×${opts.height}]`);
  await execFileAsync('ffmpeg', args);
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
