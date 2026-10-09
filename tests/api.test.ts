import assert from 'node:assert/strict';
import test from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';

async function startServer(options?: { rateLimitPerMinute?: number }) {
  const app = createApp(options ?? {});
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function testImage(): Promise<Buffer> {
  return sharp({
    create: { width: 48, height: 32, channels: 3, background: { r: 30, g: 140, b: 220 } },
  }).jpeg({ quality: 90 }).toBuffer();
}

async function postUpscale(base: string, file: { name: string; type: string; data: Buffer } | null, fields: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return fetch(`${base}/api/upscale`, { method: 'POST', body: form });
}

test('GET /api/system-status reports real engine versions and limits', async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/api/system-status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'online');
    const sharpLib = body.libraries.find((l: any) => l.name === 'Sharp');
    assert.ok(sharpLib.version && sharpLib.version !== '0.34', 'Sharp version must be real, not hardcoded');
    assert.ok(body.libraries.some((l: any) => l.name === 'libvips'));
    assert.ok(body.presets.includes('auto'));
    assert.equal(body.limits.maxOutputDimension, 12000);
    assert.equal(body.privacy.persistentStorage, false);
  } finally {
    server.close();
  }
});

test('POST /api/upscale returns image binary with decodable metadata header', async () => {
  const { server, base } = await startServer();
  try {
    const res = await postUpscale(base, { name: 'a.jpg', type: 'image/jpeg', data: await testImage() }, { scale: '2', format: 'webp', preset: 'photo' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^image\/webp/);
    const encoded = res.headers.get('x-upscale-metadata');
    assert.ok(encoded, 'metadata header present');
    const metadata = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'));
    assert.equal(metadata.upscaledWidth, 96);
    assert.equal(metadata.upscaledHeight, 64);
    assert.equal(metadata.format, 'webp');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0);
    assert.equal((await sharp(buf).metadata()).format, 'webp');
  } finally {
    server.close();
  }
});

test('error paths return clean 4xx JSON (no libvips jargon, no 500)', async () => {
  const { server, base } = await startServer();
  try {
    // corrupt bytes
    let res = await postUpscale(base, { name: 'a.jpg', type: 'image/jpeg', data: Buffer.from('junk') }, { scale: '2' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /decoded|unsupported/i);

    // truncated jpeg
    const full = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
    }).jpeg({ quality: 90 }).toBuffer();
    res = await postUpscale(base, { name: 't.jpg', type: 'image/jpeg', data: full.subarray(0, Math.floor(full.length * 0.4)) }, { scale: '2' });
    assert.equal(res.status, 400);
    const errBody = await res.json();
    assert.doesNotMatch(errBody.error, /Vips/i);

    // invalid scale
    res = await postUpscale(base, { name: 'a.jpg', type: 'image/jpeg', data: await testImage() }, { scale: '3' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Scale must be/);

    // missing file
    res = await postUpscale(base, null, { scale: '2' });
    assert.equal(res.status, 400);

    // oversized upload
    const big = await sharp({
      create: { width: 2200, height: 2200, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
    }).png().toBuffer();
    res = await postUpscale(base, { name: 'big.png', type: 'image/png', data: big }, { scale: '2' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /4 MB/);

    // output safety limit
    const huge = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();
    res = await postUpscale(base, { name: 'huge.jpg', type: 'image/jpeg', data: huge }, { scale: '8' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /12,000 px/);

    // wrong method on a known route
    res = await fetch(`${base}/api/upscale`);
    assert.equal(res.status, 405);

    // unknown api route
    res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('rate limiter returns 429 after the configured burst', async () => {
  const { server, base } = await startServer({ rateLimitPerMinute: 3 });
  try {
    const img = { name: 'a.jpg', type: 'image/jpeg', data: await testImage() };
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await postUpscale(base, img, { scale: '2' });
      statuses.push(res.status);
      // drain body so sockets free up
      await res.arrayBuffer();
    }
    assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
    assert.equal(statuses[3], 429);
    assert.equal(statuses[4], 429);
  } finally {
    server.close();
  }
});
