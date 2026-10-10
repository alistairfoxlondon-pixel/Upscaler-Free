import { MAX_INPUT_BYTES } from '../../shared/upscale.ts';
const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/gif']);
export const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.avif,.tif,.tiff,.gif';
export function fileError(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_INPUT_BYTES) return `${file.name} is over 4 MB.`;
  if (file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name)) return `${file.name}: HEIC/HEIF needs conversion to JPG or PNG first.`;
  if (file.type ? !mimeTypes.has(file.type) : !/\.(jpe?g|png|webp|avif|tiff?|gif)$/i.test(file.name)) return `${file.name} is not a supported image.`;
  return null;
}
export function downloadName(name: string, scale: number, format: string) {
  const leaf = (name.split(/[\\/]/).pop() || name).replace(/\.[^/.]+$/, '');
  const base = leaf.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[._ ]+|[. ]+$/g, '').slice(0, 120) || 'image';
  return `${base}_${scale}x.${format}`;
}
export function uniqueNames(names: string[]) {
  const used = new Set<string>();
  return names.map(name => {
    let candidate = name, n = 2;
    while (used.has(candidate.toLowerCase())) { const dot = name.lastIndexOf('.'); candidate = `${name.slice(0, dot)}_${n++}${name.slice(dot)}`; }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
export function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
}
export function getImageDimensions(url: string): Promise<{ width?: number; height?: number; previewAvailable: boolean }> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (value: { width?: number; height?: number; previewAvailable: boolean }) => {
      clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; resolve(value);
    };
    const timer = window.setTimeout(() => finish({ previewAvailable: false }), 8_000);
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight, previewAvailable: true });
    image.onerror = () => finish({ previewAvailable: false });
    image.src = url;
  });
}
