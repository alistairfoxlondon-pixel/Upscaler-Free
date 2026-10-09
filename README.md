# OpenUpscale

A free, accountless, open-source **cloud image upscaler**. Images are processed by a Node.js function with Sharp/libvips; no image processing runs in the browser. The server does not write uploads or outputs to disk and releases request buffers after returning each result.

> **Capability statement:** OpenUpscale currently provides high-quality deterministic Lanczos-3 enlargement and configurable enhancement. It is not Real-ESRGAN and does not claim to reconstruct detail with a neural network. See [the research audit](docs/RESEARCH.md) for the reviewed model options and a GPU upgrade path.

## Features

- 2×, 4×, and 8× cloud enlargement
- Photo, anime/art, and document presets
- Denoise, sharpness, detail, contrast, brightness, and saturation controls
- PNG, progressive JPG, and WebP output
- Sequential batch processing for up to 20 images and ZIP download
- Retryable errors, 55-second client timeout, decoded-pixel and output safety limits
- No accounts, cookies, analytics, database, object storage, or temporary files
- Responsive Material-inspired interface and accessible keyboard/dialog behavior
- Vercel API function and standalone Node server from the same processing core

## Quick start

Requirements: Node.js 20 or newer.

```bash
npm install
npm run check
npm run dev
```

Open <http://localhost:3000>.

## Vercel deployment

Import this repository in Vercel or run:

```bash
npm i -g vercel
vercel --prod
```

No environment variables are required. `vercel.json` selects Vite; files under `api/` become Node.js functions. The 4 MB per-image limit is intentional and leaves request-envelope headroom. Output dimensions are capped at 12,000 pixels per side and 64 megapixels.

## API

```bash
curl -sS https://your-domain.example/api/upscale \
  -F file=@input.jpg \
  -F scale=2 \
  -F preset=photo \
  -F format=webp \
  -F quality=92 \
  --output enhanced.webp
```

The successful body is image binary. The `X-Upscale-Metadata` response header is base64url-encoded JSON. Invalid requests return JSON with an `error` field.

Fields: `scale` (2, 4, 8), `preset` (`photo`, `anime`, `digital_art`, `document`, `custom`), `format` (`png`, `jpg`, `webp`), `quality` (70–100), `sharpness` and `denoise` and `detailBoost` (0–100), and `contrast`, `brightness`, `saturation` (-50–50).

## Privacy model

The browser uploads one image at a time over HTTPS. The function holds input and output only in RAM for that request, streams the result, and retains no server copy. The returned Blob remains in the user's browser tab so it can be previewed or downloaded; removing the item or clearing the queue revokes that Blob URL. On Vercel, function instances are ephemeral, but memory lifecycle is ultimately governed by the hosting platform.

## Quality and architecture

`server/upscaler.ts` is the single processing core used by both deployment modes. It validates options, applies EXIF orientation, lightly smooths compression artifacts, resizes with Lanczos-3, applies bounded enhancement, and encodes the selected format. This is predictable and serverless-friendly, but cannot invent texture that is absent in the source. A true neural backend should run Real-ESRGAN/SwinIR on a separate GPU worker and use object storage or streaming for large results.

## Tests

```bash
npm run lint
npm test
npm run build
# or all three
npm run check
```

## License

Application code is [MIT licensed](LICENSE). Dependencies and optional models keep their own licenses; see [docs/RESEARCH.md](docs/RESEARCH.md).
