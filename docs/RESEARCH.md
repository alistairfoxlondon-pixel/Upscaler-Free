# Open-source upscaling research and deployment audit

Audit dates: 2026-10-09 (initial), 2026-10-09 (re-audit with quality benchmark). Repository metadata and licenses were checked against the linked upstream GitHub repositories. A model's code license does not automatically license every checkpoint, training dataset, generated output, trademark, or bundled dependency; production adopters must verify the exact weight files they deploy.

## Decision summary

A stock Vercel Node function is a CPU runtime with deployment, request, response, memory, and duration constraints. Shipping PyTorch/CUDA plus neural weights inside it is neither reliable nor GPU accelerated. This project therefore selects **Sharp/libvips** for a genuinely deployable baseline and clearly labels it as high-quality resampling rather than AI super-resolution. All processing is in the cloud; there is no client inference code.

For neural detail reconstruction, the recommended production architecture is: Vercel UI/API coordinator → authenticated GPU worker → short-lived object storage → one-time download/TTL deletion. That architecture is not "free infrastructure," even though every software component can be open source.

## Quality benchmark (this re-audit)

`npm run bench` builds a deterministic 50-image corpus (5 content classes; JPEG/PNG/WebP/GIF/TIFF, 16-bit, EXIF orientation, alpha) and evaluates the real pipeline on a config matrix. Findings that changed the engine:

| Finding | Evidence | Fix shipped |
|---|---|---|
| Default settings clipped ~5% of pixels to pure white/black on documents (hard halos on text) | `clipΔ +5.05%` mean on document class, up to +9.8% per file; overshoot caps were unbounded in practice (y2/y3 ignored m1/m2 tuning) | Content-aware sharpen profiles with capped overshoot (y2 5–6 / y3 10–12); clipΔ now ≤1% everywhere, ≈0 on documents |
| Denoise 0–15 was a **silent no-op** — libvips rounds a 3×3 Gaussian kernel to identity below σ≈0.6 | Output buffers byte-identical for σ<0.6; old default (20 → σ0.41) did nothing | Blur curve starts at σ=0.6; every slider value >0 measurably changes output (regression-tested) |
| ICC color profiles stripped on every export (wide-gamut photos shift color) | `hasProfile: true → false` for all formats; even `pure sharp resize + save` drops profiles unless `keepIccProfile()` is called | `keepIccProfile()` when the input carries a profile ≤512 KB; verified for JPG/PNG/WebP |
| WebP encoding dominates latency at very large outputs (34.6 s at 64 MP vs 4 s resize) | Effort sweep: effort 2 = 13.9 s, effort 3/4 ≈ 35 s, identical PSNR (30.86 dB), +3.4% bytes | WebP effort auto-drops to 2 above 16 MP output; worst-case 8× latency ≈41 s → ≈9–12 s, staying under the 55 s client timeout |
| `dataUrl` base64 in the API result doubled memory for 100 MB+ outputs and no client used it | 64 MP PNG = 150 MB buffer; base64 adds ~200 MB | Removed from the server result; responses stream binary only |
| Truncated JPEGs returned HTTP **500** with raw `VipsJpeg` text | `failOn: 'error'` does not reject all truncations in this libvips; error string leaked through status guesswork | Typed `UpscaleError` (status carried, not regex-guessed); all decode/encode failures become clean 400s; corrupt-input tests added |
| The client always sent `sharpness/denoise/detailBoost`, so named presets never applied their tuned defaults | Values overrode server preset defaults | Client omits enhancement fields unless in Custom mode; server defaults win; constants shared via `server/presets.ts` |
| `system-status` hardcoded "Sharp 0.34" while 0.35.5 / libvips 8.18.7 were installed | `sharp.versions` | Live `sharp.versions.sharp`/`vips` reported; API/Express test asserts not-hardcoded |
| Fully-opaque alpha "disappeared" in WebP outputs | Not a bug: libvips drops a 4th channel that is 255-everywhere when saving WebP (lossless, smaller). Real transparency verified preserved | Benchmark tolerates it; explicit regression test added |
| Vercel limits **response** payloads to 4.5 MB like requests | Official function limits doc; a 64 MP PNG response (100 MB+) cannot ship on Vercel at all | `api/upscale.ts` re-encodes oversized results (PNG→WebP→JPG, bounded quality steps) under 4.4 MB on Vercel and fails with a clear, actionable message otherwise; self-host keeps unlimited output |

