import sharp from 'sharp';
import type { Metadata, Sharp } from 'sharp';
import * as tf from '@tensorflow/tfjs';
import * as tfWasm from '@tensorflow/tfjs-backend-wasm';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/**
 * Super-resolution engine.
 *
 * Primary engine: ESRGAN (RRDB-style generator from the UpscalerJS model packages) run with
 * TensorFlow.js on the WebAssembly backend. The network hallucinates real high-frequency detail,
 * which plain resampling cannot do.
 *
 * Fallback engine ("lanczos"): Lanczos-3 resampling + unsharp mask. Used when the input is too
 * large for the CPU budget or when the model cannot be loaded, and reported to the client.
 */

export type UpscaleEngine = 'esrgan' | 'lanczos';

export interface UpscaleOptions {
  scale: number; // 2, 4, 8
  preset?: 'photo' | 'digital_art' | 'anime' | 'document' | 'custom';
  sharpness?: number; // 0 to 100
  denoise?: number; // 0 to 100
  format?: 'jpg' | 'png' | 'webp';
  quality?: number; // 70 to 100
}

export interface UpscaleResult {
  buffer: Buffer;
  dataUrl: string;
  mimeType: string;
  format: string;
  engine: UpscaleEngine;
  engineNote?: string;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  originalSize: number;
  upscaledSize: number;
  processingTimeMs: number;
}

const MAX_OUTPUT_DIMENSION = 12000;
const MAX_INPUT_PIXELS = 268402689; // sharp's own guard against decompression bombs

// Tile geometry (low-resolution pixels). Overlap ("PAD") gives every tile real context so
// seams are invisible after the centre crop is pasted into the output.
const TILE = 128;
const PAD = 8;

// CPU budget: beyond these input sizes the AI path would take minutes on a single core,
// so the request falls back to the fast engine and says so.
const AI_MAX_INPUT_PIXELS: Record<number, number> = {
  2: 2_000_000,
  4: 2_000_000,
  8: 250_000,
};

const modelRequire = createRequire(import.meta.url);
const MODEL_PACKAGE = '@upscalerjs/esrgan-slim';

