import { UpscaleError } from './errors.ts';

const WORKER_TIMEOUT_MS = 45_000;
const MAX_WORKER_RESPONSE_BYTES = 96 * 1024 * 1024;

export const realEsrganConfigured = () => Boolean(process.env.REAL_ESRGAN_URL?.trim() && process.env.REAL_ESRGAN_API_KEY?.trim());

function workerEndpoint() {
  const configured = process.env.REAL_ESRGAN_URL?.trim();
  if (!configured) throw new UpscaleError('Real-ESRGAN AI is not connected on this deployment. The image was not sent. Configure a Real-ESRGAN worker to enable it.', 503, 'AI_NOT_CONFIGURED');
  if (!process.env.REAL_ESRGAN_API_KEY?.trim()) throw new UpscaleError('Real-ESRGAN is missing its server-side worker credential. Configure REAL_ESRGAN_API_KEY.', 503, 'AI_WORKER_CONFIG');
  let base: URL;
  try { base = new URL(configured); }
  catch { throw new UpscaleError('The Real-ESRGAN worker URL is invalid. Check the server configuration.', 503, 'AI_WORKER_CONFIG'); }
  if (!['http:', 'https:'].includes(base.protocol)) throw new UpscaleError('The Real-ESRGAN worker URL must use HTTP or HTTPS.', 503, 'AI_WORKER_CONFIG');
  const normalized = base.toString().replace(/\/+$/, '');
  return normalized.endsWith('/v1/upscale') ? normalized : `${normalized}/v1/upscale`;
}

/** Do not advertise neural inference unless the authenticated worker reports its model ready. */
export async function realEsrganStatus(): Promise<{ configured: boolean; ready: boolean }> {
  if (!realEsrganConfigured()) return { configured: false, ready: false };
  try {
    const endpoint = workerEndpoint();
    const healthUrl = endpoint.replace(/\/v1\/upscale$/, '/health');
    const response = await fetch(healthUrl, {
      headers: { Authorization: `Bearer ${process.env.REAL_ESRGAN_API_KEY!.trim()}` },
      signal: AbortSignal.timeout(1_500),
      cache: 'no-store',
    });
    if (!response.ok) return { configured: true, ready: false };
    const health = await response.json() as { status?: unknown; model?: unknown; ready?: unknown; device?: unknown };
    return {
      configured: true,
      // This integration is explicitly a GPU worker. A CPU-only container is not advertised as ready.
      ready: health.status === 'online' && health.model === 'RealESRGAN_x4plus' && health.ready === true && health.device === 'cuda',
    };
  } catch {
    return { configured: true, ready: false };
  }
}

async function readBounded(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WORKER_RESPONSE_BYTES) {
    throw new UpscaleError('The AI worker returned an image that is too large. Choose a smaller scale.', 413, 'AI_OUTPUT_TOO_LARGE');
  }
  if (!response.body) throw new UpscaleError('The AI worker returned an empty response.', 502, 'AI_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WORKER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new UpscaleError('The AI worker returned an image that is too large. Choose a smaller scale.', 413, 'AI_OUTPUT_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  if (!total) throw new UpscaleError('The AI worker returned an empty image.', 502, 'AI_INVALID_RESPONSE');
  return Buffer.concat(chunks, total);
}

export interface RealEsrganOutput {
  buffer: Buffer;
  model: string;
}

/** Server-only proxy to a separately deployed, authenticated GPU worker. */
export async function runRealEsrgan(inputPng: Buffer, scale: number, clientSignal?: AbortSignal): Promise<RealEsrganOutput> {
  const endpoint = workerEndpoint();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(inputPng)], { type: 'image/png' }), 'input.png');
  form.append('scale', String(scale));
  const headers = new Headers();
  const token = process.env.REAL_ESRGAN_API_KEY?.trim();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const abortFromClient = () => controller.abort();
  clientSignal?.addEventListener('abort', abortFromClient, { once: true });
  if (clientSignal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    if (clientSignal?.aborted) throw new UpscaleError('Processing was cancelled.', 499, 'CANCELLED');
    const response = await fetch(endpoint, { method: 'POST', headers, body: form, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new UpscaleError('The Real-ESRGAN worker rejected its server credential. Check REAL_ESRGAN_API_KEY.', 502, 'AI_WORKER_AUTH');
      if (response.status === 429 || response.status === 503) throw new UpscaleError('The Real-ESRGAN worker is busy. Please try again shortly.', 503, 'AI_WORKER_BUSY');
      if (response.status === 413) throw new UpscaleError('The Real-ESRGAN worker rejected this image as too large. Choose a smaller image or scale.', 413, 'AI_WORKER_LIMIT');
      throw new UpscaleError('The Real-ESRGAN worker could not process this image. Please retry or use the faithful engine.', 502, 'AI_WORKER_FAILED');
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mime !== 'image/png') throw new UpscaleError('The Real-ESRGAN worker returned an unsupported image response.', 502, 'AI_INVALID_RESPONSE');
    const buffer = await readBounded(response);
    if (clientSignal?.aborted) throw new UpscaleError('Processing was cancelled.', 499, 'CANCELLED');
    if (controller.signal.aborted) throw new UpscaleError('Real-ESRGAN took too long. Try a smaller image or scale.', 504, 'AI_TIMEOUT');
    return { buffer, model: response.headers.get('x-realesrgan-model')?.slice(0, 80) || 'RealESRGAN_x4plus' };
  } catch (error) {
    if (error instanceof UpscaleError) throw error;
    if (clientSignal?.aborted) throw new UpscaleError('Processing was cancelled.', 499, 'CANCELLED');
    if (controller.signal.aborted) throw new UpscaleError('Real-ESRGAN took too long. Try a smaller image or scale.', 504, 'AI_TIMEOUT');
    throw new UpscaleError('The Real-ESRGAN worker could not be reached. Check that the GPU worker is running.', 502, 'AI_WORKER_UNAVAILABLE');
  } finally { clearTimeout(timer); clientSignal?.removeEventListener('abort', abortFromClient); }
}
