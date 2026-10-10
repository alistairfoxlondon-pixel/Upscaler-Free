"""Private, single-request Real-ESRGAN worker. Images are never written to disk."""
from __future__ import annotations

import hmac
import os
import threading
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import torch
from basicsr.archs.rrdbnet_arch import RRDBNet
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from realesrgan import RealESRGANer
from starlette.concurrency import run_in_threadpool

MODEL_NAME = "RealESRGAN_x4plus"
MODEL_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
MODEL_PATH = Path(os.getenv("REALESRGAN_MODEL_PATH", "/models/RealESRGAN_x4plus.pth"))
MAX_UPLOAD_BYTES = int(os.getenv("REAL_ESRGAN_MAX_INPUT_BYTES", str(64 * 1024 * 1024)))
MAX_INPUT_PIXELS = 40_000_000
MAX_OUTPUT_DIMENSION = 12_000
MAX_OUTPUT_PIXELS = 64_000_000
TILE = min(1024, max(0, int(os.getenv("REAL_ESRGAN_TILE", "256"))))
API_KEY = os.getenv("REAL_ESRGAN_API_KEY", "").strip()
ALLOW_UNAUTHENTICATED = os.getenv("ALLOW_UNAUTHENTICATED_WORKER", "false").lower() == "true"

app = FastAPI(title="OpenUpscale Real-ESRGAN worker", docs_url=None, redoc_url=None)
runner: RealESRGANer | None = None
inference_lock = threading.Lock()


def load_model() -> None:
    global runner
    if runner is not None:
        return
    if not API_KEY and not ALLOW_UNAUTHENTICATED:
        raise RuntimeError("Set REAL_ESRGAN_API_KEY or explicitly allow unauthenticated access on a private network.")
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.is_file():
        temporary = MODEL_PATH.with_suffix(".download")
        try:
            urllib.request.urlretrieve(MODEL_URL, temporary)
            temporary.replace(MODEL_PATH)
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("Could not fetch the official RealESRGAN_x4plus checkpoint from GitHub.") from exc
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    use_cuda = torch.cuda.is_available()
    runner = RealESRGANer(
        scale=4,
        model_path=str(MODEL_PATH),
        model=model,
        tile=TILE,
        tile_pad=16,
        pre_pad=0,
        half=use_cuda,
        gpu_id=0 if use_cuda else None,
    )


@app.on_event("startup")
def startup() -> None:
    load_model()


def verify_auth(request: Request) -> None:
    if not API_KEY:
        return
    supplied = request.headers.get("authorization", "")
    expected = f"Bearer {API_KEY}"
    if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Unauthorized")


def upscale_bytes(encoded: bytes, scale: int) -> bytes:
    image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None or image.size == 0 or len(image.shape) not in (2, 3):
        raise HTTPException(status_code=415, detail="Unsupported image")
    height, width = image.shape[:2]
    if width <= 0 or height <= 0 or width * height > MAX_INPUT_PIXELS:
        raise HTTPException(status_code=413, detail="Input pixel limit exceeded")
    output_width, output_height = width * scale, height * scale
    if output_width > MAX_OUTPUT_DIMENSION or output_height > MAX_OUTPUT_DIMENSION or output_width * output_height > MAX_OUTPUT_PIXELS:
        raise HTTPException(status_code=413, detail="Output pixel limit exceeded")
    try:
        if runner is None:
            raise RuntimeError("Model is not loaded")
        result, _ = runner.enhance(image, outscale=scale)
    except RuntimeError as exc:
        # A tiled retry can still OOM on very large images or constrained GPUs.
        raise HTTPException(status_code=503, detail="AI worker could not process this image") from exc
    if result.shape[1] != output_width or result.shape[0] != output_height:
        raise HTTPException(status_code=502, detail="Model returned unexpected dimensions")
    success, output = cv2.imencode(".png", result, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    if not success:
        raise HTTPException(status_code=500, detail="Could not encode output")
    return output.tobytes()


@app.get("/health")
def health(request: Request) -> dict[str, str | bool]:
    verify_auth(request)
    ready = runner is not None
    return {
        "status": "online" if ready else "loading",
        "model": MODEL_NAME,
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "ready": ready,
    }


@app.post("/v1/upscale")
async def upscale(request: Request, file: UploadFile = File(...), scale: int = Form(2)) -> Response:
    verify_auth(request)
    if scale not in (2, 4, 8):
        raise HTTPException(status_code=400, detail="Scale must be 2, 4, or 8")
    if runner is None:
        raise HTTPException(status_code=503, detail="Model is not ready")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Worker is busy")
    try:
        encoded = await file.read(MAX_UPLOAD_BYTES + 1)
        if not encoded:
            raise HTTPException(status_code=400, detail="Empty image")
        if len(encoded) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds worker input limit")
        output = await run_in_threadpool(upscale_bytes, encoded, scale)
        return Response(
            content=output,
            media_type="image/png",
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-RealESRGAN-Model": MODEL_NAME,
            },
        )
    finally:
        await file.close()
        inference_lock.release()
