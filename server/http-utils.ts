import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import { UpscaleError, type UpscaleResult } from './upscaler.ts';

/** Metadata sent in the X-Upscale-Metadata response header (base64url JSON). */
export function buildUpscaleMetadata(result: UpscaleResult) {
  return {
    originalWidth: result.originalWidth,
    originalHeight: result.originalHeight,
    upscaledWidth: result.upscaledWidth,
    upscaledHeight: result.upscaledHeight,
    originalSize: result.originalSize,
    upscaledSize: result.upscaledSize,
    processingTimeMs: result.processingTimeMs,
    format: result.format,
    mimeType: result.mimeType,
    preset: result.preset,
    ...(result.contentKind ? { contentKind: result.contentKind } : {}),
  };
}

/**
 * Streams the encoded image to the response in chunks. The write races the
 * socket 'close' event so a client that disconnects mid-stream can never hang
 * the serverless function or leak the request handler.
 */
export async function sendImageResult(res: ServerResponse, result: UpscaleResult): Promise<void> {
  res.setHeader('Content-Type', result.mimeType);
  res.setHeader('X-Upscale-Metadata', Buffer.from(JSON.stringify(buildUpscaleMetadata(result))).toString('base64url'));
  res.statusCode = 200;

  let offset = 0;
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  res.once('close', onClose);
  try {
    while (offset < result.buffer.length && !closed) {
      const slice = result.buffer.subarray(offset, offset + 64 * 1024);
      offset += slice.length;
      if (!res.write(slice)) {
        await Promise.race([once(res, 'drain'), once(res, 'close')]);
      }
    }
  } finally {
    res.removeListener('close', onClose);
  }
  res.end();
}

/** Maps any thrown value to a clean HTTP status + user-facing message. */
export function toErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof UpscaleError) return { status: error.statusCode, message: error.message };
  const anyError = error as { code?: string; message?: string } | undefined;
  if (anyError?.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, message: 'Image exceeds the 4 MB cloud upload limit' };
  }
  const message = anyError?.message || '';
  if (/must be|exceeds|invalid|unsupported|unreadable|empty|corrupt|truncated/i.test(message)) {
    return { status: 400, message };
  }
  return { status: 500, message: 'Image processing failed' };
}
