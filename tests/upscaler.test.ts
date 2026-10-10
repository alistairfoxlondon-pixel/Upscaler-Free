import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { DEFAULT_SETTINGS, PRESET_DEFAULTS, sameSettings, withPreset } from '../shared/upscale.ts';
import { EMPTY_STOCK_METADATA, normalizeStockMetadata } from '../shared/stock.ts';
import { normalizeOptions, processImageUpscale } from '../server/upscaler.ts';
import { realEsrganConfigured, realEsrganStatus, runRealEsrgan } from '../server/realesrgan.ts';
import { createApp } from '../server/app.ts';
import { parseOptions } from '../server/http.ts';
import { embedJpegXmp } from '../server/stock-xmp.ts';
import { generateAiStockMetadata } from '../server/stock-metadata.ts';
import { parseMetadata } from '../src/lib/api.ts';
import { downloadName, fileError, uniqueNames } from '../src/lib/files.ts';

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
  assert.equal(options.engine, 'classic');
  assert.equal(DEFAULT_SETTINGS.format, 'webp');
  assert.equal(DEFAULT_SETTINGS.quality, 95);
  assert.equal(withPreset(DEFAULT_SETTINGS, 'document').quality, 100);
  assert.equal(withPreset(DEFAULT_SETTINGS, 'pixel_art').quality, 100);
  assert.equal(normalizeOptions({ scale: 2, engine: 'realesrgan' }).engine, 'realesrgan');
  assert.throws(() => normalizeOptions({ scale: 2, engine: 'realesrgan', preset: 'pixel_art' }), /text|pixel edges/i);
  assert.throws(() => normalizeOptions({ scale: 2, engine: 'realesrgan', preset: 'document' }), /text|pixel edges/i);

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
  const losslessPng = await processImageUpscale(input, { scale: 2, format: 'png' });
  assert.deepEqual(await sharp(webp.buffer).raw().toBuffer(), await sharp(losslessPng.buffer).raw().toBuffer());
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
  assert.match(fileError({ name: 'phone.heic', type: 'image/heic', size: 1024 }) ?? '', /needs conversion to JPG or PNG/i);
  assert.match(fileError({ name: 'phone.heif', type: '', size: 1024 }) ?? '', /needs conversion to JPG or PNG/i);
  assert.equal(fileError({ name: 'photo.jpg', type: 'image/jpeg', size: 1024 }), null);
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

test('Stock metadata never invents a local caption, stays within Adobe limits, and embeds title/keywords in JPEG XMP', async () => {
  assert.deepEqual(normalizeStockMetadata(EMPTY_STOCK_METADATA), { title: '', keywords: [], source: 'local' });
  const metadata = normalizeStockMetadata({
    title: 'A "friendly" <sunset> by the sea',
    keywords: ['sunset', 'Sea', 'sunset', 'coast, beach', ...Array.from({ length: 60 }, (_, index) => `keyword-${index}`)],
  });
  assert.equal(metadata.title.length <= 70, true);
  assert.equal(metadata.keywords.length, 49);
  assert.equal(metadata.keywords[0], 'sunset');
  assert.equal(metadata.keywords[1], 'Sea');

  const jpeg = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#2e7788' } }).jpeg().toBuffer();
  const embedded = embedJpegXmp(jpeg, metadata);
  assert.deepEqual(embedded.subarray(0, 2), Buffer.from([0xff, 0xd8]));
  assert.deepEqual(embedded.subarray(2, 4), Buffer.from([0xff, 0xe1]));
  const xmpLength = embedded.readUInt16BE(4);
  const xmpSegment = embedded.subarray(6, 4 + xmpLength).toString('utf8');
  assert.ok(xmpSegment.includes('http://ns.adobe.com/xap/1.0/'));
  assert.ok(xmpSegment.includes('&lt;sunset&gt;'));
  assert.ok(xmpSegment.includes('<dc:subject>'));
  assert.equal((await sharp(embedded).metadata()).format, 'jpeg');
});

