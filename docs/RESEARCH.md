# Open-source upscaling research and deployment audit

Audit date: 2026-10-09. Repository metadata and licenses were checked against the linked upstream GitHub repositories. A model's code license does not automatically license every checkpoint, training dataset, generated output, trademark, or bundled dependency; production adopters must verify the exact weight files they deploy.

## Decision summary

A stock Vercel Node function is a CPU runtime with deployment, request, response, memory, and duration constraints. Shipping PyTorch/CUDA plus neural weights inside it is neither reliable nor GPU accelerated. This project therefore selects **Sharp/libvips** for a genuinely deployable baseline and clearly labels it as high-quality resampling rather than AI super-resolution. It performs all processing in the cloud and has no client inference code.

For neural detail reconstruction, the recommended production architecture is: Vercel UI/API coordinator → authenticated GPU worker → short-lived object storage → one-time download/TTL deletion. That architecture is not “free infrastructure,” even though every software component can be open source.

## Project audit

| Project | License reported upstream | Strength | Deployment finding |
|---|---|---|---|
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD-3-Clause | Strong practical blind photo restoration; RRDBNet models and anime variant | Recommended first GPU backend. Python/PyTorch or ncnn; weights and runtime are too heavy for a normal Vercel function. Tiling is required for bounded VRAM. |
| [SwinIR](https://github.com/JingyunLiang/SwinIR) | Apache-2.0 | Excellent classical/lightweight/real-world SR variants | High quality, but transformer inference is slower and memory-heavier. Better for a dedicated GPU service. |
| [waifu2x-ncnn-vulkan](https://github.com/nihui/waifu2x-ncnn-vulkan) | MIT | Mature illustration/anime denoise and scaling | Great specialized worker; requires native ncnn/Vulkan support unavailable on Vercel serverless. |
| [GFPGAN](https://github.com/TencentARC/GFPGAN) | custom/no SPDX assertion in GitHub metadata | Face restoration | Optional face pass only, not a general upscaler. Review model and dependency terms separately. Can alter identity, so it must be opt-in. |
| [CodeFormer](https://github.com/sczhou/CodeFormer) | custom/no SPDX assertion in GitHub metadata | Controllable face restoration fidelity | Optional opt-in face restoration. Heavier and capable of changing facial details. Review weights separately. |
| [Upscayl](https://github.com/upscayl/upscayl) | AGPL-3.0 | Excellent UX and ncnn model orchestration reference | Desktop/local-GPU architecture conflicts with this product's cloud-only requirement. AGPL obligations are material if code is reused. No source code was copied. |
| [chaiNNer](https://github.com/chaiNNer-org/chaiNNer) | GPL-3.0 | Broad model/runtime workflow support | Useful research reference, but far more architecture than a focused web tool needs. GPL compatibility must be evaluated before reuse. No source code was copied. |
| [Sharp](https://github.com/lovell/sharp) | Apache-2.0 | Fast, streaming-friendly libvips resize/encode with low memory | **Selected baseline.** Native binaries are supported in Vercel Node functions. It is interpolation/enhancement, not neural reconstruction. |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | MIT | Portable inference abstraction | Good future worker runtime for exported models. CPU inference may be acceptable for small tiled models but should be benchmarked outside request paths. |

Also relevant: [BasicSR](https://github.com/XPixelGroup/BasicSR) (Apache-2.0) provides training/inference foundations used by several restoration projects, and [ncnn](https://github.com/Tencent/ncnn) (BSD-3-Clause) is a compact native inference framework.

## Quality trade-offs

- **Lanczos-3** preserves edges and frequency content better than nearest-neighbor/bilinear scaling, but it cannot recover missing semantic detail.
- **Sharpening/detail boost** can improve perceived clarity but too much creates halos; controls are bounded and defaults are conservative.
- **Pre-resize smoothing** reduces JPEG blocks/noise but can remove fine texture; it scales with the denoise control.
- **Real-ESRGAN** can synthesize plausible texture and suppress real-world degradation, but may hallucinate inaccurate detail.
- **Face restoration** can materially change identity. It must never silently run as part of a generic photo preset.
- 8× output grows pixel count by 64×. Pixel and dimension limits are essential even when input files are small.

## Reliability and security checklist implemented

- Multipart binary upload rather than base64 (lower memory and bandwidth overhead).
- File byte limit enforced in the browser and server.
- Decoded input pixel limit in libvips; output dimension and megapixel limits before allocation.
- Explicit allowlists for scale and output format; numeric controls are clamped.
- Corrupt/truncated input fails closed (`failOn: error`).
- Sequential batches prevent concurrent memory spikes.
- 55-second browser timeout and retry UI.
- No user filenames in server paths; no filesystem writes at all.
- `no-store` and `nosniff` response headers.
- Blob URL cleanup when results are replaced, removed, or cleared.
- No remote-URL ingestion, avoiding SSRF.
- No accounts, cookies, analytics, database, or persistent server storage.

## Constraints and recommended next phase

1. Deploy a containerized Real-ESRGAN worker on a GPU host using pinned code and checkpoint hashes.
2. Authenticate Vercel-to-worker calls; do not expose an unmetered GPU endpoint directly.
3. Store encrypted inputs/results in lifecycle-managed object storage with a short TTL and one-time signed URLs.
4. Tile inference with overlap to control VRAM and avoid seams; select tile size from worker GPU memory.
5. Keep Sharp as fallback, encoder, metadata normalizer, and alpha-channel handler.
6. Add golden-image tests with PSNR/SSIM plus perceptual/manual review. Do not use only output dimensions as a quality test.
7. Add abuse controls, MIME/magic-byte scanning, observability without image content, and queue backpressure.
8. Publish exact model names, checkpoint hashes, licenses, and provenance in the UI.

## Resource notes

No upstream source code or model weights were copied into this repository. Runtime production dependencies are listed in `package.json`; license notices remain with those packages. The UI uses [Lucide](https://github.com/lucide-icons/lucide) icons (ISC license). Batch archives use [JSZip](https://github.com/Stuk/jszip) (MIT/GPL dual license; used under MIT).
