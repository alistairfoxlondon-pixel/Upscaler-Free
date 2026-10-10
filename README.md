# OpenUpscale

**Small image. Big potential.** A privacy-conscious image upscaler with one clear output: JPEGs with title and keywords embedded as XMP metadata.

## What it does

- Upscales photos, illustrations, documents and pixel art with colour-managed Sharp/libvips resampling. The faithful engine adds pixels but does not invent detail; use the comparison preview to judge the result.
- Optional **Real-ESRGAN x4plus** neural restoration runs only through a separately deployed, authenticated GPU worker. It is not active unless `REAL_ESRGAN_URL` and `REAL_ESRGAN_API_KEY` are configured.
- Keeps text and pixel-art edges on the faithful engine. Documents use gentle edge sharpening; pixel art uses nearest-neighbour scaling.
- Generates image-specific Adobe Stock title/keyword suggestions on upload only when a server-side vision provider is configured. Without one, metadata starts blank—there are no filename or colour guesses.
- Exports JPEG only. The title and keywords are embedded in each JPEG's Adobe XMP fields; batch downloads are ZIPs containing metadata-bearing JPEGs. No CSV or metadata sidecar is produced.
- Supports a 20-image queue, comparison preview, keyboard controls, and no persistent image storage by the app.

AI-generated metadata may still be inaccurate. Review the image, title and keywords before commercial use. AI upscaling can synthesize plausible but false detail.

## Quick start

Requirements: Node.js 20+.

```bash
npm ci
npm run check
npm run dev
```

Open <http://localhost:3000>.

## Enable Real-ESRGAN AI

Vercel/ordinary Node serverless functions are not a suitable home for the official PyTorch model and CUDA GPU. Deploy the private worker separately using [worker/README.md](worker/README.md), then set these **server-only** environment variables on the OpenUpscale API:

```dotenv
REAL_ESRGAN_URL=https://your-private-worker.example
REAL_ESRGAN_API_KEY=<same long random secret as the worker>
```

The worker loads the `RealESRGAN_x4plus` checkpoint, tiles inference to limit GPU memory, supports 2×/4×/8× output, and does not persist uploaded images. The app exposes the Real-ESRGAN option only when both server credentials are set and the worker's authenticated health check reports the model ready. A later worker failure returns an error rather than silently labelling a classic result as AI. Keep the worker private and set the same secret on both services. Review checkpoint and training-data terms before commercial use.

Without a deployed worker, the AI option is unavailable; faithful resampling continues to work.

## Adobe Stock workflow

1. Add an image and upscale it.
2. Review the title and keywords. When metadata AI is configured, suggestions are generated on upload; otherwise the fields stay blank so no unverified subject is invented. You can edit the fields yourself.
3. Choose **Download JPEG**. The JPEG contains the title and keywords in its XMP metadata. Transparency, if present, is flattened to white.

When enabled, image-specific metadata uses the server-configured vision provider. The upload is resized, orientation-normalized, converted to sRGB, flattened to white and stripped of source metadata before the provider call. Configure and disclose provider use before deployment; hosting and provider data/cost terms apply. Always verify metadata and releases yourself. The app does not upload to Adobe Stock.

Optional server-side metadata configuration:

```dotenv
OPENAI_API_KEY=<server-only key>
STOCK_METADATA_MODEL=gpt-4o-mini
```

Without `OPENAI_API_KEY`, AI metadata generation is unavailable and no image captions are fabricated. Keep this credential server-only; never use a `VITE_` prefix.

## HTTP API

### `POST /api/upscale`

Accepts one `file` and settings in multipart form-data. The browser uses high-quality WebP for the internal preview (lossless WebP for text and pixel art) to stay compact; JSON processing metadata is returned in `X-Upscale-Metadata`. The final download is always a JPEG with XMP metadata. Vercel responses are capped at 4 MiB; an output that exceeds this limit receives a clear `413 OUTPUT_BYTE_LIMIT` instead of an oversized/truncated response. For unusually detailed or lossless images, try a smaller input or scale.

### `POST /api/stock-metadata`

Accepts one `file` in multipart form-data. Requires `OPENAI_API_KEY`. The web app calls this automatically after an image is added when the vision service is configured; the response contains an editable title and keywords.

### `POST /api/stock-export`

Accepts an upscaled `file`, `title` and JSON-encoded `keywords` in multipart form-data. Returns a JPEG with XMP title/keywords embedded. Transparency is flattened to white. The output is subject to the host's response-size limit.

### `GET /api/system-status`

Returns library versions, deployment limits, and whether the optional Real-ESRGAN and vision-metadata services are configured. It never returns credentials.

Images are processed in memory. Deployment hosts and explicitly configured external providers still have their own policies and limits.

## Quality research and licensing

- The deterministic classic engine has a reproducible 50-image held-out BSDS500 benchmark. Results measure fidelity on synthetic degradations, not subjective image quality or recovered detail: [report](docs/quality/RESULTS.md).
- Real-ESRGAN is an optional GPU-backed mode, not a fake serverless promise. Review the upstream model and checkpoint terms independently before commercial use. See [research and license notes](docs/RESEARCH.md) and [worker deployment](worker/README.md).
- Code is MIT licensed. Open-source code licenses do not automatically grant rights to source photographs, model checkpoints, fonts or output content.

## Verification

```bash
npm run lint
npm test
npm run build
npm run check
```
