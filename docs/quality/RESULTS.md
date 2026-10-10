# 50-image quality benchmark

Audit: 2026-10-10. **50 distinct held-out BSDS500 photographs, 250 paired cases, 500 image outputs.** Ten different validation images were used for calibration, never for this score.

| Scenario | Old PSNR | New PSNR | Δ dB | Old SSIM | New SSIM | PSNR wins | SSIM wins | Old / new mean ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| clean-2x | 26.104 | 28.027 | +1.923 | 0.8085 | 0.8389 | 50/50 | 50/50 | 34.6 / 63.7 |
| clean-4x | 23.924 | 24.201 | +0.277 | 0.6389 | 0.6450 | 50/50 | 46/50 | 32.2 / 50.4 |
| clean-8x | 21.755 | 21.852 | +0.098 | 0.5034 | 0.5080 | 49/50 | 48/50 | 33.0 / 44.9 |
| jpeg-4x | 23.227 | 23.472 | +0.246 | 0.5746 | 0.5830 | 50/50 | 50/50 | 33.3 / 48.5 |
| noise-4x | 23.514 | 23.818 | +0.304 | 0.5889 | 0.6041 | 50/50 | 48/50 | 35.0 / 56.1 |

## Method

- Source: [BSDS500 mirror](https://github.com/BIDS/BSDS500), pinned commit and SHA-256 for every image in [the manifest](../../scripts/quality/manifest.json). Sorted test split, every fourth image. These are 50 different photographs, not transformations of one fixture.
- Decode to sRGB, crop the right/bottom to a multiple of eight (typically 480 × 320), bicubic downsample; enlarge back to the reference. The JPEG case encodes the 4× low-resolution input at quality 65 / 4:2:0. Noise is deterministic Gaussian σ=8 on 8-bit RGB.
- Old: the actual processing code at commit `b1746e59a6a3acbcfe8d6da499a7c9da6664c244`, using the old UI's default photo settings (45 sharpness / 20 denoise / 50 detail). New: current faithful photo defaults, lossless PNG. No settings were fitted on these 50 test images.
- BT.601 luma rounded to 8 bit; PSNR and Gaussian-window SSIM (ssim.js original, 11x11), no downsampling, scale-pixel border crop. Higher is better. Metrics are full-reference fidelity measures, **not proof of recovered detail or subjective realism**. These are synthetic degradations of already-compressed source photographs, not a universal real-world SR benchmark.
- Runtime: Node v22.22.3, Sharp 0.35.5, libvips 8.18.7, 2 CPU cores. Timings are single-machine, warm-process measurements, not production latency promises. The new padded, alpha-safe NoHalo pipeline is slower; quality is prioritised.
- Photos/outputs stay in ignored `.cache/`; the dataset's absent repository license is not treated as a redistribution grant. Only provenance, code, and numerical measurements are committed. Cite Arbelaez et al., *Contour Detection and Hierarchical Image Segmentation*, IEEE TPAMI 33(5), 2011, for the dataset.

## Reproduce

```bash
npm ci
npm run quality:fetch  # gh must be connected; about 4.4 MiB of image data
npm run quality:test   # 50 photos, five conditions, both pipelines
```

Per-image results: [CSV](results.csv) · [JSON and runtime details](results.json). Additional orientation, alpha, pixel-art, corrupt-file, input-limit, API, queue, keyboard, and browser checks are covered by the automated test suites; they are not counted among the 50 photographs.
