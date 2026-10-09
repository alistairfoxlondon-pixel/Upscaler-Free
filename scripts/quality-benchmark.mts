/**
 * OpenUpscale quality benchmark.
 *
 * Generates a deterministic 50-image corpus (photos, portraits, documents,
 * line art, textures; JPEG/PNG/WebP/GIF/TIFF; EXIF rotations; alpha; 16-bit)
 * into qa/corpus, runs the real server pipeline (server/upscaler.ts) over a
 * matrix of scales/presets/formats, and computes objective quality metrics:
 *
 *   - round-trip PSNR/SSIM  (downscale output back to source size, compare)
 *   - deviation PSNR/SSIM   (output vs a pure Lanczos-3 reference resize)
 *   - Laplacian sharpness   (perceived-acuity proxy, vs reference)
 *   - color shift           (mean |channel delta| on the round trip)
 *   - clipping              (share of saturated pixels introduced)
 *   - output size + latency
 *
 * Usage:  npm run bench          (writes qa/report.json, prints a summary)
 *         npm run bench -- --quick   (smaller matrix, same corpus)
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { processImageUpscale, type UpscaleOptions } from '../server/upscaler.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(ROOT, 'qa', 'corpus');
const REPORT_PATH = path.join(ROOT, 'qa', 'report.json');

const QUICK = process.argv.includes('--quick');

/* ------------------------------------------------------------------ */
/* Deterministic PRNG so the corpus is reproducible                     */
/* ------------------------------------------------------------------ */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261009);
const ri = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(arr: T[]): T => arr[ri(0, arr.length - 1)];

/* ------------------------------------------------------------------ */
/* Corpus generation: 50 images across 5 categories                     */
/* ------------------------------------------------------------------ */
interface CorpusItem {
  file: string;
  category: string;
  width: number;
  height: number;
  note: string;
}

async function drawPhoto(w: number, h: number): Promise<Sharp> {
  // Sky gradient + sun + hills + grain (simulates a downscaled camera photo)
  const stops = Array.from({ length: 8 }, (_, i) => {
    const t = i / 7;
    return `<stop offset="${t.toFixed(2)}" stop-color="rgb(${ri(40, 90)},${ri(90, 160)},${ri(160, 240)})"/>`;
  }).join('');
  const svg = `<svg width="${w * 2}" height="${h * 2}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#sky)"/>
    <circle cx="${ri(w * 0.4, w * 1.6)}" cy="${ri(h * 0.2, h * 0.9)}" r="${ri(h * 0.15, h * 0.35)}" fill="rgb(255,${ri(200, 240)},${ri(150, 200)})" opacity="0.9"/>
    <path d="M0 ${h * 1.5} Q ${w} ${h * 0.9} ${w * 2} ${h * 1.4} L ${w * 2} ${h * 2} L 0 ${h * 2} Z" fill="rgb(${ri(20, 60)},${ri(60, 110)},${ri(30, 70)})"/>
    <path d="M0 ${h * 1.75} Q ${w * 1.1} ${h * 1.35} ${w * 2} ${h * 1.7} L ${w * 2} ${h * 2} L 0 ${h * 2} Z" fill="rgb(${ri(10, 40)},${ri(40, 80)},${ri(15, 50)})"/>
  </svg>`;
  // sensor noise composited at the 2x canvas (sharp applies composite after
  // resize, so bake it into a 2x buffer and hand back a pipeline over that)
  const noise = await sharp({ create: { width: w * 2, height: h * 2, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: ri(6, 14) } } })
    .modulate({ brightness: 0 })
    .png()
    .toBuffer();
  const big = await sharp(Buffer.from(svg))
    .resize(w * 2, h * 2)
    .flatten({ background: '#7aa2e0' })
    .composite([{ input: noise, blend: 'add' }])
    .png()
    .toBuffer();
  return sharp(big);
}