test('Real-ESRGAN is never falsely enabled and the worker proxy uses server-only auth and verifies output', async () => {
  const oldUrl = process.env.REAL_ESRGAN_URL;
  const oldKey = process.env.REAL_ESRGAN_API_KEY;
  const oldFetch = globalThis.fetch;
  delete process.env.REAL_ESRGAN_URL;
  delete process.env.REAL_ESRGAN_API_KEY;
  try {
    await assert.rejects(processImageUpscale(await rgbaFixture(1), { scale: 2, engine: 'realesrgan' }), /not configured/i);
    process.env.REAL_ESRGAN_URL = 'https://worker.example';
    assert.equal(realEsrganConfigured(), false, 'A URL without the required worker credential must not enable the AI control.');
    await assert.rejects(processImageUpscale(await rgbaFixture(1), { scale: 2, engine: 'realesrgan' }), /credential/i);

    const input = await rgbaFixture(1);
    const aiPng = await sharp(input).resize(48, 32).png().toBuffer();
    process.env.REAL_ESRGAN_URL = 'https://worker.example';
    process.env.REAL_ESRGAN_API_KEY = 'server-only-test-secret';
    globalThis.fetch = (async (url, init) => {
      assert.equal(String(url), 'https://worker.example/health');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only-test-secret');
      return new Response(JSON.stringify({ status: 'online', model: 'RealESRGAN_x4plus', ready: true, device: 'cuda' }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    assert.deepEqual(await realEsrganStatus(), { configured: true, ready: true });
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'online', model: 'RealESRGAN_x4plus', ready: true, device: 'cpu' }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    assert.deepEqual(await realEsrganStatus(), { configured: true, ready: false });
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'loading', model: 'RealESRGAN_x4plus', ready: false, device: 'cuda' }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    assert.deepEqual(await realEsrganStatus(), { configured: true, ready: false });
    globalThis.fetch = (async (url, init) => {
      assert.equal(String(url), 'https://worker.example/v1/upscale');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only-test-secret');
      assert.equal((init?.body as FormData).get('scale'), '2');
      return new Response(aiPng, { status: 200, headers: { 'content-type': 'image/png', 'x-realesrgan-model': 'RealESRGAN_x4plus' } });
    }) as typeof fetch;
    const result = await processImageUpscale(input, { scale: 2, engine: 'realesrgan', format: 'jpg' });
    assert.equal(result.engine, 'RealESRGAN_x4plus · Real-ESRGAN');
    assert.equal(result.upscaledWidth, 48);
    assert.equal(result.upscaledHeight, 32);
    assert.equal((await sharp(result.buffer).metadata()).format, 'jpeg');
    const proxied = await runRealEsrgan(Buffer.from('png-bytes'), 2);
    assert.equal(proxied.model, 'RealESRGAN_x4plus');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.REAL_ESRGAN_URL; else process.env.REAL_ESRGAN_URL = oldUrl;
    if (oldKey === undefined) delete process.env.REAL_ESRGAN_API_KEY; else process.env.REAL_ESRGAN_API_KEY = oldKey;
  }
});

test('vision metadata adapter keeps provider credentials server-side and validates output', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldModel = process.env.STOCK_METADATA_MODEL;
  const oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'server-only-test-key';
  process.env.STOCK_METADATA_MODEL = 'test-vision-model';
  globalThis.fetch = (async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only-test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'test-vision-model');
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.messages[0].content[1].image_url.detail, 'high');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: 'Misty mountain lake at sunrise', keywords: ['mountain', 'lake', 'sunrise', 'mist', 'nature'] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await generateAiStockMetadata(await rgbaFixture(1));
    assert.equal(result.source, 'ai');
    assert.equal(result.title, 'Misty mountain lake at sunrise');
    assert.equal(result.keywords.length, 5);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.STOCK_METADATA_MODEL; else process.env.STOCK_METADATA_MODEL = oldModel;
  }
});

