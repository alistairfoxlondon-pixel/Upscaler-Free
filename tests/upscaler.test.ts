import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  normalizeOptions,
  processImageUpscale,
  detectContentKind,
  UpscaleError,
  MAX_INPUT_BYTES,
} from '../server/upscaler.ts';
import { buildUpscaleMetadata } from '../server/http-utils.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICC_FIXTURE = path.join(__dirname, 'fixtures', 'display-rgb.icc');

async function fixture() {
  return sharp({
    create: { width: 24, height: 16, channels: 4, background: { r: 35, g: 120, b: 210, alpha: 0.75 } },
  }).png().toBuffer();
}

test('normalizes bounded settings and rejects invalid scale', () => {
  const options = normalizeOptions({ scale: 2, format: 'jpg', sharpness: 500, contrast: -90 });
  assert.equal(options.sharpness, 100);
  assert.equal(options.contrast, -50);
  assert.equal(options.format, 'jpg');
  assert.equal(options.preset, 'auto');
  assert.throws(() => normalizeOptions({ scale: 3 }), /Scale must be/);
  assert.throws(() => normalizeOptions({ scale: 2, format: 'gif' as never }), /Format must be/);
});

test('upscales and exports PNG with correct metadata', async () => {
  const input = await fixture();
  const result = await processImageUpscale(input, { scale: 2, format: 'png', preset: 'photo' });
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 48);
  assert.equal(metadata.height, 32);
  assert.equal(metadata.format, 'png');
  assert.equal(result.originalWidth, 24);
  assert.equal(result.originalHeight, 16);
  assert.equal(result.upscaledSize, result.buffer.length);
  assert.equal(result.mimeType, 'image/png');
  assert.ok(result.processingTimeMs >= 0);
});

test('exports JPG without alpha and WebP with alpha', async () => {
  const input = await fixture();
  const jpg = await processImageUpscale(input, { scale: 2, format: 'jpg', quality: 88 });
  const webp = await processImageUpscale(input, {
    scale: 2,
    format: 'webp',
    brightness: 15,
    contrast: 10,
    saturation: -10,
    detailBoost: 60,
  });
  assert.equal((await sharp(jpg.buffer).metadata()).format, 'jpeg');
  assert.equal((await sharp(jpg.buffer).metadata()).hasAlpha, false);
  const webpMeta = await sharp(webp.buffer).metadata();
  assert.equal(webpMeta.format, 'webp');
  assert.equal(webpMeta.hasAlpha, true);
});

test('rejects corrupt image bytes with a client error', async () => {
  await assert.rejects(
    processImageUpscale(Buffer.from('not an image'), { scale: 2, format: 'png' }),
    (error: unknown) => {
      assert.ok(error instanceof UpscaleError);
      assert.equal((error as UpscaleError).statusCode, 400);
      assert.match((error as Error).message, /could not be decoded/i);
      return true;
    }
  );
});

test('rejects truncated images with a client error (not a 500 libvips leak)', async () => {
  const full = await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  }).jpeg({ quality: 90 }).toBuffer();
  const truncated = full.subarray(0, Math.floor(full.length * 0.4));
  await assert.rejects(
    processImageUpscale(truncated, { scale: 2, format: 'png' }),
    (error: unknown) => {
      assert.ok(error instanceof UpscaleError);
      assert.equal((error as UpscaleError).statusCode, 400);
      assert.doesNotMatch((error as Error).message, /Vips/i);
      return true;
    }
  );
});

test('rejects empty and oversized input', async () => {
  await assert.rejects(processImageUpscale(Buffer.alloc(0), { scale: 2 }), /empty/i);
  const big = Buffer.alloc(MAX_INPUT_BYTES + 1);
  await assert.rejects(processImageUpscale(big, { scale: 2 }), /4 MB/);
});

test('applies EXIF orientation and swaps output dimensions', async () => {
  // 40x30 stored, orientation 6 means display is 30x40.
  const input = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 200, g: 100, b: 50 } },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await processImageUpscale(input, { scale: 2, format: 'png', preset: 'photo' });
  assert.equal(result.originalWidth, 30);
  assert.equal(result.originalHeight, 40);
  assert.equal(result.upscaledWidth, 60);
  assert.equal(result.upscaledHeight, 80);
  const out = await sharp(result.buffer).metadata();
  assert.equal(out.width, 60);
  assert.equal(out.height, 80);
  // Output pixels are physically oriented: no orientation tag should remain.
  assert.equal(out.orientation, undefined);
});

