import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizeOptions, processImageUpscale } from '../server/upscaler.ts';

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
  assert.throws(() => normalizeOptions({ scale: 3 }), /Scale must be/);
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
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
});

test('exports JPG without alpha and WebP', async () => {
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
  assert.equal((await sharp(webp.buffer).metadata()).format, 'webp');
});

test('rejects corrupt image bytes', async () => {
  await assert.rejects(
    processImageUpscale(Buffer.from('not an image'), { scale: 2, format: 'png' }),
    /unsupported image format|unreadable/i
  );
});