function findPackageRoot(entry: string, packageName: string): string {
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === packageName) return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not locate package root for ${packageName}`);
}

let backendPromise: Promise<void> | null = null;
function ensureBackend(): Promise<void> {
  if (!backendPromise) {
    backendPromise = (async () => {
      const wasmPkg = modelRequire.resolve('@tensorflow/tfjs-backend-wasm/package.json');
      tfWasm.setWasmPaths(path.dirname(wasmPkg) + path.sep + 'dist' + path.sep);
      await tf.setBackend('wasm');
      await tf.ready();
    })().catch((err) => {
      backendPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return backendPromise;
}

const modelCache = new Map<number, Promise<tf.LayersModel>>();
function loadModel(scale: number): Promise<tf.LayersModel> {
  let cached = modelCache.get(scale);
  if (!cached) {
    cached = (async () => {
      await ensureBackend();
      const root = findPackageRoot(modelRequire.resolve(MODEL_PACKAGE), MODEL_PACKAGE);
      const dir = path.join(root, 'models', `x${scale}`);
      const topology = JSON.parse(await fs.promises.readFile(path.join(dir, 'model.json'), 'utf8'));

      const specs: any[] = [];
      const chunks: Buffer[] = [];
      for (const group of topology.weightsManifest) {
        for (const p of group.paths) chunks.push(await fs.promises.readFile(path.join(dir, p)));
        specs.push(...group.weights);
      }
      const merged = Buffer.concat(chunks);
      const weightData = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);

      return tf.loadLayersModel(
        tf.io.fromMemory({
          modelTopology: topology.modelTopology,
          weightSpecs: specs,
          weightData,
        })
      );
    })().catch((err) => {
      modelCache.delete(scale);
      throw err;
    });
    modelCache.set(scale, cached);
  }
  return cached;
}

// Serialise AI jobs: one CPU-bound job at a time keeps latency predictable and memory bounded.
let jobChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = jobChain.then(job, job);
  jobChain = next.catch(() => undefined);
  return next;
}

/**
 * Runs the network over overlapping tiles of an RGB image (raw 8-bit, 3 channels).
 * Returns an RGB buffer of size (w*scale) x (h*scale).
 */
async function superResolveRgb(
  model: tf.LayersModel,
  rgb: Buffer,
  w: number,
  h: number,
  scale: number
): Promise<Buffer> {
  const outW = w * scale;
  const outH = h * scale;
  const out = Buffer.alloc(outW * outH * 3);

  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      const th = Math.min(TILE, h - ty);
      const tw = Math.min(TILE, w - tx);

      // Input tile with PAD context on every side, edge-clamped at image borders.
      const ph = th + PAD * 2;
      const pw = tw + PAD * 2;
      const input = new Float32Array(ph * pw * 3);
      for (let y = 0; y < ph; y++) {
        const sy = Math.min(h - 1, Math.max(0, ty + y - PAD));
        for (let x = 0; x < pw; x++) {
          const sx = Math.min(w - 1, Math.max(0, tx + x - PAD));
          const src = (sy * w + sx) * 3;
          const dst = (y * pw + x) * 3;
          input[dst] = rgb[src];
          input[dst + 1] = rgb[src + 1];
          input[dst + 2] = rgb[src + 2];
        }
      }

      const inTensor = tf.tensor4d(input, [1, ph, pw, 3]);
      const pred = model.predict(inTensor) as tf.Tensor;
      const pShape = pred.shape;
      if (pShape[1] !== ph * scale || pShape[2] !== pw * scale) {
        inTensor.dispose();
        pred.dispose();
        throw new Error(`Model output ${pShape.join('x')} does not match scale ${scale}`);
      }
      const data = (await pred.data()) as Float32Array;
      inTensor.dispose();
      pred.dispose();

      // Paste only the centre of each tile (the part whose receptive field is complete).
      const srcW = pw * scale;
      const cropX = PAD * scale;
      const cropY = PAD * scale;
      const copyW = tw * scale;
      const copyH = th * scale;
      for (let y = 0; y < copyH; y++) {
        const srcRow = (cropY + y) * srcW + cropX;
        const dstRow = (ty * scale + y) * outW + tx * scale;
        for (let x = 0; x < copyW; x++) {
          const s = (srcRow + x) * 3;
          const d = (dstRow + x) * 3;
          out[d] = clampByte(data[s]);
          out[d + 1] = clampByte(data[s + 1]);
          out[d + 2] = clampByte(data[s + 2]);
        }
      }
    }
  }
  return out;
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

/** Mild unsharp mask; sharpness 0 disables it. */
function applySharpness(pipeline: Sharp, sharpness: number): Sharp {
  if (sharpness <= 0) return pipeline;
  const amount = sharpness / 100;
  return pipeline.sharpen({
    sigma: Number((0.5 + amount * 0.5).toFixed(2)),
    m1: 0.5,
    m2: Number((0.5 + amount * 1.5).toFixed(2)),
  });
}

function encode(pipeline: Sharp, format: string, quality: number): { pipeline: Sharp; mimeType: string } {
  if (format === 'jpg') {
    return {
      pipeline: pipeline.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }),
      mimeType: 'image/jpeg',
    };
  }
  if (format === 'webp') {
    return {
      pipeline: pipeline.webp({ quality, effort: 4, lossless: quality >= 98, smartSubsample: true }),
      mimeType: 'image/webp',
    };
  }
  return { pipeline: pipeline.png({ compressionLevel: 6 }), mimeType: 'image/png' };
}

/**
 * Upscales an image. Returns the encoded result plus metadata for the UI.
 */
export async function processImageUpscale(
  inputBuffer: Buffer,
  options: UpscaleOptions
): Promise<UpscaleResult> {
  const startTime = Date.now();
  const scale = [2, 4, 8].includes(Number(options.scale)) ? Number(options.scale) : 2;
  const targetFormat = options.format === 'jpg' || options.format === 'webp' ? options.format : 'png';
  const quality = Math.min(100, Math.max(70, Number(options.quality) || 95));
  const sharpness = clampRange(options.sharpness ?? 45, 0, 100);
  const denoise = clampRange(options.denoise ?? 20, 0, 100);

  // 1. Decode with EXIF orientation applied, and read the true (post-rotation) size.
  const oriented = sharp(inputBuffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  let originalMeta: Metadata;
  try {
    originalMeta = await sharp(inputBuffer, { failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw clientError('File is not a readable image');
  }
  if (!originalMeta.width || !originalMeta.height) {
    throw clientError('Invalid or unreadable image file');
  }
  // EXIF orientations 5–8 are rotated by 90°, so width and height swap.
  const swapped = !!originalMeta.orientation && originalMeta.orientation >= 5 && originalMeta.orientation <= 8;
  const originalWidth = swapped ? originalMeta.height : originalMeta.width;
  const originalHeight = swapped ? originalMeta.width : originalMeta.height;
  const targetWidth = originalWidth * scale;
  const targetHeight = originalHeight * scale;

  if (targetWidth > MAX_OUTPUT_DIMENSION || targetHeight > MAX_OUTPUT_DIMENSION) {
    throw clientError(
      `Resulting dimensions (${targetWidth}×${targetHeight}) exceed the maximum limit of ${MAX_OUTPUT_DIMENSION}px.`
    );
  }

  // 2. Optional denoise: a light blur before the network, which removes compression noise
  //    the model would otherwise reproduce as texture.
  let source = oriented;
  if (denoise > 0) {
    source = source.blur(Number((0.3 + (denoise / 100) * 0.7).toFixed(2)));
  }

  // 3. Decode raw RGBA so transparency is preserved.
  const { data: rgba, info } = await source.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const pixelCount = w * h;
  const rgb = Buffer.alloc(pixelCount * 3);
  const alpha = info.channels === 4 ? Buffer.alloc(pixelCount) : null;
  for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
    rgb[i * 3] = rgba[j];
    rgb[i * 3 + 1] = rgba[j + 1];
    rgb[i * 3 + 2] = rgba[j + 2];
    if (alpha) alpha[i] = rgba[j + 3];
  }
  const hasTransparency = alpha ? alpha.some((a) => a < 255) : false;

  // 4. Choose engine.
  let engine: UpscaleEngine = 'esrgan';
  let engineNote: string | undefined;
  let rgbOut: Buffer | null = null;
  const aiLimit = AI_MAX_INPUT_PIXELS[scale] ?? AI_MAX_INPUT_PIXELS[2];
  if (pixelCount > aiLimit) {
    engine = 'lanczos';
    engineNote = `Image is larger than ${Math.round(aiLimit / 1e5) / 10} MP for ${scale}x AI upscaling, so a fast resize was used.`;
  } else {
    try {
      const model = await loadModel(scale);
      rgbOut = await runExclusive(() => superResolveRgb(model, rgb, w, h, scale));
    } catch (err: any) {
      console.error('ESRGAN inference failed, falling back to Lanczos:', err?.message || err);
      engine = 'lanczos';
      engineNote = 'AI model unavailable, so a fast resize was used.';
    }
  }

  // 5. Build the output image.
  let pipeline: Sharp;
  if (engine === 'esrgan' && rgbOut) {
    pipeline = sharp(rgbOut, { raw: { width: targetWidth, height: targetHeight, channels: 3 } });
    if (alpha && hasTransparency) {
      // The network only sees RGB. Transparency is resampled classically and re-attached.
      const alphaPng = await sharp(alpha, { raw: { width: w, height: h, channels: 1 } })
        .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();
      pipeline = pipeline.joinChannel(alphaPng);
    }
  } else {
    pipeline = source.resize({
      width: targetWidth,
      height: targetHeight,
      kernel: sharp.kernel.lanczos3,
      fit: 'fill',
    });
  }

  pipeline = applySharpness(pipeline, sharpness);
  const encoded = encode(pipeline, targetFormat, quality);
  const outputBuffer = await encoded.pipeline.toBuffer();
  const processingTimeMs = Date.now() - startTime;
  const dataUrl = `data:${encoded.mimeType};base64,${outputBuffer.toString('base64')}`;

  return {
    buffer: outputBuffer,
    dataUrl,
    mimeType: encoded.mimeType,
    format: targetFormat,
    engine,
    engineNote,
    originalWidth,
    originalHeight,
    upscaledWidth: targetWidth,
    upscaledHeight: targetHeight,
    originalSize: inputBuffer.length,
    upscaledSize: outputBuffer.length,
    processingTimeMs,
  };
}

/** Error for bad user input; the HTTP layer maps `status` to a 4xx response. */
export function clientError(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function clampRange(v: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
