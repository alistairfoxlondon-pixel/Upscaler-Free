# OpenUpscale

A free, accountless, open-source **cloud image upscaler**. Images are processed by a Node.js function with Sharp/libvips; no image processing runs in the browser. The server does not write uploads or outputs to disk and releases request buffers after returning each result.

> **Capability statement:** OpenUpscale provides deterministic Lanczos-3 enlargement with content-aware enhancement (automatic photo / art / text tuning). It is not Real-ESRGAN and does not claim to reconstruct detail with a neural network. See [the research audit](docs/RESEARCH.md) for reviewed model options and the GPU upgrade path.

## Features

- 2×, 4×, 8× cloud enlargement with per-image safety limits
- **Auto mode** — classifies each image (photo, art/line, document, flat) and applies benchmark-tuned sharpening and denoise per class
- Photo, Art/Anime, and Text presets, or full manual fine-tuning
- Denoise, sharpness, detail, contrast, brightness, saturation, quality
- PNG, progressive JPG (mozjpeg, 4:4:4), and WebP output; EXIF orientation fixed; **ICC color profiles preserved**
- Sequential batch processing up to 20 images with client-side ZIP export
- Paste (Ctrl+V), drag & drop, and sample benchmarks; settings persist locally
- Rate-limited API, 55-second client timeout, clean JSON errors (no engine jargon, no 500 leaks)
- No accounts, cookies, analytics, database, object storage, or temporary files
- Responsive light UI with split/side-by-side/1:1-pixel comparison and full-screen review
- Vercel API function (with automatic fallback when results exceed the platform's 4.5 MB response limit) and standalone Node server from one shared core

## Quick start

Requirements: Node.js 20 or newer.

```bash
npm install
npm run check
npm run dev
```

Open <http://localhost:3000>.

## Vercel deployment

```bash
npm i -g vercel
vercel --prod
```

No environment variables are required. `vercel.json` selects Vite; files under `api/` become Node.js functions. Vercel caps **both request and response payloads at 4.5 MB**, so the input limit is 4 MB and oversized outputs on Vercel are re-encoded to the largest lossy format that fits (or rejected with a clear message). Self-hosting removes the response cap — only the 12,000 px / 64 MP processing limits remain.

## API

```bash
curl -sS https://your-domain.example/api/upscale \
  -F file=@input.jpg \
  -F scale=2 \
  -F preset=auto \
  -F format=webp \
  -F quality=92 \
  --output enhanced.webp
```

The successful body is image binary. The `X-Upscale-Metadata` response header is base64url-encoded JSON (dimensions, sizes, timing, applied preset, detected `contentKind`). Invalid requests return JSON with an `error` field and a correct HTTP status (400/405/429).

Fields: `scale` (2, 4, 8), `preset` (`auto`, `photo`, `digital_art`, `anime`, `document`, `custom`), `format` (`png`, `jpg`, `webp`), `quality` (70–100). Omitting `sharpness`/`denoise`/`detailBoost` applies the tuned benchmark defaults for the chosen preset; supplying them (with `preset=custom`) overrides. `contrast`, `brightness`, `saturation` take −50…50 and always apply. `GET /api/system-status` reports live engine versions and limits.

## Quality methodology

Defaults are not vibes. `npm run bench` generates a deterministic 50-image corpus (photos, portraits, documents, line art, textures; JPEG/PNG/WebP/GIF/TIFF, 16-bit, EXIF rotations, alpha), runs the real pipeline across a settings matrix, and reports round-trip PSNR/SSIM, deviation from a pure Lanczos reference, sharpness delta, clipping, and latency (`qa/report.json`, gitignored). The shipped enhancement curves were swept against these metrics: they net **sharper than plain resizing on photos** while **not clipping** on documents — the previous defaults clipped ~5% of document pixels and left a dead zone where denoise 0–15 did literally nothing (libvips rounds small Gaussian sigmas to identity).

## Privacy model

The browser uploads one image at a time over HTTPS. The function holds input and output only in RAM for that request, streams the result, and retains no server copy. The returned Blob remains in the user's browser tab so it can be previewed or downloaded; removing an item or clearing the queue revokes its Blob URL. On Vercel, function instances are ephemeral; memory lifecycle is ultimately governed by the hosting platform. The UI self-hosts its font (no Google Fonts / CDN requests).

## Architecture

`server/upscaler.ts` is the single processing core for both deployment modes; `server/presets.ts` holds the constants shared with the browser (limits, preset values) so UI and engine can never drift; `server/app.ts` builds the Express app (standalone server) with the Vercel functions in `api/` delegating to the same core. Pipeline: validate → auto-classify content → EXIF-orient + keep ICC → light artifact smoothing → Lanczos-3 resize → content-aware unsharp mask → color ops → encode (WebP drops to a faster effort above 16 MP, halving multi-gigapixel encode time at measured-identical fidelity).

## Tests

```bash
npm run lint   # strict TypeScript over server, api, and client
npm test       # 19 unit + HTTP integration tests (node:test)
npm run build  # production bundle
npm run bench  # optional: 50-image quality benchmark (slow, writes qa/)
```

## License

Application code is [MIT licensed](LICENSE). Dependencies and optional models keep their own licenses; see [docs/RESEARCH.md](docs/RESEARCH.md).
