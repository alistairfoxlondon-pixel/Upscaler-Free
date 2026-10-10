# OpenUpscale

**Small image. Big potential.**  
A free, privacy-first, open-source cloud image upscaler built for **Vercel** and **Node.js**.

> **Honest capability statement:** OpenUpscale enlarges images up to **8×** using colour-managed, centre-aligned **libvips NoHalo** resampling (`sharp 0.35.5` / `libvips 8.18.7`) and exact nearest-neighbour scaling for pixel art. It preserves natural edges and transparency without inventing fake details or claiming to be a neural GAN. See the [Open-Source Research & License Audit](docs/RESEARCH.md) and the [50-Image Quality Benchmark](docs/quality/RESULTS.md).

---

## Highlights

- **Measured Quality Improvement:** Validated across **50 distinct held-out test photographs** (250 paired test cases, 500 outputs) across `clean-2x`, `clean-4x`, `clean-8x`, `jpeg-4x`, and `noise-4x`, improving 2× PSNR by **+1.923 dB** (50/50 wins) and SSIM by **+0.0304** (50/50 wins) over the legacy pipeline.
- **Faithful by Default:** Zero mandatory oversharpening or pre-blur; optional **Sharpness**, **Smooth noise**, **Brightness**, **Contrast**, and **Saturation** live inside a progressive-disclosure **Fine-tune** drawer.
- **Dedicated Modes:** **Photo & art** (centre-aligned NoHalo with copy-padded borders) and **Pixel art** (crispy integer nearest-neighbour).
- **Alpha & Colour Accuracy:** Normalizes EXIF orientation to sRGB, strips EXIF/GPS metadata, preserves semi-transparent alpha across PNG/WebP and contrast adjustments, and warns when JPG flattens transparency to white.
- **Calm Nordic Telecom UI/UX:** High-craft light workspace using Telenor/Grameenphone-aligned typography (`local('Telenor Evolution UI')`, `local('Telenor')`, self-hosted `DM Sans Variable`, `Arial`), concise copy, keyboard-accessible comparison slider (`Fit` / `100%` actual-pixel zoom), and **zero WCAG 2.1 AA axe violations**.
- **Batch Queue & Instant ZIP:** Queue up to 20 images (4 MB each), cancel in-flight processing at any time, and download individual files or a deduplicated ZIP archive.

---

## Quick Start

Requirements: **Node.js 20+**.

```bash
npm ci
npm run check
npm run dev
```

Open <http://localhost:3000>.

---

## Reproducing the 50-Image Quality Benchmark

The repository includes a deterministic 50-image benchmark harness (`scripts/quality/fetch.ts` and `scripts/quality/run.ts`). Benchmark images are fetched into ignored `.cache/` and verified by SHA-256 against `scripts/quality/manifest.json` so third-party dataset images are never redistributed in Git.

```bash
npm run quality:fetch   # Fetches & SHA-256 verifies 50 test + 10 calibration photos into .cache/
npm run quality:test    # Runs 250 paired evaluations (500 outputs) and updates docs/quality/
```

See [docs/quality/RESULTS.md](docs/quality/RESULTS.md), [docs/quality/results.csv](docs/quality/results.csv), and [docs/quality/results.json](docs/quality/results.json) for full results.

---

## HTTP API

### `POST /api/upscale`

```bash
curl -sS http://localhost:3000/api/upscale \
  -F file=@input.jpg \
  -F scale=2 \
  -F preset=photo \
  -F format=webp \
  -F quality=92 \
  --output upscaled.webp
```

- **Request fields (`multipart/form-data`):**
  - `file` (required): Raster image up to 4 MB (`JPG`, `PNG`, `WebP`, `AVIF`, single-page `TIFF`, or still `GIF`).
  - `scale`: `2`, `4`, or `8` (default `2`).
  - `preset`: `photo`, `digital_art`, `anime`, `document`, `pixel_art`, or `custom` (default `photo`).
  - `format`: `png`, `jpg`, or `webp` (default `png`).
  - `quality`: `70`–`100` (default `95`; `100` enables lossless WebP).
  - `sharpness`, `denoise`, `detailBoost`: `0`–`100` (default `0`).
  - `contrast`, `brightness`, `saturation`: `-50`–`50` (default `0`).
- **Response:** Binary image stream (`image/png`, `image/jpeg`, or `image/webp`) with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and base64url-encoded JSON metadata in `X-Upscale-Metadata`.

---

## Verification & Tests

```bash
npm run lint    # TypeScript strict type-checking
npm test        # Pipeline, API, alpha/orientation, 50-image report gate, and live Chromium + Axe WCAG 2.1 AA E2E suite
npm run build   # Production Vite bundle
npm run check   # Runs lint + test + build
```

## License

Code is released under the [MIT License](LICENSE). See [docs/RESEARCH.md](docs/RESEARCH.md) for third-party dependency, model, dataset, and typography licensing details.
