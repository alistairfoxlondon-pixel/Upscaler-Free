import type { UpscaleMetadata, UpscaleSettings } from '../types.ts';

export function parseMetadata(encoded: string | null, blob: Blob, settings: UpscaleSettings): UpscaleMetadata {
  if (!encoded) throw new Error('The server response is missing image information.');
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), c => c.charCodeAt(0));
    const data: UpscaleMetadata = JSON.parse(new TextDecoder().decode(bytes));
    for (const key of ['originalWidth', 'originalHeight', 'upscaledWidth', 'upscaledHeight', 'originalSize', 'upscaledSize'] as const) {
      if (!Number.isSafeInteger(data[key]) || data[key] <= 0) throw new Error('Invalid dimensions or size');
    }
    if (data.upscaledWidth !== data.originalWidth * settings.scale || data.upscaledHeight !== data.originalHeight * settings.scale || data.upscaledSize !== blob.size || data.format !== settings.format || data.mimeType !== blob.type) throw new Error('Image metadata mismatch');
    if (!data.settings || typeof data.engine !== 'string' || !Array.isArray(data.warnings) || data.warnings.some(w => typeof w !== 'string')) throw new Error('Invalid response schema');
    return data;
  } catch { throw new Error('The server returned invalid image information. Please retry.'); }
}

export async function requestUpscale(file: File, settings: UpscaleSettings, signal: AbortSignal) {
  const body = new FormData(); body.append('file', file, file.name);
  Object.entries(settings).forEach(([key, value]) => body.append(key, String(value)));
  // The timeout covers response headers AND the entire streamed body.
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 55_000);
  try {
    const response = await fetch('/api/upscale', { method: 'POST', body, signal: controller.signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || (response.status === 413 ? 'This image or result is too large. Try a smaller scale or WebP.' : `The server could not process this image (${response.status}). Please retry.`));
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0] || '')) throw new Error('The server did not return an image.');
    const blob = await response.blob();
    if (!blob.size) throw new Error('The server returned an empty image.');
    return { blob, metadata: parseMetadata(response.headers.get('x-upscale-metadata'), blob, settings) };
  } catch (error) {
    if (timedOut) throw new Error('This image took too long. Try a smaller scale.');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
}
