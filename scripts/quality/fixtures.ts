import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

export const scenarios = [
  { id: 'clean-2x', scale: 2, degradation: 'clean' },
  { id: 'clean-4x', scale: 4, degradation: 'clean' },
  { id: 'clean-8x', scale: 8, degradation: 'clean' },
  { id: 'jpeg-4x', scale: 4, degradation: 'jpeg' },
  { id: 'noise-4x', scale: 4, degradation: 'noise' },
] as const;
export type Scenario = typeof scenarios[number];

export async function makePair(file: string, scenario: Scenario) {
  const source = await readFile(`.cache/benchmark/images/${file}`);
  const meta = await sharp(source).metadata();
  const width = Math.floor(meta.width! / 8) * 8;
  const height = Math.floor(meta.height! / 8) * 8;
  const reference = await sharp(source).extract({ left: 0, top: 0, width, height })
    .toColourspace('srgb').removeAlpha().png().toBuffer();
  let low = await sharp(reference).resize(width / scenario.scale, height / scenario.scale, { kernel: 'cubic' }).png().toBuffer();
  if (scenario.degradation === 'jpeg') low = await sharp(low).jpeg({ quality: 65, chromaSubsampling: '4:2:0' }).toBuffer();
  if (scenario.degradation === 'noise') {
    const { data, info } = await sharp(low).raw().toBuffer({ resolveWithObject: true });
    // Seeded Box-Muller Gaussian noise, sigma=8; identical for every candidate.
    let state = 0x12345678;
    const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return (state + 1) / 4294967297; };
    for (let i = 0; i < data.length; i++) {
      const noise = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random()) * 8;
      data[i] = Math.min(255, Math.max(0, Math.round(data[i] + noise)));
    }
    low = await sharp(data, { raw: info }).png().toBuffer();
  }
  return { reference, low, width, height };
}
