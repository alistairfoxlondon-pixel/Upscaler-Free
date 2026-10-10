# Open-Source Upscaling Research, Quality Audit & License Matrix

Audit date: **2026-10-10**. Upstream repository metadata, licenses, and runtime constraints were verified against GitHub and official brand/platform documentation. Code licenses do **not** automatically license pretrained model checkpoints, training datasets, or corporate brand assets; each must be verified independently.

---

## 1. Internal Codebase & Image-Pipeline Audit (Root-Cause Findings)

Before adding features or tuning parameters, we audited the existing codebase (`b1746e59a6a3acbcfe8d6da499a7c9da6664c244`) and native `sharp` / `libvips` C++ pipeline (`node_modules/sharp/src/pipeline.cc`). Ten concrete quality, reliability, and UX issues were identified and resolved:

1. **Misleading kernel assumption (`lanczos3` on enlargement):**
   In `sharp` / `libvips`, `resize({ kernel: 'lanczos3' })` is a reduction kernel; when enlarging, `vips_resize` maps reduction kernels without a dedicated interpolator to Catmull-Rom bicubic interpolation.
2. **Half-pixel corner-convention shift (`(scale - 1) / 2`):**
   `vips_affine` defaults to corner-aligned coordinates rather than pixel-centre alignment (`x_out = scale * (x_in + 0.5) - 0.5`). Without `idx: 0.5, idy: 0.5, odx: -0.5, ody: -0.5`, every enlarged pixel grid is shifted by `(scale - 1) / 2` output pixels relative to the true pixel centres, degrading full-reference PSNR/SSIM by **>1.8 dB** at 2×.
3. **Single-chain `blur()` reordering in Sharp (`pipeline.cc` lines 435–680):**
   Calling `.blur().resize()` on a single `Sharp` instance executes `blur` **after** `resize` inside `pipeline.cc`, blurring the enlarged output instead of pre-filtering source-scale block/sensor artifacts. Pre-filtering must run in a separate source-scale stage before enlargement.
4. **Destructive default unsharp-mask overshoot & noise amplification:**
   The legacy default photo preset applied `sharpness: 45, denoise: 20, detailBoost: 50` (and the UI and server disagreed on `detailBoost`: UI sent `50`, server defaulted to `35`). Mandatory sharpening produced visible bright/dark edge halos and amplified compression artifacts. Defaults are now **faithful (`0` sharpening / `0` smoothing)**, with sharpening and noise smoothing available as explicit opt-in controls under **Fine-tune**.
5. **Border contamination during interpolation:**
   Without copy-padding (`extend({ top: 3, bottom: 3, left: 3, right: 3, extendWith: 'copy' })`) prior to affine resampling and cropping back by `3 * scale`, edge pixels blend with background zeros.
6. **Alpha-channel corruption under linear contrast (`pipeline.linear`):**
   Applying scalar `pipeline.linear(multiplier, offset)` to a 4-channel RGBA image scaled and offset the alpha channel itself, corrupting semi-transparent antialiased edges. RGBA contrast now uses per-channel `[multiplier, multiplier, multiplier, 1]` and `[offset, offset, offset, 0]`.
7. **Dedicated `pixel_art` mode:**
   Added exact integer nearest-neighbour scaling (`kernel: 'nearest'`) with `image-rendering: pixelated` in the comparison canvas so pixel art and sprites preserve razor-sharp texel boundaries without smoothing.
8. **Strict EXIF orientation & metadata stripping:**
   `.autoOrient().toColourspace('srgb')` normalizes camera orientation and embedded ICC profiles while stripping EXIF/GPS metadata from exported files.
9. **Batch concurrency, abort, and memory safety:**
   Fixed batch queue race conditions with a single batch-wide processing lock, real `AbortController` cancellation across both headers and streamed body, browser memory caps (`160 MB`), sanitized download filenames, and case-insensitive ZIP filename deduplication.
10. **Serverless payload & backpressure honesty:**
    Added per-instance fail-fast backpressure (`503 Retry-After: 3`), strict multipart field allowlists, and explicit output byte caps (`4 MB` on Vercel to respect `FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE`, `32 MB` on standalone Node).

---

## 2. 50-Image Held-Out Quality Benchmark & Neural Baseline Comparison