async function drawPortrait(w: number, h: number): Promise<Sharp> {
  const skin = `rgb(${ri(180, 230)},${ri(140, 190)},${ri(110, 160)})`;
  const svg = `<svg width="${w * 2}" height="${h * 2}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="rgb(${ri(60, 90)},${ri(80, 120)},${ri(120, 160)})"/>
    <ellipse cx="${w}" cy="${h * 1.15}" rx="${w * 0.75}" ry="${h * 0.62}" fill="rgb(40,50,70)"/>
    <ellipse cx="${w}" cy="${h * 0.95}" rx="${w * 0.42}" ry="${h * 0.55}" fill="${skin}"/>
    <ellipse cx="${w * 0.82}" cy="${h * 0.85}" rx="${w * 0.09}" ry="${h * 0.05}" fill="#fff"/>
    <ellipse cx="${w * 1.18}" cy="${h * 0.85}" rx="${w * 0.09}" ry="${h * 0.05}" fill="#fff"/>
    <circle cx="${w * 0.82}" cy="${h * 0.86}" r="${h * 0.022}" fill="rgb(30,40,60)"/>
    <circle cx="${w * 1.18}" cy="${h * 0.86}" r="${h * 0.022}" fill="rgb(30,40,60)"/>
    <path d="M ${w * 0.88} ${h * 1.12} Q ${w} ${h * 1.2} ${w * 1.12} ${h * 1.12}" stroke="rgb(120,60,50)" stroke-width="${h * 0.02}" fill="none"/>
    <path d="M ${w * 0.55} ${h * 0.62} Q ${w * 0.75} ${h * 0.45} ${w * 0.8} ${h * 0.6} L ${w * 0.6} ${h * 0.35} Z" fill="rgb(50,35,25)"/>
    <path d="M ${w * 1.45} ${h * 0.62} Q ${w * 1.25} ${h * 0.45} ${w * 1.2} ${h * 0.6} L ${w * 1.4} ${h * 0.35} Z" fill="rgb(50,35,25)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(w * 2, h * 2).blur(Math.max(0.3, rand() * 0.8 + 0.2));
}

async function drawDocument(w: number, h: number): Promise<Sharp> {
  const lines: string[] = [];
  let y = h * 0.12;
  while (y < h * 0.92) {
    const widths = [0.9, 0.75, 0.85, 0.6, 0.8];
    const lw = w * pick(widths) * 2;
    lines.push(`<rect x="${w * 0.2}" y="${y}" width="${lw}" height="${Math.max(2, h * 0.018)}" fill="#1a1a1a"/>`);
    if (rand() < 0.3) {
      lines.push(`<rect x="${w * 0.2}" y="${y + h * 0.05}" width="${w * 0.5}" height="${Math.max(2, h * 0.014)}" fill="#555"/>`);
      y += h * 0.085;
    }
    y += h * 0.055;
  }
  const svg = `<svg width="${w * 2}" height="${h * 2}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#fdfdf8"/>${lines.join('')}</svg>`;
  return sharp(Buffer.from(svg)).resize(w * 2, h * 2);
}

async function drawLineArt(w: number, h: number): Promise<Sharp> {
  const colors = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#f72585'];
  const shapes: string[] = [];
  for (let i = 0; i < ri(4, 8); i++) {
    const c = pick(colors);
    if (rand() < 0.5) {
      shapes.push(`<circle cx="${ri(0, w * 2)}" cy="${ri(0, h * 2)}" r="${ri(h * 0.1, h * 0.5)}" fill="${c}" stroke="#111" stroke-width="${ri(2, 6)}"/>`);
    } else {
      shapes.push(`<rect x="${ri(0, w)}" y="${ri(0, h)}" width="${ri(w * 0.3, w * 1.4)}" height="${ri(h * 0.3, h * 1.2)}" fill="${c}" stroke="#111" stroke-width="${ri(2, 6)}"/>`);
    }
  }
  const svg = `<svg width="${w * 2}" height="${h * 2}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${pick(['#fff8ee', '#eef6ff', '#f6ffee'])}"/>${shapes.join('')}</svg>`;
  return sharp(Buffer.from(svg)).resize(w * 2, h * 2);
}

async function drawTexture(w: number, h: number): Promise<Sharp> {
  // High-frequency foliage-like noise, heavily JPEG-compressed (denoise test)
  return sharp({
    create: { width: w * 2, height: h * 2, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: ri(35, 60) } },
  })
    .modulate({ hue: ri(0, 360), saturation: 1.2 })
    .blur(0.6);
}

async function generateCorpus(): Promise<CorpusItem[]> {
  rmSync(CORPUS_DIR, { recursive: true, force: true });
  mkdirSync(CORPUS_DIR, { recursive: true });
  const items: CorpusItem[] = [];
  const aspects = [[4, 3], [3, 2], [1, 1], [16, 9]];
  const categories: Array<[string, (w: number, h: number) => Promise<Sharp>, string]> = [
    ['photo', drawPhoto, 'natural photo (gradient, grain, JPEG)'],
    ['portrait', drawPortrait, 'portrait (skin tones, soft edges)'],
    ['document', drawDocument, 'document (sharp text-like bars)'],
    ['lineart', drawLineArt, 'line art (flat fills, hard edges)'],
    ['texture', drawTexture, 'noisy texture (denoise stress)'],
  ];

  let index = 0;
  for (const [category, draw, note] of categories) {
    for (let i = 0; i < 10; i++) {
      index += 1;
      const [aw, ah] = pick(aspects);
      const w = ri(120, 240) * (aw / 3);
      const h = ri(90, 180) * (ah / 3);
      const W = Math.round(w), H = Math.round(h);
      let pipeline = await draw(W, H);
      let format: 'jpeg' | 'png' | 'webp' = pick(['jpeg', 'jpeg', 'png', 'webp']);
      let file = `${String(index).padStart(2, '0')}_${category}.${format === 'jpeg' ? 'jpg' : format}`;
      let note2 = note;

      if (category === 'photo' && i === 0) {
        // EXIF orientation 6: pixels stored unrotated, tag says rotate 90 CW.
        // The server must auto-orient and swap output dimensions.
        pipeline = pipeline.resize(W, H).jpeg({ quality: 85 });
        const buf = await pipeline.withMetadata({ orientation: 6 }).toBuffer();
        writeFileSync(path.join(CORPUS_DIR, file), buf);
        items.push({ file, category, width: H, height: W, note: `${note}; EXIF orientation 6` });
        continue;
      }
      if (category === 'portrait' && i === 1) {
        // EXIF orientation 8 (rotate 90 CCW)
        pipeline = pipeline.resize(W, H).jpeg({ quality: 85 });
        const buf = await pipeline.withMetadata({ orientation: 8 }).toBuffer();
        writeFileSync(path.join(CORPUS_DIR, file), buf);
        items.push({ file, category, width: H, height: W, note: `${note}; EXIF orientation 8` });
        continue;
      }
      if (category === 'document' && i === 2) {
        // 16-bit PNG document
        const buf = await pipeline.resize(W, H).png({ palette: false }).toBuffer();
        const png16 = await sharp(buf).toColourspace('rgb16').png().toBuffer();
        const file16 = `${String(index).padStart(2, '0')}_document_16bit.png`;
        writeFileSync(path.join(CORPUS_DIR, file16), png16);
        items.push({ file: file16, category, width: W, height: H, note: `${note}; 16-bit PNG` });
        continue;
      }
      if (category === 'lineart' && i === 3) {
        // alpha PNG line art: punch a transparent hole at the 2x canvas,
        // baked into a buffer (composite runs after resize in sharp)
        const base2x = await pipeline.png().toBuffer();
        const hole = await sharp({
          create: { width: W * 2, height: H * 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
        })
          .composite([{
            input: Buffer.from(
              `<svg width="${W * 2}" height="${H * 2}" xmlns="http://www.w3.org/2000/svg"><circle cx="${W}" cy="${H}" r="${Math.min(W, H) * 0.5}" fill="black"/></svg>`
            ),
            blend: 'dest-in',
          }])
          .png()
          .toBuffer();
        const withHole = await sharp(base2x).ensureAlpha(1).composite([{ input: hole, blend: 'dest-out' }]).png().toBuffer();
        pipeline = sharp(withHole);
        format = 'png';
        file = `${String(index).padStart(2, '0')}_${category}_alpha.png`;
        note2 = `${note}; alpha channel`;
      }
      if (category === 'texture' && i === 4) {
        format = 'jpeg';
        file = `${String(index).padStart(2, '0')}_${category}_q60.jpg`;
        note2 = `${note}; heavy JPEG q60`;
      }
      if (category === 'photo' && i === 5) {
        // TIFF photo
        const buf = await pipeline.resize(W * 2, H * 2).tiff().toBuffer();
        const small = await sharp(buf).resize(W, H).tiff().toBuffer();
        writeFileSync(path.join(CORPUS_DIR, `${String(index).padStart(2, '0')}_photo.tiff`), small);
        items.push({ file: `${String(index).padStart(2, '0')}_photo.tiff`, category, width: W, height: H, note: `${note}; TIFF input` });
        continue;
      }
      if (category === 'texture' && i === 5) {
        // GIF input (sharp reads the first frame of animated GIFs)
        const frame = await pipeline.resize(W * 2, H * 2).png().toBuffer();
        const gif = await sharp(frame).gif().toBuffer();
        const small = await sharp(gif).resize(W, H).gif().toBuffer();
        writeFileSync(path.join(CORPUS_DIR, `${String(index).padStart(2, '0')}_texture.gif`), small);
        items.push({ file: `${String(index).padStart(2, '0')}_texture.gif`, category, width: W, height: H, note: `${note}; GIF input` });
        continue;
      }

      let buf: Buffer;
      if (format === 'jpeg') {
        const q = pick([60, 70, 80, 85, 92]);
        buf = await pipeline.resize(W, H).jpeg({ quality: q, chromaSubsampling: '4:2:0' }).toBuffer();
        note2 = `${note}; JPEG q${q}`;
      } else if (format === 'webp') {
        buf = await pipeline.resize(W, H).webp({ quality: pick([75, 85, 95]) }).toBuffer();
      } else {
        buf = await pipeline.resize(W, H).png().toBuffer();
      }
      writeFileSync(path.join(CORPUS_DIR, file), buf);
      items.push({ file, category, width: W, height: H, note: note2 });
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */
// NOTE: normalization (auto-orient + flatten) is applied inline in each metric
// pipeline. Never re-encode through .toBuffer() first — that would re-compress
// lossy outputs a second time and corrupt the measurements.
interface GrayImage { data: Uint8Array; width: number; height: number }

async function rawGray(buf: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(buf).rotate().flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  if ((info as { depth?: string }).depth === 'ushort') {
    // 16-bit raw: two bytes per pixel, big-endian. Scale down to 8-bit.
    const out = new Uint8Array(info.width * info.height);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 2];
    return { data: out, width: info.width, height: info.height };
  }
  return { data, width: info.width, height: info.height };
}

/** True when the image has an alpha channel that is fully opaque (dropping it is lossless). */
async function isFullyOpaque(buf: Buffer): Promise<boolean> {
  const meta = await sharp(buf).metadata();
  if (!meta.hasAlpha) return true;
  const { data, info } = await sharp(buf).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const wide = (info as { depth?: string }).depth === 'ushort';
  const step = info.channels * (wide ? 2 : 1);
  const alphaOffset = (info.channels - 1) * (wide ? 2 : 1);
  for (let i = alphaOffset; i < data.length; i += step) {
    if (data[i] < 255) return false; // big-endian high byte
  }
  return true;
}

async function psnr(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([rawGray(a), rawGray(b)]);
  if (ra.width !== rb.width || ra.height !== rb.height) return NaN;
  let mse = 0;
  const n = Math.min(ra.data.length, rb.data.length);
  for (let i = 0; i < n; i++) {
    const d = ra.data[i] - rb.data[i];
    mse += d * d;
  }
  mse /= n;
  if (mse === 0) return 99;
  return 10 * Math.log10((255 * 255) / mse);
}

async function ssim(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([rawGray(a), rawGray(b)]);
  if (ra.width !== rb.width || ra.height !== rb.height) return NaN;
  const { width: w, height: h, data: A } = ra;
  const B = rb.data;
  const win = 8;
  const C1 = 6.5025, C2 = 58.5225; // (0.01*255)^2, (0.03*255)^2
  let total = 0, count = 0;
  for (let y = 0; y + win <= h; y += win) {
    for (let x = 0; x + win <= w; x += win) {
      let ma = 0, mb = 0;
      for (let dy = 0; dy < win; dy++) {
        for (let dx = 0; dx < win; dx++) {
          ma += A[(y + dy) * w + x + dx];
          mb += B[(y + dy) * w + x + dx];
        }
      }
      ma /= 64; mb /= 64;
      let va = 0, vb = 0, cov = 0;
      for (let dy = 0; dy < win; dy++) {
        for (let dx = 0; dx < win; dx++) {
          const da = A[(y + dy) * w + x + dx] - ma;
          const db = B[(y + dy) * w + x + dx] - mb;
          va += da * da; vb += db * db; cov += da * db;
        }
      }
      va /= 64; vb /= 64; cov /= 64;
      total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      count++;
    }
  }
  return count ? total / count : NaN;
}

async function laplacianVariance(buf: Buffer): Promise<number> {
  const { data, width: w, height: h } = await rawGray(buf);
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = -4 * data[i] + data[i - 1] + data[i + 1] + data[i - w] + data[i + w];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

async function rawRgb8At64(buf: Buffer): Promise<Uint8Array> {
  const { data, info } = await sharp(buf)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if ((info as { depth?: string }).depth !== 'ushort') return data;
  const out = new Uint8Array((data.length / 2) | 0);
  for (let i = 0, j = 0; i + 1 < data.length; i += 2, j++) out[j] = data[i];
  return out;
}

async function colorShift(original: Buffer, roundTrip: Buffer): Promise<number> {
  const [a, b] = await Promise.all([rawRgb8At64(original), rawRgb8At64(roundTrip)]);
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

async function clippedShare(buf: Buffer): Promise<number> {
  const { data } = await rawGray(buf);
  // True saturation only: exactly 0 or exactly 255 (a 253 -> 254 lift on
  // paper-white backgrounds is imperceptible and must not count as clipping).
  let clipped = 0;
  for (let i = 0; i < data.length; i++) if (data[i] === 0 || data[i] === 255) clipped++;
  return clipped / data.length;
}

/* ------------------------------------------------------------------ */
/* Benchmark matrix                                                    */
/* ------------------------------------------------------------------ */
interface RunRecord {
  file: string;
  category: string;
  scale: number;
  preset: string;
  format: string;
  rtPsnr: number;      // round-trip fidelity vs original
  rtSsim: number;
  devPsnr: number;     // deviation vs pure lanczos reference
  devSsim: number;
  sharpDelta: number;  // laplacian variance delta vs reference
  colorShift: number;
  clipDelta: number;   // saturated-pixel share delta vs reference
  outBytes: number;
  inBytes: number;
  ms: number;
  dimsOk: boolean;
  alphaOk: boolean;
}

async function referenceResize(input: Buffer, scale: number): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const swapped = Boolean(meta.orientation && meta.orientation >= 5 && meta.orientation <= 8);
  const w = (swapped ? meta.height : meta.width)! * scale;
  const h = (swapped ? meta.width : meta.height)! * scale;
  return sharp(input, { sequentialRead: true }).rotate().resize({ width: w, height: h, kernel: sharp.kernel.lanczos3, fit: 'fill' }).png().toBuffer();
}

async function runOne(input: Buffer, meta0: Metadata, opts: UpscaleOptions, item: CorpusItem): Promise<RunRecord> {
  const result = await processImageUpscale(input, opts);
  const outMeta = await sharp(result.buffer).metadata();
  const dimsOk =
    outMeta.width === Math.round(item.width * opts.scale) &&
    outMeta.height === Math.round(item.height * opts.scale);

  // Round trip back to the original footprint
  const roundTrip = await sharp(result.buffer)
    .resize(item.width, item.height, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png()
    .toBuffer();

  const reference = await referenceResize(input, opts.scale);
  const refRoundTrip = await sharp(reference)
    .resize(item.width, item.height, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png()
    .toBuffer();

  // JPG flattens alpha away; PNG/WebP must keep real transparency. A fully
  // opaque alpha channel may be dropped by the encoder (lossless, smaller).
  const inputOpaque = await isFullyOpaque(input);
  const alphaOk = opts.format === 'jpg'
    ? outMeta.hasAlpha === false
    : inputOpaque || outMeta.hasAlpha === true;

  const [rtPsnr, rtSsim, devPsnr, devSsim, sharpOut, sharpRef, cs, clipOut, clipRef] = await Promise.all([
    psnr(roundTrip, input),
    ssim(roundTrip, input),
    psnr(result.buffer, reference),
    ssim(result.buffer, reference),
    laplacianVariance(result.buffer),
    laplacianVariance(reference),
    colorShift(input, roundTrip),
    clippedShare(result.buffer),
    clippedShare(reference),
  ]);
  void refRoundTrip;

  return {
    file: item.file, category: item.category, scale: opts.scale,
    preset: opts.preset ?? 'photo', format: opts.format ?? 'png',
    rtPsnr, rtSsim, devPsnr, devSsim,
    sharpDelta: sharpOut - sharpRef,
    colorShift: cs,
    clipDelta: clipOut - clipRef,
    outBytes: result.upscaledSize, inBytes: result.originalSize,
    ms: result.processingTimeMs,
    dimsOk, alphaOk,
  };
}

function summarize(records: RunRecord[]) {
  const avg = (fn: (r: RunRecord) => number) => {
    const vals = records.map(fn).filter((v) => Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  };
  return {
    n: records.length,
    rtPsnr: avg((r) => r.rtPsnr),
    rtSsim: avg((r) => r.rtSsim),
    devPsnr: avg((r) => r.devPsnr),
    devSsim: avg((r) => r.devSsim),
    sharpDelta: avg((r) => r.sharpDelta),
    colorShift: avg((r) => r.colorShift),
    clipDelta: avg((r) => r.clipDelta),
    outBytes: avg((r) => r.outBytes),
    ms: avg((r) => r.ms),
    dimsOk: records.every((r) => r.dimsOk),
    alphaOk: records.every((r) => r.alphaOk),
  };
}

async function main() {
  console.log('Generating 50-image corpus...');
  const items = await generateCorpus();
  console.log(`Corpus ready: ${items.length} images in qa/corpus\n`);

  const matrix: Array<{ label: string; opts: (i: number) => UpscaleOptions }> = [
    { label: '2x AUTO webp92 (default)', opts: () => ({ scale: 2, preset: 'auto', format: 'webp', quality: 92 }) },
    { label: '2x photo webp92', opts: () => ({ scale: 2, preset: 'photo', format: 'webp', quality: 92 }) },
    { label: '2x photo png (lossless)', opts: () => ({ scale: 2, preset: 'photo', format: 'png' }) },
    { label: '4x photo webp92', opts: () => ({ scale: 4, preset: 'photo', format: 'webp', quality: 92 }) },
    { label: '2x anime webp92', opts: () => ({ scale: 2, preset: 'anime', format: 'webp', quality: 92 }) },
    { label: '2x document webp92', opts: () => ({ scale: 2, preset: 'document', format: 'webp', quality: 92 }) },
    { label: '2x MAX (sharp100/denoise100/detail100)', opts: () => ({ scale: 2, preset: 'custom', sharpness: 100, denoise: 100, detailBoost: 100, format: 'webp', quality: 92 }) },
    { label: '2x ZERO (all enhancements off)', opts: () => ({ scale: 2, preset: 'custom', sharpness: 0, denoise: 0, detailBoost: 0, format: 'webp', quality: 92 }) },
  ];
  if (!QUICK) {
    matrix.push({ label: '8x photo webp92 (subset)', opts: () => ({ scale: 8, preset: 'photo', format: 'webp', quality: 92 }) });
  }

  const allRecords: Record<string, RunRecord[]> = {};
  for (const { label, opts } of matrix) {
    const subset = label.includes('8x') ? items.filter((_, i) => i % 4 === 0) : items;
    const records: RunRecord[] = [];
    for (const item of subset) {
      // Read raw bytes: re-encoding through sharp would strip EXIF orientation.
      const input = readFileSync(path.join(CORPUS_DIR, item.file));
      const meta0 = await sharp(input).metadata();
      try {
        records.push(await runOne(input, meta0, opts(item.file.length), item));
      } catch (error: any) {
        console.error(`FAIL ${item.file} [${label}]: ${error?.message}`);
        records.push({
          file: item.file, category: item.category, scale: opts(0).scale, preset: String(opts(0).preset),
          format: String(opts(0).format), rtPsnr: NaN, rtSsim: NaN, devPsnr: NaN, devSsim: NaN,
          sharpDelta: NaN, colorShift: NaN, clipDelta: NaN, outBytes: 0, inBytes: input.length,
          ms: 0, dimsOk: false, alphaOk: false,
        });
      }
    }
    allRecords[label] = records;
    const s = summarize(records);
    console.log(
      `${label.padEnd(42)} n=${String(s.n).padStart(2)}  ` +
      `rtPSNR=${s.rtPsnr.toFixed(2)}  rtSSIM=${s.rtSsim.toFixed(4)}  ` +
      `devPSNR=${s.devPsnr.toFixed(2)}  sharpΔ=${s.sharpDelta.toFixed(0).padStart(6)}  ` +
      `colorΔ=${s.colorShift.toFixed(2)}  clipΔ=${(s.clipDelta * 100).toFixed(2)}%  ` +
      `${s.ms.toFixed(0)}ms  dims=${s.dimsOk ? 'OK' : 'BAD'} alpha=${s.alphaOk ? 'OK' : 'BAD'}`
    );
  }

  // Per-category breakdown for the default config
  const def = allRecords['2x AUTO webp92 (default)'] ?? [];
  console.log('\nPer-category (2x AUTO webp92):');
  for (const category of ['photo', 'portrait', 'document', 'lineart', 'texture']) {
    const s = summarize(def.filter((r) => r.category === category));
    if (!s.n) continue;
    console.log(
      `  ${category.padEnd(9)} rtPSNR=${s.rtPsnr.toFixed(2)}  rtSSIM=${s.rtSsim.toFixed(4)}  ` +
      `devPSNR=${s.devPsnr.toFixed(2)}  sharpΔ=${s.sharpDelta.toFixed(0).padStart(6)}  colorΔ=${s.colorShift.toFixed(2)}  clipΔ=${(s.clipDelta * 100).toFixed(2)}%`
    );
  }

  // Worst offenders for the default config
  const worst = [...def].sort((a, b) => a.rtPsnr - b.rtPsnr).slice(0, 5);
  console.log('\nWorst round-trip fidelity (2x AUTO webp92):');
  for (const r of worst) {
    console.log(`  ${r.file.padEnd(26)} rtPSNR=${r.rtPsnr.toFixed(2)}  devPSNR=${r.devPsnr.toFixed(2)}  clipΔ=${(r.clipDelta * 100).toFixed(2)}%`);
  }

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), quick: QUICK, summary: Object.fromEntries(Object.entries(allRecords).map(([k, v]) => [k, summarize(v)])), records: allRecords, corpus: items }, null, 2));
  console.log(`\nFull report written to ${path.relative(ROOT, REPORT_PATH)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
