export class UpscaleError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'UpscaleError';
  }
}

export function imageError(error: unknown): UpscaleError {
  if (error instanceof UpscaleError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/timeout/i.test(message)) return new UpscaleError('This image took too long. Try a smaller scale.', 422, 'PROCESSING_TIMEOUT');
  if (/pixel limit/i.test(message)) return new UpscaleError('The image exceeds the decoded-pixel safety limit.', 413, 'PIXEL_LIMIT');
  if (/heif|heic|hevc|decoding plugin|compression format/i.test(message)) return new UpscaleError('This HEIC file cannot be decoded here. Export it as JPG or PNG first.', 415, 'UNSUPPORTED_CODEC');
  // Native decoder internals and user-supplied bytes never reach the response or logs.
  return new UpscaleError('This image is damaged or unsupported. Try a valid JPG, PNG, WebP, AVIF, TIFF, or still GIF.', 422, 'INVALID_IMAGE');
}
