import sharp from 'sharp';
import { MAX_INPUT_BYTES, MAX_INPUT_PIXELS } from '../shared/upscale.ts';
import { normalizeStockMetadata, type StockMetadata } from '../shared/stock.ts';
import { UpscaleError } from './errors.ts';

const SUPPORTED_INPUTS = new Set(['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff', 'gif']);

export const stockMetadataAiConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim());

/**
 * Optional vision-provider call, triggered on upload only when configured. The server key is never
 * sent to the browser; the image is orientation-normalized, metadata-stripped and reduced first.
 */
export async function generateAiStockMetadata(input: Buffer): Promise<StockMetadata> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new UpscaleError('Image-specific metadata AI is not configured on this server.', 503, 'STOCK_AI_NOT_CONFIGURED');
  if (!Buffer.isBuffer(input) || input.length === 0) throw new UpscaleError('Choose an image to describe.');
  if (input.length > MAX_INPUT_BYTES) throw new UpscaleError('Image exceeds the 4 MB upload limit.', 413, 'FILE_TOO_LARGE');

  let jpeg: Buffer;
  try {
    const source = sharp(input, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true });
    const metadata = await source.metadata();
    if (!metadata.format || !SUPPORTED_INPUTS.has(metadata.format) || !metadata.width || !metadata.height) {
      throw new UpscaleError('Unsupported image. Use JPG, PNG, WebP, AVIF, TIFF, or a still GIF.', 415, 'UNSUPPORTED_FORMAT');
    }
    if ((metadata.pages ?? 1) > 1) throw new UpscaleError('Animated and multi-page images are not supported.', 415, 'MULTI_FRAME_IMAGE');
    jpeg = await sharp(input, { failOn: 'warning', limitInputPixels: MAX_INPUT_PIXELS, sequentialRead: true })
      .autoOrient()
      .toColourspace('srgb')
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof UpscaleError) throw error;
    throw new UpscaleError('This image could not be prepared for metadata suggestions. Try a valid JPG or PNG.', 422, 'INVALID_IMAGE');
  }

  const prompt = [
    'Create Adobe Stock metadata for the attached image. Describe only visible, reasonably certain content; do not invent a location, identity, event, brand, or backstory.',
    'Return JSON only with this exact shape: {"title":"...","keywords":["..."]}.',
    'Write one short, friendly, factual English title of 70 characters or fewer. Provide 10 to 30 useful, specific, non-duplicated English keywords ordered from most important to least important; never exceed 49. Use natural stock-search terms, not a sentence or keyword stuffing. Avoid trademarks, unsupported claims, and generic filler such as photo, image, Adobe Stock, or stock photo.',
  ].join(' ');
  const model = (process.env.STOCK_METADATA_MODEL?.trim() || 'gpt-4o-mini').slice(0, 80);
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(18_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, detail: 'high' } },
        ] }],
      }),
    });
  } catch {
    throw new UpscaleError('The metadata AI could not be reached. Please try again later.', 502, 'STOCK_AI_UNAVAILABLE');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new UpscaleError('The metadata AI rejected its server credential. Check OPENAI_API_KEY.', 502, 'STOCK_AI_AUTH');
    if (response.status === 429) throw new UpscaleError('The metadata AI is rate-limited. Please wait and try again.', 503, 'STOCK_AI_BUSY');
    throw new UpscaleError('The metadata AI could not describe this image. Please try again.', 502, 'STOCK_AI_FAILED');
  }
  let payload: { choices?: Array<{ message?: { content?: unknown } }> };
  try { payload = await response.json() as typeof payload; }
  catch { throw new UpscaleError('The metadata AI returned an invalid response. Please retry.', 502, 'STOCK_AI_INVALID_RESPONSE'); }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new UpscaleError('The metadata AI returned an invalid response. Please retry.', 502, 'STOCK_AI_INVALID_RESPONSE');
  try {
    const parsed: unknown = JSON.parse(content);
    const metadata = normalizeStockMetadata({ ...(parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}), source: 'ai' }, 'ai');
    if (!metadata.title || metadata.keywords.length < 3) throw new Error('Incomplete metadata');
    return metadata;
  } catch {
    throw new UpscaleError('The metadata AI response could not be validated. Please try again.', 502, 'STOCK_AI_INVALID_RESPONSE');
  }
}
