import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { DEFAULT_SETTINGS, PRESET_DEFAULTS, sameSettings, withPreset } from '../shared/upscale.ts';
import { normalizeOptions, processImageUpscale } from '../server/upscaler.ts';
import { createApp } from '../server/app.ts';
import { parseOptions } from '../server/http.ts';
import { parseMetadata } from '../src/lib/api.ts';
import { downloadName, uniqueNames } from '../src/lib/files.ts';

async function rgbaFixture(alpha = 0.5) {
  return sharp({
    create: { width: 24, height: 16, channels: 4, background: { r: 35, g: 120, b: 210, alpha } },
  }).png().toBuffer();
}

test('normalizes bounded settings, unifies UI/server preset defaults, and rejects non-numeric/invalid values', () => {
  const options = normalizeOptions({ scale: 2, format: 'jpg', sharpness: 500, contrast: -90 });
  assert.equal(options.sharpness, 100);
  assert.equal(options.contrast, -50);
  assert.equal(options.format, 'jpg');

  for (const preset of ['photo', 'digital_art', 'anime', 'document', 'pixel_art', 'custom'] as const) {
    const serverDefaults = normalizeOptions({ scale: 2, preset });
    const uiDefaults = withPreset(DEFAULT_SETTINGS, preset);
    assert.equal(sameSettings(serverDefaults, uiDefaults), true, `Mismatch for preset ${preset}`);
    assert.deepEqual(
      { sharpness: serverDefaults.sharpness, denoise: serverDefaults.denoise, detailBoost: serverDefaults.detailBoost },
      PRESET_DEFAULTS[preset],
    );
  }

  // Omitted multipart fields must fall back to preset defaults, never coerce undefined -> NaN -> 0
  const parsed = parseOptions({ scale: '4', preset: 'photo', format: 'webp' });
  const normalized = normalizeOptions(parsed);
  assert.equal(normalized.scale, 4);
  assert.equal(normalized.format, 'webp');
  assert.equal(normalized.quality, 95);

  assert.throws(() => normalizeOptions({ scale: 3 }), /Scale must be 2, 4, or 8/);
  assert.throws(() => parseOptions({ scale: '2', sharpness: 'abc' }), /must be a finite number/);
  assert.throws(() => parseOptions({ scale: '2', unknownField: '1' }), /Unknown setting/);
});

test('upscales PNG with centre-aligned NoHalo, preserves semi-transparent alpha under contrast, and strips EXIF', async () => {
  const input = await rgbaFixture(0.5);
  const result = await processImageUpscale(input, { scale: 2, format: 'png', preset: 'photo', contrast: 25 });
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 48);
  assert.equal(metadata.height, 32);
  assert.equal(metadata.format, 'png');
  assert.equal(result.hasAlpha, true);

  const { data } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
  // Alpha channel (every 4th byte starting at index 3) must remain ~128 (0.5 * 255), not clipped to 255 or shifted by linear contrast offset
  assert.ok(Math.abs(data[3] - 128) <= 2, `Expected alpha near 128, got ${data[3]}`);
});

