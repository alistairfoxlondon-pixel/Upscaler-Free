import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { processImageUpscale } from '../server/upscaler.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = (name: string) =>
  fs.readFileSync(path.join(here, '..', 'src', 'assets', 'images', `benchmark_${name}_lowres.jpg`));

/** Mean absolute per-channel difference between two equal-sized RGB buffers. */
async function meanAbsDiff(a: Buffer, b: Buffer, w: number, h: number): Promise<number> {
  const ra = await sharp(a).resize(w, h).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).resize(w, h).removeAlpha().raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < ra.length; i++) sum += Math.abs(ra[i] - rb[i]);
  return sum / ra.length;
}

test('2x AI upscale returns exact target dimensions and reports the esrgan engine', async () => {
  const r = await processImageUpscale(sample('portrait'), { scale: 2, format: 'png', sharpness: 0, denoise: 0 });
  assert.equal(r.engine, 'esrgan');
  assert.equal(r.originalWidth, 400);
  assert.equal(r.originalHeight, 300);
  assert.equal(r.upscaledWidth, 800);
  assert.equal(r.upscaledHeight, 600);
  const meta = await sharp(r.buffer).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 600);
  assert.equal(meta.format, 'png');
});

test('AI output is genuinely different from a plain Lanczos resize (not a relabelled resize)', async () => {
  const r = await processImageUpscale(sample('nature'), { scale: 2, format: 'png', sharpness: 0, denoise: 0 });
  const plain = await sharp(sample('nature')).resize(800, 600, { kernel: 'lanczos3' }).png().toBuffer();
  const diff = await meanAbsDiff(r.buffer, plain, 800, 600);
  // Measured mean differences on the benchmark set: 1.6 (portrait) to 5.1 (art) levels. The previous
  // resize-only pipeline differed from plain Lanczos by only 0.36 on the portrait.
  assert.ok(diff > 1.5, `expected visible difference from plain resize, got mean diff ${diff.toFixed(2)}`);
});

test('tiled inference leaves no seams on a flat image', async () => {
  // 300x300 spans multiple 128px tiles, so tile borders are exercised.
  const flat = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 120, g: 150, b: 90 } } })
    .png()
    .toBuffer();
  const r = await processImageUpscale(flat, { scale: 2, format: 'png', sharpness: 0, denoise: 0 });
  const { data, info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
  // Measure spread per channel: the flat colour differs between channels by design.
  for (let ch = 0; ch < 3; ch++) {
    let min = 255;
    let max = 0;
    for (let i = ch; i < data.length; i += 3) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    // Seams would show as a band of different values at tile boundaries (x = 256, 512 in output).
    assert.ok(max - min <= 6, `channel ${ch} spread ${max - min} suggests tile seams`);
  }
  assert.equal(info.width, 600);
});

test('transparency is preserved in the AI path', async () => {
  // 120x120 opaque red with a fully transparent 60x60 hole in the centre.
  const W = 120;
  const raw = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inHole = x >= 30 && x < 90 && y >= 30 && y < 90;
      raw[i] = 200;
      raw[i + 1] = 60;
      raw[i + 2] = 60;
      raw[i + 3] = inHole ? 0 : 255;
    }
  }
  const src = await sharp(raw, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
  const r = await processImageUpscale(src, { scale: 2, format: 'png', sharpness: 0, denoise: 0 });
  const { data, info } = await sharp(r.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  const centre = (120 * info.width + 120) * 4 + 3; // alpha at output (120,120): inside the hole
  assert.ok(data[centre] < 64, `transparent centre alpha should stay low, got ${data[centre]}`);
  assert.equal(data[3], 255, 'opaque corner should stay opaque');
});

test('EXIF orientation swaps output dimensions', async () => {
  const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#4080c0' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const r = await processImageUpscale(rotated, { scale: 2, format: 'png', sharpness: 0, denoise: 0 });
  assert.equal(r.originalWidth, 100);
  assert.equal(r.originalHeight, 200);
  assert.equal(r.upscaledWidth, 200);
  assert.equal(r.upscaledHeight, 400);
});

test('oversized input falls back to the fast engine and says why', async () => {
  // 1600x1400 = 2.24 MP, above the 2 MP AI budget for 2x.
  const big = await sharp({ create: { width: 1600, height: 1400, channels: 3, background: '#808080' } })
    .jpeg()
    .toBuffer();
  const r = await processImageUpscale(big, { scale: 2, format: 'jpg', sharpness: 0, denoise: 0 });
  assert.equal(r.engine, 'lanczos');
  assert.match(r.engineNote ?? '', /fast resize/);
  assert.equal(r.upscaledWidth, 3200);
});

test('unreadable input is rejected with a 400-style error', async () => {
  await assert.rejects(
    processImageUpscale(Buffer.from('definitely not an image'), { scale: 2 }),
    (err: any) => err.status === 400
  );
});

test('jpg output is flattened and webp/jpg encode with the requested mime type', async () => {
  const jpg = await processImageUpscale(sample('art'), { scale: 2, format: 'jpg', quality: 90 });
  assert.equal(jpg.mimeType, 'image/jpeg');
  assert.equal((await sharp(jpg.buffer).metadata()).format, 'jpeg');
  const webp = await processImageUpscale(sample('art'), { scale: 2, format: 'webp', quality: 90 });
  assert.equal(webp.mimeType, 'image/webp');
  assert.equal((await sharp(webp.buffer).metadata()).format, 'webp');
});