test('preserves real alpha but allows encoders to drop fully-opaque alpha', async () => {
  const semi = await sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
  }).png().toBuffer();
  const webp = await processImageUpscale(semi, { scale: 2, format: 'webp', preset: 'photo' });
  assert.equal((await sharp(webp.buffer).metadata()).hasAlpha, true);

  const opaque = await sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
  const opaqueOut = await processImageUpscale(opaque, { scale: 2, format: 'webp', preset: 'photo' });
  // libvips may drop a fully-opaque alpha channel when saving WebP (lossless, smaller).
  const opaqueMeta = await sharp(opaqueOut.buffer).metadata();
  assert.equal(opaqueMeta.hasAlpha, false);
  assert.equal(opaqueMeta.channels, 3);
});

test('preserves ICC color profiles on all export formats', async () => {
  const input = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 120, g: 60, b: 200 } },
  })
    .jpeg({ quality: 92 })
    .toBuffer()
    .then((buf) => sharp(buf).withIccProfile(ICC_FIXTURE).jpeg().toBuffer());
  assert.equal((await sharp(input).metadata()).hasProfile, true);

  for (const format of ['jpg', 'png', 'webp'] as const) {
    const result = await processImageUpscale(input, { scale: 2, format, preset: 'photo' });
    assert.equal(
      (await sharp(result.buffer).metadata()).hasProfile,
      true,
      `ICC profile lost for ${format} output`
    );
  }
});

test('denoise slider has no dead zone: value 1 differs from 0', async () => {
  const input = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 30 } },
  }).jpeg({ quality: 80 }).toBuffer();
  const zero = await processImageUpscale(input, {
    scale: 2, format: 'png', preset: 'custom', sharpness: 0, denoise: 0, detailBoost: 0,
  });
  const one = await processImageUpscale(input, {
    scale: 2, format: 'png', preset: 'custom', sharpness: 0, denoise: 1, detailBoost: 0,
  });
  assert.notDeepEqual(one.buffer, zero.buffer);
});

test('enforces the output dimension and megapixel safety limit', async () => {
  const input = await sharp({
    create: { width: 2000, height: 2000, channels: 3, background: { r: 10, g: 200, b: 90 } },
  }).jpeg({ quality: 90 }).toBuffer();
  await assert.rejects(
    processImageUpscale(input, { scale: 8, format: 'png' }),
    /12,000 px \/ 64 MP/
  );
});

test('auto preset detects documents and photos', async () => {
  const document = await sharp(Buffer.from(
    `<svg width="240" height="160" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="160" fill="#ffffff"/>
      ${Array.from({ length: 12 }, (_, i) =>
        `<rect x="24" y="${16 + i * 12}" width="${120 + (i % 3) * 30}" height="5" fill="#111111"/>`).join('')}
    </svg>`
  )).png().toBuffer();
  const photo = await sharp({
    create: { width: 240, height: 160, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 35 } },
  }).jpeg({ quality: 80 }).toBuffer();

  assert.equal(await detectContentKind(document), 'document');
  assert.equal(await detectContentKind(photo), 'photo');

  const docResult = await processImageUpscale(document, { scale: 2, format: 'png', preset: 'auto' });
  assert.equal(docResult.contentKind, 'document');
  assert.equal(docResult.preset, 'document');
  const photoResult = await processImageUpscale(photo, { scale: 2, format: 'png', preset: 'auto' });
  assert.equal(photoResult.contentKind, 'photo');
  assert.equal(photoResult.preset, 'photo');
});

test('metadata payload describes the applied preset', async () => {
  const input = await fixture();
  const result = await processImageUpscale(input, { scale: 2, format: 'png', preset: 'auto' });
  const metadata = buildUpscaleMetadata(result);
  assert.equal(metadata.preset, result.preset);
  assert.equal(metadata.upscaledWidth, 48);
  assert.ok(metadata.contentKind);
  // base64url-safe JSON round trip (what the browser decodes from the header)
  const encoded = Buffer.from(JSON.stringify(metadata)).toString('base64url');
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  assert.deepEqual(decoded, JSON.parse(JSON.stringify(metadata)));
});

test('SVG input is rejected as unsupported', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  await assert.rejects(processImageUpscale(svg, { scale: 2 }), /Unsupported|could not be decoded/i);
});

test('read fixture sanity: ICC test profile exists', () => {
  assert.ok(readFileSync(ICC_FIXTURE).length > 1000);
});