Full methodology, reproducible scripts (`scripts/quality/fetch.ts`, `scripts/quality/run.ts`), and per-image metrics (`docs/quality/results.csv`, `docs/quality/results.json`) are published in [docs/quality/RESULTS.md](quality/RESULTS.md).

- **Calibration vs. evaluation split hygiene:** Parameter and interpolator ablations (`bicubic`, `lbb`, `nohalo`) were conducted on **10 validation photographs** from `BSDS500/data/images/val`. The **50 evaluation photographs** come from the disjoint `BSDS500/data/images/test` split (every 4th lexicographically sorted test image, pinned by commit `a04b7c6c3a9f0ace74bf205c72a43d32e1c72722` and SHA-256 in `scripts/quality/manifest.json`).
- **Summary across 50 held-out test photographs (250 paired cases, 500 outputs):**

| Scenario | Legacy PSNR (dB) | v2.0 NoHalo PSNR (dB) | Δ PSNR (dB) | Legacy SSIM | v2.0 NoHalo SSIM | PSNR Wins | SSIM Wins |
|---|---:|---:|---:|---:|---:|---:|---:|
| `clean-2x` | 26.104 | **28.027** | **+1.923** | 0.8085 | **0.8389** | **50 / 50** | **50 / 50** |
| `clean-4x` | 23.924 | **24.201** | **+0.277** | 0.6389 | **0.6450** | **50 / 50** | **46 / 50** |
| `clean-8x` | 21.755 | **21.852** | **+0.098** | 0.5034 | **0.5080** | **49 / 50** | **48 / 50** |
| `jpeg-4x` | 23.227 | **23.472** | **+0.246** | 0.5746 | **0.5830** | **50 / 50** | **50 / 50** |
| `noise-4x` | 23.514 | **23.818** | **+0.304** | 0.5889 | **0.6041** | **50 / 50** | **48 / 50** |

### Why CPU `@upscalerjs/esrgan-slim` (RDN) was rejected after empirical testing

We benchmarked `@upscalerjs/esrgan-slim` (1.0.0, MIT, a lightweight Residual Dense Network with `C=1, D=2, G=4, G0=64`, `[0, 255]` input/output range) under `@tensorflow/tfjs-backend-wasm` on the validation split against our centre-aligned `libvips` NoHalo pipeline:

- **Latency:** `@upscalerjs/esrgan-slim` required **679–816 ms** per 240×160 → 480×320 image (**~12× slower** than `libvips` NoHalo at ~54–63 ms), and scales quadratically to several seconds on megapixel inputs—risking serverless timeouts on CPU-only functions.
- **Fidelity:** On the validation images, `libvips` NoHalo matched or outperformed `esrgan-slim` in PSNR/SSIM at 2× while introducing zero neural checkerboard or hallucination artifacts.
- **Decision:** We do **not** ship a slow tiny CPU network just to claim “AI super-resolution.” OpenUpscale ships the faster, higher-fidelity `libvips` NoHalo pipeline and clearly states that it performs deterministic resampling rather than generative detail synthesis.

---

## 3. Open-Source Ecosystem & License Audit