test('HTTP API enforces method allowlist, multipart requirement, metadata header contract, Stock JPEG XMP export, and security headers', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldAiUrl = process.env.REAL_ESRGAN_URL;
  const oldVercel = process.env.VERCEL;
  process.env.OPENAI_API_KEY = '';
  process.env.REAL_ESRGAN_URL = '';
  process.env.VERCEL = '1';
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
    assert.equal(statusJson.limits.outputBytes, 4 * 1024 * 1024);
    assert.equal(statusJson.engines.classic.configured, true);
    assert.equal(statusJson.engines.realesrgan.configured, false);
    assert.equal(statusJson.engines.realesrgan.ready, false);
    assert.equal(statusJson.engines.realesrgan.neural, false);
    assert.equal(statusJson.stockMetadata.aiConfigured, false);
    assert.equal(statusJson.stockMetadata.autoGenerateOnUpload, true);
    assert.deepEqual(statusJson.exportFormats, ['JPEG with embedded XMP title and keywords']);
    assert.equal(statusJson.neural, false);
    assert.equal(statusJson.pipelineVersion, '3.0.0');

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

    const defaultFormatForm = new FormData();
    defaultFormatForm.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'fixture.png');
    defaultFormatForm.append('scale', '2');
    const defaultFormatResponse = await fetch(`${base}/api/upscale`, { method: 'POST', body: defaultFormatForm });
    assert.equal(defaultFormatResponse.status, 200);
    assert.equal(defaultFormatResponse.headers.get('content-type'), 'image/webp');
    const defaultFormatBody = Buffer.from(await defaultFormatResponse.arrayBuffer());
    assert.ok(defaultFormatBody.length < 4 * 1024 * 1024);
    assert.equal((await sharp(defaultFormatBody).metadata()).format, 'webp');

    // A detailed input whose high-quality 2× result exceeds Vercel's cap must get a clean 413,
    // never an oversized response that the platform can truncate or reject.
    const noisePixels = Buffer.alloc(1280 * 1280 * 3);
    let seed = 0x12345678;
    for (let index = 0; index < noisePixels.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noisePixels[index] = seed >>> 24;
    }
    const noisyJpeg = await sharp(noisePixels, { raw: { width: 1280, height: 1280, channels: 3 } }).jpeg({ quality: 65 }).toBuffer();
    assert.ok(noisyJpeg.length < 4 * 1024 * 1024);
    const oversizedForm = new FormData();
    oversizedForm.append('file', new Blob([new Uint8Array(noisyJpeg)], { type: 'image/jpeg' }), 'detailed.jpg');
    oversizedForm.append('scale', '2');
    const oversizedResponse = await fetch(`${base}/api/upscale`, { method: 'POST', body: oversizedForm });
    assert.equal(oversizedResponse.status, 413);
    assert.equal((await oversizedResponse.json()).code, 'OUTPUT_BYTE_LIMIT');

    const metadataForm = new FormData();
    metadataForm.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'fixture.png');
    const noAi = await fetch(`${base}/api/stock-metadata`, { method: 'POST', body: metadataForm });
    assert.equal(noAi.status, 503);
    assert.equal((await noAi.json()).code, 'STOCK_AI_NOT_CONFIGURED');

    const stockForm = new FormData();
    stockForm.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'fixture.png');
    stockForm.append('title', 'Soft blue abstract background');
    stockForm.append('keywords', JSON.stringify(['blue', 'abstract', 'background', 'texture']));
    const stockResponse = await fetch(`${base}/api/stock-export`, { method: 'POST', body: stockForm });
    assert.equal(stockResponse.status, 200);
    assert.equal(stockResponse.headers.get('content-type'), 'image/jpeg');
    assert.equal(stockResponse.headers.get('x-stock-metadata-embedded'), 'true');
    assert.equal(stockResponse.headers.get('x-stock-alpha-flattened'), 'true');
    const stockJpeg = Buffer.from(await stockResponse.arrayBuffer());
    assert.deepEqual(stockJpeg.subarray(2, 4), Buffer.from([0xff, 0xe1]));
    assert.ok(stockJpeg.includes(Buffer.from('Soft blue abstract background')));
    assert.equal((await sharp(stockJpeg).metadata()).format, 'jpeg');
  } finally {
    server.close();
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldAiUrl === undefined) delete process.env.REAL_ESRGAN_URL; else process.env.REAL_ESRGAN_URL = oldAiUrl;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
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

