# Real-ESRGAN GPU worker

OpenUpscale's ordinary Node/Vercel service remains small and private. Real-ESRGAN runs as a separate, single-request Python worker because the official x4 model and PyTorch/CUDA stack are not suitable for a normal Vercel function bundle. The Node server proxies image bytes to this worker only when **Real-ESRGAN AI** is selected and `REAL_ESRGAN_URL` is configured.

## Build and run

Requirements: Docker with an NVIDIA GPU and NVIDIA Container Toolkit, plus a long random shared secret.

```bash
export REAL_ESRGAN_API_KEY="$(openssl rand -hex 32)"
docker build -f worker/Dockerfile -t openupscale-realesrgan .
docker run --rm --gpus all -p 8000:8000 \
  -e REAL_ESRGAN_API_KEY="$REAL_ESRGAN_API_KEY" \
  -e REAL_ESRGAN_TILE=256 \
  openupscale-realesrgan
```

The first image build downloads the official `RealESRGAN_x4plus.pth` checkpoint from the upstream GitHub release. The model is stored in the container image; uploaded user images are processed in memory and are not written to disk. Authenticated `/health` reports model readiness and whether CUDA is active; the app enables its AI control only after this check succeeds. Only one inference is accepted at a time; a second request gets `503` instead of exhausting GPU memory.

Configure the OpenUpscale Node/Vercel server with:

```dotenv
REAL_ESRGAN_URL=https://your-private-worker.example
REAL_ESRGAN_API_KEY=<same secret as the worker>
```

Keep the worker private (firewall / private network) and set the same secret on both services. Do not use `VITE_` variables for secrets. Never expose the worker directly to the public internet without authentication. If you intentionally run it on a private isolated network without a key, set `ALLOW_UNAUTHENTICATED_WORKER=true` on the worker; this is not recommended for a public host.

The worker accepts a single normalized PNG and scale `2`, `4`, or `8`, returns PNG, and uses the upstream `RealESRGAN_x4plus` model with tiled inference (`tile_pad=16`). The resulting pixels can contain plausible synthesized detail; review at 100% and confirm rights/stock-platform rules before commercial use. GPU availability, runtime, memory, checkpoint terms, and output acceptance vary by deployment. No Real-ESRGAN quality benchmark is claimed by the classic-engine benchmark report.

## Model and licensing note

Real-ESRGAN source code is BSD-3-Clause. The official model checkpoint is fetched separately from the upstream release; verify the checkpoint's current terms and any relevant training-data rights for your use, especially before commercial stock submission. This repository does not redistribute the checkpoint. The Docker image includes it only after you build the worker.
