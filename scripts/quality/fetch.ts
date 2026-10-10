import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
await mkdir('.cache/benchmark/images', { recursive: true });
for (const image of manifest.images) {
  const path = `.cache/benchmark/images/${image.file}`;
  let bytes: Buffer | undefined;
  try { bytes = await readFile(path); } catch { /* download missing fixture */ }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
    // gh uses the user's existing GitHub connection; no credentials in the script or output.
    const { stdout } = await exec('gh', ['api', `repos/BIDS/BSDS500/contents/${image.path}?ref=${manifest.commit}`], { maxBuffer: 4 * 1024 * 1024 });
    const response = JSON.parse(stdout);
    bytes = Buffer.from(response.content, 'base64');
    if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error(`Fixture checksum mismatch: ${image.file}`);
    await writeFile(path, bytes);
  }
}
console.log('Verified 50 test photographs and 10 disjoint calibration photographs. Images stay in ignored .cache/.');