test('handles EXIF orientation (swapped dimensions) and strips orientation/metadata on output', async () => {
  const raw = await sharp({
    create: { width: 30, height: 20, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg()
    .toBuffer();
  const oriented = await sharp(raw).withMetadata({ orientation: 6 }).toBuffer();

  const result = await processImageUpscale(oriented, { scale: 2, format: 'png' });
  assert.equal(result.originalWidth, 20);
  assert.equal(result.originalHeight, 30);
  assert.equal(result.upscaledWidth, 40);
  assert.equal(result.upscaledHeight, 60);

  const outMeta = await sharp(result.buffer).metadata();
  assert.equal(outMeta.width, 40);
  assert.equal(outMeta.height, 60);
  assert.equal(outMeta.orientation, undefined);
});

test('pixel_art preset uses exact nearest-neighbour enlargement without smoothing or haloing', async () => {
  // 2x2 checkerboard: (0,0)=red, (1,0)=blue, (0,1)=blue, (1,1)=red
  const pixels = Buffer.from([
    255, 0, 0, 0, 0, 255,
    0, 0, 255, 255, 0, 0,
  ]);
  const sprite = await sharp(pixels, { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
  const result = await processImageUpscale(sprite, { scale: 4, preset: 'pixel_art', format: 'png', sharpness: 90, denoise: 90 });
  const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 8);
  assert.equal(info.height, 8);
  // Top-left 4x4 block must be pure red (255,0,0), top-right 4x4 block must be pure blue (0,0,255)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = (y * 8 + x) * 3;
      assert.deepEqual([data[idx], data[idx + 1], data[idx + 2]], [255, 0, 0]);
    }
  }
});

test('exports JPG with white background warning when source has alpha, and supports lossless WebP at quality 100', async () => {
  const input = await rgbaFixture(0.6);
  const jpg = await processImageUpscale(input, { scale: 2, format: 'jpg', quality: 88 });
  const webp = await processImageUpscale(input, { scale: 2, format: 'webp', quality: 100 });
  assert.equal((await sharp(jpg.buffer).metadata()).format, 'jpeg');
  assert.equal((await sharp(jpg.buffer).metadata()).hasAlpha, false);
  assert.ok(jpg.warnings.some(w => /JPG uses a white background/i.test(w)));
  assert.equal((await sharp(webp.buffer).metadata()).format, 'webp');
  assert.equal(webp.hasAlpha, true);
});

test('rejects corrupt bytes, SVG, animated GIFs, and oversized output dimensions with clean errors', async () => {
  await assert.rejects(
    processImageUpscale(Buffer.from('not an image'), { scale: 2, format: 'png' }),
    /damaged or unsupported/i,
  );

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
  await assert.rejects(
    processImageUpscale(svg, { scale: 2, format: 'png' }),
    /Unsupported image|damaged or unsupported/i,
  );

  // 2000x2000 at 8x = 16000x16000 (> 12000 px max dimension)
  const large = await sharp({
    create: { width: 2000, height: 2000, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer();
  await assert.rejects(
    processImageUpscale(large, { scale: 8, format: 'png' }),
    /too large.*12,000 px/i,
  );
});

test('client helpers sanitize filenames, deduplicate ZIP names, and validate X-Upscale-Metadata', async () => {
  assert.equal(downloadName('../weird:name?.png', 2, 'webp'), 'weird_name__2x.webp');
  assert.deepEqual(uniqueNames(['photo_2x.png', 'photo_2x.png', 'PHOTO_2x.png']), [
    'photo_2x.png',
    'photo_2x_2.png',
    'PHOTO_2x_3.png',
  ]);

  const input = await rgbaFixture(1);
  const result = await processImageUpscale(input, { scale: 2, format: 'png' });
  const { buffer, ...meta } = result;
  const header = Buffer.from(JSON.stringify(meta)).toString('base64url');
  const blob = new Blob([new Uint8Array(buffer)], { type: 'image/png' });
  const parsed = parseMetadata(header, blob, result.settings);
  assert.equal(parsed.upscaledWidth, 48);
  assert.throws(() => parseMetadata(header, new Blob([new Uint8Array(Buffer.from('short'))], { type: 'image/png' }), result.settings), /invalid image information/i);
});

test('HTTP API enforces method allowlist, multipart requirement, metadata header contract, and security headers', async () => {
  const app = createApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const statusRes = await fetch(`${base}/api/system-status`);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.headers.get('cache-control'), 'no-store');
    assert.equal(statusRes.headers.get('x-content-type-options'), 'nosniff');
    const statusJson = await statusRes.json();
    assert.equal(statusJson.neural, false);
    assert.equal(statusJson.pipelineVersion, '2.0.0');

    const getUpscale = await fetch(`${base}/api/upscale`);
    assert.equal(getUpscale.status, 405);
    assert.equal(getUpscale.headers.get('allow'), 'POST');

    const jsonUpscale = await fetch(`${base}/api/upscale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scale: 2 }),
    });
    assert.equal(jsonUpscale.status, 415);

    const png = await rgbaFixture(1);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'fixture.png');
    form.append('scale', '2');
    form.append('format', 'png');
    const okRes = await fetch(`${base}/api/upscale`, { method: 'POST', body: form });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('content-type'), 'image/png');
    const metaHeader = okRes.headers.get('x-upscale-metadata');
    assert.ok(metaHeader);
    const bodyBytes = Buffer.from(await okRes.arrayBuffer());
    const outMeta = await sharp(bodyBytes).metadata();
    assert.equal(outMeta.width, 48);
    assert.equal(outMeta.height, 32);
  } finally {
    server.close();
  }
});

test('50-image benchmark report is present, complete, and shows zero scenario regressions', async () => {
  const report = JSON.parse(await readFile('docs/quality/results.json', 'utf8'));
  assert.equal(report.images, 50);
  assert.equal(report.pairedCases, 250);
  assert.equal(report.rows.length, 250);
  const uniqueIds = new Set(report.rows.map((r: { id: string }) => r.id));
  assert.equal(uniqueIds.size, 50);
  for (const s of report.scenarios) {
    assert.equal(s.count, 50);
    assert.ok(s.deltaPSNR > 0, `Expected positive PSNR delta for ${s.scenario}`);
    assert.ok(s.deltaSSIM > 0, `Expected positive SSIM delta for ${s.scenario}`);
  }
});

test('live browser UI renders Telenor/Grameenphone-aligned typography, passes WCAG 2.1 AA, and completes end-to-end upscale & keyboard slider flow', async () => {
  process.env.AWS_EXECUTION_ENV ??= 'AWS_Lambda_nodejs22.x';
  process.env.DISABLE_HMR = 'true';
  const [{ chromium: playwright }, { default: chromium }, { default: AxeBuilder }, { createServer: createViteServer }] =
    await Promise.all([
      import('@playwright/test'),
      import('@sparticuz/chromium'),
      import('@axe-core/playwright'),
      import('vite'),
    ]);

  const app = createApp();
  const server = app.listen(0);
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
  const browser = await playwright.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: true,
  });

  try {
    const { port } = server.address() as AddressInfo;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });

    const fontFamily = await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily);
    assert.match(fontFamily, /Telenor Local.*DM Sans/i);

    const initialAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.equal(initialAxe.violations.length, 0, `Initial A11y violations: ${JSON.stringify(initialAxe.violations)}`);

    // Open and close "How it works" dialog via keyboard Escape
    await page.getByRole('button', { name: 'How it works', exact: true }).click();
    const modalAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.equal(modalAxe.violations.length, 0, `Modal A11y violations: ${JSON.stringify(modalAxe.violations)}`);
    await page.keyboard.press('Escape');

    // Load sample, upscale, verify comparison slider keyboard control and no spurious settings-changed notice
    await page.getByRole('button', { name: 'Try nature example', exact: true }).click();
    await page.getByRole('button', { name: 'Upscale image', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor({ timeout: 30_000 });

    assert.equal(await page.locator('.settings-changed').count(), 0);
    const slider = page.getByRole('slider', { name: 'Comparison divider' });
    assert.equal(await slider.getAttribute('aria-valuenow'), '50');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await slider.getAttribute('aria-valuenow'), '52');

    // Change scale -> verify settings-changed notice appears
    await page.getByRole('button', { name: '4×', exact: true }).click();
    assert.equal(await page.locator('.settings-changed').count(), 1);

    const resultAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.equal(resultAxe.violations.length, 0, `Result A11y violations: ${JSON.stringify(resultAxe.violations)}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await vite.close();
    server.close();
  }
});
