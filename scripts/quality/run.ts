import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { processImageUpscale } from '../../server/upscaler.ts';
import { compare } from './metrics.ts';
import { scenarios, makePair } from './fixtures.ts';
const base = 'b1746e59a6a3acbcfe8d6da499a7c9da6664c244';
const dir = '.cache/benchmark';
await mkdir(`${dir}/review`, { recursive: true });
const legacyPath = path.resolve(`${dir}/legacy-upscaler.ts`);
await writeFile(legacyPath, execFileSync('git', ['show', `${base}:server/upscaler.ts`]));
const { processImageUpscale: legacy } = await import(pathToFileURL(legacyPath).href);
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const images = manifest.images.filter((image: { split: string }) => image.split === 'test');
const rows: Record<string, string | number>[] = [];
let done = 0;
for (const image of images) {
  const bytes = await readFile(`${dir}/images/${image.file}`);
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error(`Fixture changed: ${image.file}`);
  for (const scenario of scenarios) {
    const { reference, low, width, height } = await makePair(image.file, scenario);
    // Match the old UI, not the slightly different old API defaults.
    const previous = await legacy(low, { scale: scenario.scale, preset: 'photo', format: 'png', sharpness: 45, denoise: 20, detailBoost: 50 });
    const revised = await processImageUpscale(low, { scale: scenario.scale, preset: 'photo', format: 'png' });
    if (revised.upscaledWidth !== width || revised.upscaledHeight !== height) throw new Error(`Wrong dimensions: ${image.id}`);
    const before = await compare(reference, previous.buffer, scenario.scale);
    const after = await compare(reference, revised.buffer, scenario.scale);
    rows.push({ id: image.id, scenario: scenario.id, width, height, beforePSNR: before.psnr, afterPSNR: after.psnr, deltaPSNR: after.psnr - before.psnr, beforeSSIM: before.ssim, afterSSIM: after.ssim, deltaSSIM: after.ssim - before.ssim, beforeMs: previous.processingTimeMs, afterMs: revised.processingTimeMs, outputBytes: revised.buffer.length });
    if (scenario.id === 'clean-2x') {
      await Promise.all([
        writeFile(`${dir}/review/${image.id}-reference.png`, reference),
        writeFile(`${dir}/review/${image.id}-before.png`, previous.buffer),
        writeFile(`${dir}/review/${image.id}-after.png`, revised.buffer),
        writeFile(`${dir}/review/${image.id}-input.png`, low),
      ]);
    }
  }
  done++;
  if (done % 10 === 0) console.log(`Checked ${done}/50 photographs (${done * scenarios.length} paired cases)`);
}
const mean = (subset: typeof rows, key: string) => subset.reduce((s, r) => s + Number(r[key]), 0) / subset.length;
const summaries = scenarios.map(s => {
  const subset = rows.filter(r => r.scenario === s.id);
  return { scenario: s.id, count: subset.length, beforePSNR: mean(subset, 'beforePSNR'), afterPSNR: mean(subset, 'afterPSNR'), deltaPSNR: mean(subset, 'deltaPSNR'), beforeSSIM: mean(subset, 'beforeSSIM'), afterSSIM: mean(subset, 'afterSSIM'), deltaSSIM: mean(subset, 'deltaSSIM'), psnrWins: subset.filter(r => Number(r.deltaPSNR) > 0).length, ssimWins: subset.filter(r => Number(r.deltaSSIM) > 0).length, beforeMs: mean(subset, 'beforeMs'), afterMs: mean(subset, 'afterMs') };
});
const report = { auditDate: '2026-10-10', baselineCommit: base, pipeline: '2.0.0', runtime: { node: process.version, sharp: sharp.versions.sharp, vips: sharp.versions.vips, cpu: os.cpus()[0].model, logicalCores: os.availableParallelism() }, images: images.length, pairedCases: rows.length, metrics: 'BT.601 luma rounded to 8 bit; PSNR and Gaussian-window SSIM (ssim.js original, 11x11), no downsampling, scale-pixel border crop', scenarios: summaries, rows };
await mkdir('docs/quality', { recursive: true });
await writeFile('docs/quality/results.json', JSON.stringify(report, null, 2) + '\n');
const headers = Object.keys(rows[0]);
await writeFile('docs/quality/results.csv', [headers.join(','), ...rows.map(r => headers.map(h => typeof r[h] === 'number' ? Number(r[h]).toFixed(6) : r[h]).join(','))].join('\n') + '\n');
const md = `# 50-image quality benchmark\n\nAudit: 2026-10-10. **${images.length} distinct held-out BSDS500 photographs, ${rows.length} paired cases, ${rows.length * 2} image outputs.** Ten different validation images were used for calibration, never for this score.\n\n| Scenario | Old PSNR | New PSNR | Δ dB | Old SSIM | New SSIM | PSNR wins | SSIM wins | Old / new mean ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${summaries.map(s => `| ${s.scenario} | ${s.beforePSNR.toFixed(3)} | ${s.afterPSNR.toFixed(3)} | ${s.deltaPSNR >= 0 ? '+' : ''}${s.deltaPSNR.toFixed(3)} | ${s.beforeSSIM.toFixed(4)} | ${s.afterSSIM.toFixed(4)} | ${s.psnrWins}/50 | ${s.ssimWins}/50 | ${s.beforeMs.toFixed(1)} / ${s.afterMs.toFixed(1)} |`).join('\n')}\n\n## Method\n\n- Source: [BSDS500 mirror](https://github.com/BIDS/BSDS500), pinned commit and SHA-256 for every image in [the manifest](../../scripts/quality/manifest.json). Sorted test split, every fourth image. These are 50 different photographs, not transformations of one fixture.\n- Decode to sRGB, crop the right/bottom to a multiple of eight (typically 480 × 320), bicubic downsample; enlarge back to the reference. The JPEG case encodes the 4× low-resolution input at quality 65 / 4:2:0. Noise is deterministic Gaussian σ=8 on 8-bit RGB.\n- Old: the actual processing code at commit \`${base}\`, using the old UI's default photo settings (45 sharpness / 20 denoise / 50 detail). New: current faithful photo defaults, lossless PNG. No settings were fitted on these 50 test images.\n- ${report.metrics}. Higher is better. Metrics are full-reference fidelity measures, **not proof of recovered detail or subjective realism**. These are synthetic degradations of already-compressed source photographs, not a universal real-world SR benchmark.\n- Runtime: Node ${process.version}, Sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}, ${os.availableParallelism()} CPU cores. Timings are single-machine, warm-process measurements, not production latency promises. The new padded, alpha-safe NoHalo pipeline is slower; quality is prioritised.\n- Photos/outputs stay in ignored \`.cache/\`; the dataset's absent repository license is not treated as a redistribution grant. Only provenance, code, and numerical measurements are committed. Cite Arbelaez et al., *Contour Detection and Hierarchical Image Segmentation*, IEEE TPAMI 33(5), 2011, for the dataset.\n\n## Reproduce\n\n\`\`\`bash\nnpm ci\nnpm run quality:fetch  # gh must be connected; about 4.4 MiB of image data\nnpm run quality:test   # 50 photos, five conditions, both pipelines\n\`\`\`\n\nPer-image results: [CSV](results.csv) · [JSON and runtime details](results.json). Additional orientation, alpha, pixel-art, corrupt-file, input-limit, API, queue, keyboard, and browser checks are covered by the automated test suites; they are not counted among the 50 photographs.\n`;
await writeFile('docs/quality/RESULTS.md', md);
console.table(summaries);
if (summaries.some(s => s.deltaPSNR < 0 || s.deltaSSIM < 0)) throw new Error('Quality gate failed: a scenario mean regressed.');