Benchmark matrix after fixes (means over 50 images): `dims=OK alpha=OK` on all eight configs; round-trip PSNR 34.1–39.7 dB (higher = closer to the source after downscale — within WebP q92's own loss), sharpness Δ vs plain Lanczos +32..+38 on photos (intentionally net-sharper), ~0 on documents/lineart with clipping ≤1% (halo-safe), color deviation ≤2.2/255, 8× 64 MP end-to-end ≈3.1 s in this sandbox.

## Project audit

| Project | License reported upstream | Strength | Deployment finding |
|---|---|---|---|
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD-3-Clause (code; some third-party blogs wrongly say Apache-2.0 — trust the repo LICENSE) | Strong practical blind photo restoration; RRDBNet models and anime variant | Recommended first GPU backend. [realesrgan-ncnn-vulkan](https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan) is MIT. Third-party measurements show ~2–5 s per 1080p 4× upscale on a modern RTX GPU with ~2 GB VRAM tiled — fine behind a worker, impossible in a Vercel CPU function. Tiling is required for bounded VRAM. |
| [SwinIR](https://github.com/JingyunLiang/SwinIR) | Apache-2.0 | Excellent classical/lightweight/real-world SR variants | High quality, but transformer inference is slower and memory-heavier. Better for a dedicated GPU service. |
| [waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) | MIT | Mature illustration/anime denoise and scaling; measured ~182 MB VRAM and best-in-class edge SSIM on pixel art (0.921 vs Real-ESRGAN animev3 0.784) | Great specialized worker for the Art mode; requires native ncnn/Vulkan support unavailable on Vercel serverless. |
| [GFPGAN](https://github.com/TencentARC/GFPGAN) | custom/no SPDX assertion in GitHub metadata | Face restoration | Optional face pass only, not a general upscaler. Can alter identity, so it must be opt-in with disclosure. |
| [CodeFormer](https://github.com/sczhou/CodeFormer) | custom/no SPDX assertion in GitHub metadata | Controllable face restoration fidelity | Optional opt-in face restoration. Heavier; can change facial details. Review weights separately. |
| [Upscayl](https://github.com/upscayl/upscayl) | AGPL-3.0 (also its `upscayl-ncnn` backend) | Polished desktop reference | Copyleft and local-GPU focused. **Do not copy code**; use upstream MIT/BSD projects for a worker. No source copied here. |
| [chaiNNer](https://github.com/chaiNNer-org/chaiNNer) | GPL-3.0 | Broad model/runtime workflow reference | Research reference only; GPL compatibility must be evaluated before reuse. No source copied here. |
| [Sharp](https://github.com/lovell/sharp) | Apache-2.0 | Fast, streaming-friendly libvips resize/encode with low memory | **Selected baseline.** 0.35.5 / libvips 8.18.7 vendored; native binaries deploy on Vercel. Interpolation/enhancement, not neural reconstruction. |
| [ONNX Runtime](https://microsoft.github.io/onnxruntime/) / [ort](https://github.com/pygitee/ort-rs) | MIT | Portable inference | Best future CPU/GPU adapter: Real-ESRGAN `.pth` → ONNX (dynamic H/W axes) → tiled inference; CPU EP is viable for small tiles, GPU EPs optional. |

Also relevant: [BasicSR](https://github.com/XPixelGroup/BasicSR) (Apache-2.0) training/inference foundations, [ncnn](https://github.com/Tencent/ncnn) (BSD-3-Clause) compact native inference, and note that Real-ESRGAN's model weights come with their own terms distinct from the code license.

## Platform constraints verified (Vercel, 2026)

- Request **and** response bodies: 4.5 MB hard limit, not configurable; streaming does not lift it for Node functions. Input capped at 4 MB; oversized outputs re-encoded with bounded fallback (see table).
- Hobby functions: 1024 MB class memory, `maxDuration` up to 300 s; repo pins 60 s which comfortably covers the measured worst case (≈12 s after the WebP effort fix, pre-fix 8× PNG worst paths approached the client timeout).
- Ephemeral instances: per-instance rate limiting is best-effort by design; a shared limiter would need Vercel KV — intentionally out of scope for a no-database privacy stance.

## Quality trade-offs

- **Lanczos-3** preserves edges/frequency content better than bilinear/nearest but cannot recover missing semantic detail.
- **Unsharp masking** improves perceived clarity; unbounded overshoot clips whites/blacks and halos text — capped per content class here (measured above).
- **Pre-resize smoothing** reduces JPEG blocks but erases fine texture; it now starts at the smallest non-identity sigma and scales with the slider.
- **Real-ESRGAN** synthesizes plausible texture and suppresses real degradation but may hallucinate detail; on continuous-tone data it can inject cloud-like noise into skies and break palette-indexed pixel art — a waifu2x-style model is safer for the Art mode.
- **Face restoration** can materially change identity: never run silently as part of a generic photo preset.
- 8× multiplies pixels by 64; output dimension, megapixel, and response-size limits are all load-bearing.
- WebP `smartSubsample` + q≥92 + 4:4:4-where-supported is near-visually-lossless for upscaled photos at ~6–10× the size of PNG; PNG remains for edit-round-trip use.

## Reliability and security checklist implemented

- Multipart binary upload (lower memory/bandwidth than base64); byte limit enforced in browser and server.
- Decoded-input pixel limit (40 MP) and output dimension/megapixel limits checked before allocation; client-side pre-flight mirrors them with actionable messages.
- Explicit allowlists for scale/format/preset; numeric controls clamped; typed errors carry HTTP status.
- Corrupt/truncated input fails closed with a user-readable 400 (never a 500 or engine jargon); EXIF-orient + ICC-preserving pipeline is deterministic.
- Per-IP sliding-window rate limiter on the standalone server (env-configurable; per-instance best-effort on serverless).
- Sequential browser batches prevent concurrent memory spikes; chunked streaming responses race `close` so disconnects cannot hang handlers.
- No user filenames in server paths; no filesystem writes; `no-store`, `nosniff`, referrer/permissions headers; SPA fallback + 405 on wrong method for known routes.
- Blob URLs revoked on replace/remove/clear; processing results are dropped if the item was removed mid-flight.
- No remote-URL ingestion (no SSRF); no accounts, cookies, analytics, database, or persistent storage; self-hosted font, zero third-party requests.
- 19 automated tests: pipeline semantics (orientation swap, alpha, ICC, clipping-adjacent sharpen params, dead-zone regression, limits) + HTTP surface (status codes, headers, rate limit).

## Constraints and recommended next phase

1. Deploy a containerized Real-ESRGAN worker (ncnn or ONNX) on a GPU host with pinned code and checkpoint hashes; waifu2x pass for anime/pixel content; expose via an authenticated internal API.
2. Never expose an unmetered GPU endpoint directly; queue with backpressure and per-user budget.
3. Encrypted inputs/results in lifecycle-managed object storage (short TTL, one-time signed URLs) so responses are not bound by function payload caps.
4. Tile inference with overlap to control VRAM; select tile size from worker memory.
5. Keep Sharp as fallback, encoder, orientation/ICC normalizer, and alpha handler.
6. Golden-image tests now exist (`npm run bench`, PSNR/SSIM/clip/sharpness metrics); extend with a fixed corpus checked into LFS and CI thresholds (e.g., document clipΔ ≤1%).
7. Add abuse controls beyond the local limiter (CAP-free per-IP at the edge, proof-of-work, or paid plan), structured logs without image content, and Content-Signature/provenance for any model served.
8. Publish exact model names, checkpoint hashes, licenses, and provenance in the UI when a neural path ships.

## Resource notes

No upstream source code or model weights were copied into this repository. Runtime production dependencies are listed in `package.json`; license notices remain with those packages. The UI uses [Lucide](https://github.com/lucide-icons/lucide) icons (ISC), [JSZip](https://github.com/Stuk/jszip) (MIT), and [Hanken Grotesk Variable via @fontsource](https://fontsource.org) (SIL OFL 1.1) as the locally-hosted stand-in for Telenor's proprietary "Gramophone" brand face — the CSS `@font-face` picks up a genuine Gramophone automatically when a visitor has it installed. Batch archives are produced entirely client-side. The corpus generator and metrics in `scripts/quality-benchmark.mts` are original code for this project's tuning (MIT).
