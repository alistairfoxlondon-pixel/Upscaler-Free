import sharp from 'sharp';
import { ssim } from 'ssim.js';

/** Full-resolution BT.601 luma, no metric downsampling; discard scale pixels at each edge. */
export async function compare(reference: Buffer, output: Buffer, border: number) {
  const decode = async (buffer: Buffer) => {
    const metadata = await sharp(buffer).metadata();
    const { data, info } = await sharp(buffer).toColourspace('srgb').removeAlpha()
      .extract({ left: border, top: border, width: metadata.width! - 2 * border, height: metadata.height! - 2 * border })
      .raw().toBuffer({ resolveWithObject: true });
    const rgba = new Uint8ClampedArray(info.width * info.height * 4);
    for (let p = 0; p < info.width * info.height; p++) {
      const y = Math.round(0.299 * data[p * 3] + 0.587 * data[p * 3 + 1] + 0.114 * data[p * 3 + 2]);
      rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = y;
      rgba[p * 4 + 3] = 255;
    }
    return { data: rgba, width: info.width, height: info.height };
  };
  const [a, b] = await Promise.all([decode(reference), decode(output)]);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Metric dimensions differ');
  let squaredError = 0;
  for (let i = 0; i < a.data.length; i += 4) squaredError += (a.data[i] - b.data[i]) ** 2;
  const mse = squaredError / (a.width * a.height);
  return {
    psnr: mse ? 10 * Math.log10(255 ** 2 / mse) : 100,
    ssim: ssim(a, b, { ssim: 'original', downsample: false, windowSize: 11 }).mssim,
  };
}