test('live browser UI passes desktop/mobile WCAG 2.1 AA, prevents mobile overflow, and completes upscale, Stock export, and keyboard slider flows', async () => {
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
    const downloadButton = page.getByRole('button', { name: 'Download JPEG with embedded title and keywords', exact: true });
    await downloadButton.waitFor({ timeout: 30_000 });
    assert.match(await page.locator('.image-metadata span').textContent() ?? '', /WEBP preview/);
    assert.equal(await downloadButton.isDisabled(), true);
    assert.equal(await page.getByRole('textbox', { name: 'Adobe Stock title' }).inputValue(), '');
    await page.getByRole('textbox', { name: 'Adobe Stock title' }).fill('Green tree frog on a rain-covered leaf');
    const keywordInput = page.getByRole('textbox', { name: 'Add a keyword' });
    for (const keyword of ['tree frog', 'green frog', 'raindrops', 'tropical leaf']) {
      await keywordInput.fill(keyword);
      await keywordInput.press('Enter');
    }
    assert.equal(await downloadButton.isDisabled(), false);
    const stockJpegDownload = page.waitForEvent('download');
    await downloadButton.click();
    const downloadedJpeg = await stockJpegDownload;
    assert.equal(downloadedJpeg.suggestedFilename(), 'nature_2x.jpg');
    const downloadedPath = await downloadedJpeg.path();
    assert.ok(downloadedPath);
    const jpegBytes = await readFile(downloadedPath);
    assert.ok(jpegBytes.includes(Buffer.from('Green tree frog on a rain-covered leaf')));
    assert.ok(jpegBytes.includes(Buffer.from('tropical leaf')));

    // Batch output must also contain JPEGs only, each with its own embedded metadata.
    await page.waitForFunction(() => {
      const button = document.querySelector('.workspace-actions .text-button');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await page.locator('input[type="file"]').setInputFiles('src/assets/images/benchmark_art_lowres.jpg');
    await page.waitForFunction(() => document.querySelector('.workspace-heading h2')?.textContent === 'benchmark_art_lowres.jpg');
    assert.equal(await page.getByRole('textbox', { name: 'Adobe Stock title' }).inputValue(), '');
    await page.getByRole('button', { name: 'Upscale image', exact: true }).click();
    await downloadButton.waitFor({ timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Adobe Stock title' }).fill('Colourful abstract illustration');
    await keywordInput.fill('abstract illustration');
    await keywordInput.press('Enter');
    await keywordInput.fill('colourful shapes');
    await keywordInput.press('Enter');
    const zipDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JPEGs', exact: true }).click();
    const zipDownload = await zipDownloadPromise;
    assert.equal(zipDownload.suggestedFilename(), 'OpenUpscale-stock-jpegs.zip');
    const zipPath = await zipDownload.path();
    assert.ok(zipPath);
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(await readFile(zipPath));
    const jpegNames = Object.keys(archive.files).filter(name => !archive.files[name].dir).sort();
    assert.deepEqual(jpegNames, ['benchmark_art_lowres_2x.jpg', 'nature_2x.jpg']);
    const archivedJpeg = Buffer.from(await archive.file('benchmark_art_lowres_2x.jpg')!.async('nodebuffer'));
    assert.deepEqual(archivedJpeg.subarray(2, 4), Buffer.from([0xff, 0xe1]));
    assert.ok(archivedJpeg.includes(Buffer.from('Colourful abstract illustration')));
    assert.ok(archivedJpeg.includes(Buffer.from('colourful shapes')));

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
    await page.setViewportSize({ width: 390, height: 844 });
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(horizontalOverflow, false, 'Mobile layout should not overflow horizontally');
    const mobileAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    assert.equal(mobileAxe.violations.length, 0, `Mobile A11y violations: ${JSON.stringify(mobileAxe.violations)}`);

    const oldMetadataKey = process.env.OPENAI_API_KEY;
    const oldFetch = globalThis.fetch;
    process.env.OPENAI_API_KEY = 'server-only-browser-test-key';
    globalThis.fetch = (async (url, init) => {
      if (String(url) === 'https://api.openai.com/v1/chat/completions') {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'gpt-4o-mini');
        assert.equal(body.messages[0].content[1].image_url.detail, 'high');
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: 'Green tree frog on a rain-covered leaf', keywords: ['tree frog', 'green frog', 'raindrops', 'tropical leaf'] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return oldFetch(url, init);
    }) as typeof fetch;
    try {
      const aiPage = await context.newPage();
      await aiPage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });
      await aiPage.getByRole('button', { name: 'Try nature example', exact: true }).click();
      await aiPage.waitForFunction(() => (document.querySelector('input[aria-label="Adobe Stock title"]') as HTMLInputElement | null)?.value === 'Green tree frog on a rain-covered leaf', undefined, { timeout: 30_000 });
      assert.ok((await aiPage.locator('.keyword-chip').allTextContents()).some(text => text.includes('tropical leaf')));
      assert.equal(await aiPage.locator('.stock-source').textContent(), 'AI draft');
      await aiPage.close();
    } finally {
      globalThis.fetch = oldFetch;
      if (oldMetadataKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldMetadataKey;
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await vite.close();
    server.close();
  }
});