| Project / Resource | Upstream Repository | Verified License | Technical Role & Deployment Finding |
|---|---|---|---|
| **Sharp** | [lovell/sharp](https://github.com/lovell/sharp) | `Apache-2.0` | **Selected production engine (`0.35.5`).** Streams and processes images in native C/C++ memory via `libvips`. |
| **libvips** | [libvips/libvips](https://github.com/libvips/libvips) | `LGPL-2.1` | **Selected native core (`8.18.7`).** Provides Nicolas Robidoux’s **NoHalo** Locally Bounded Bicubic/bilinear subdivision interpolator (`vips_interpolate_nohalo`). |
| **SPAN** | [hongyuanyu/SPAN](https://github.com/hongyuanyu/SPAN) | `Apache-2.0` (repo) — *audit third-party notices* | CVPR 2024 NTIRE Efficient SR winner (Swift Parameter-free Attention Network). Excellent candidate for a dedicated ONNX/TensorRT GPU worker; note third-party notices in repo (`BasicSR` derivatives). |
| **SPANPlus** | [umzi2/SPANPlus](https://github.com/umzi2/SPANPlus) | `Apache-2.0` | Cleaned PixelShuffle / DySample modernization of SPAN (`spanplus-sts` / `spanplus-st`). Good lightweight architecture for a future GPU/ONNX worker. |
| **Real-ESRGAN** | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | `BSD-3-Clause` | Strong blind photo/anime restoration (`RealESRGAN_x4plus`, `realesr-general-x4v3`). Requires tiled GPU worker (PyTorch or ncnn/Vulkan); too heavy for CPU serverless functions. |
| **SwinIR** | [JingyunLiang/SwinIR](https://github.com/JingyunLiang/SwinIR) | `Apache-2.0` | High-quality shifted-window transformer SR. High memory/compute footprint; suited only to dedicated GPU workers. |
| **Spandrel** | [chaiNNer-org/spandrel](https://github.com/chaiNNer-org/spandrel) | `MIT` | PyTorch model architecture loader supporting SPAN, SwinIR, ESRGAN, Real-ESRGAN, HAT, and OmniSR for Python GPU workers. |
| **waifu2x-ncnn-vulkan** | [nihui/waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) | `MIT` | Fast native anime/illustration upscaler via `ncnn` and Vulkan; requires GPU/Vulkan device unavailable on Vercel Node functions. |
| **ONNX Runtime** | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | `MIT` | Portable runtime for exported SR graphs; `onnxruntime-node` unpacked binary size (~301 MB) exceeds Vercel’s 250 MB uncompressed function bundle limit. |
| **UpscalerJS / ESRGAN-Slim** | [thekevinscott/UpscalerJS](https://github.com/thekevinscott/UpscalerJS) | `MIT` | Evaluated empirically on CPU WASM; 12× slower than `libvips` NoHalo without beating its 2× PSNR/SSIM. Not bundled in production. |
| **GFPGAN** | [TencentARC/GFPGAN](https://github.com/TencentARC/GFPGAN) | `Apache-2.0` (with non-commercial third-party components) | Face restoration only; depends on BasicSR/facexlib and StyleGAN2 components that carry separate terms, and can alter facial identity. Excluded. |
| **CodeFormer** | [sczhou/CodeFormer](https://github.com/sczhou/CodeFormer) | **S-Lab License 1.0 (Non-Commercial)** | **Incompatible with commercial/MIT redistribution.** Strictly excluded. |
| **Upscayl** | [upscayl/upscayl](https://github.com/upscayl/upscayl) | `AGPL-3.0` | Copyleft desktop GUI orchestrating local `ncnn` binaries. Incompatible with MIT without relicensing; zero code copied. |
| **chaiNNer** | [chaiNNer-org/chaiNNer](https://github.com/chaiNNer-org/chaiNNer) | `GPL-3.0` | Copyleft node-graph image processing GUI. Incompatible with MIT without relicensing; zero code copied. |
| **BSDS500** | [BIDS/BSDS500](https://github.com/BIDS/BSDS500) | Academic benchmark (Arbelaez et al., IEEE TPAMI 2011; no SPDX file) | Used **only** in ignored `.cache/` for local 50-image quality benchmarking; zero BSDS500 images are committed or redistributed. |

---

## 4. Typography & Brand-Font Provenance (Telenor / Grameenphone)

Per the official [Telenor Brand Typography Guidelines](https://brand.telenor.com/group/identity/font):
- Telenor Group (including Grameenphone) uses the bespoke proprietary typeface **Telenor Evolution** (and previously **Telenor**), distributed through Telenor’s internal AssetBank for authorized brand use. Third-party font-download sites hosting `Telenor-Regular.ttf` / `.otf` are unauthorized extractions and cannot be legally bundled in an MIT open-source repository.
- Telenor’s official typography specification explicitly designates **DM Sans** as its open webfont alternate and **Arial** as its system alternate.
- OpenUpscale therefore configures:
  1. `@font-face` (`Telenor Local`) referencing `local('Telenor Evolution UI')`, `local('Telenor Evolution')`, and `local('Telenor')` so systems with the official Telenor/Grameenphone typeface installed render it natively with zero network requests.
  2. Self-hosted open-source **DM Sans Variable** (`@fontsource-variable/dm-sans`, SIL Open Font License 1.1) and `Arial, sans-serif` as the Telenor-specified open fallback stack.
