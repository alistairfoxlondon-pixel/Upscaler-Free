import { useEffect, useRef } from 'react';
import { ArrowUpRight, Check, ShieldCheck, X } from 'lucide-react';
const repo = 'https://github.com/alistairfoxlondon-pixel/Upscaler-Free';

export function OpenSourceDocsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (isOpen && !element?.open) element?.showModal();
    if (!isOpen && element?.open) element.close();
  }, [isOpen]);

  return <dialog ref={dialog} className="info-dialog" aria-labelledby="about-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-content"><button autoFocus className="icon-button dialog-close" onClick={onClose} aria-label="Close information"><X size={20} /></button>
      <span className="eyebrow">A LITTLE CLARITY</span><h2 id="about-title">More pixels, your choice.</h2>
      <p>Faithful mode enlarges without inventing details. Real-ESRGAN is an optional GPU service; it appears only when the site operator connects a worker.</p>
      <ol className="how-steps">
        <li><span>01</span><div><strong>Add an image</strong><p>Up to 4 MB each. A batch holds 20.</p></div></li>
        <li><span>02</span><div><strong>Upscale and review</strong><p>Compare the result, then check its title and keywords.</p></div></li>
        <li><span>03</span><div><strong>Download JPEG</strong><p>The JPEG embeds its title and keywords.</p></div></li>
      </ol>
      <div className="privacy-note"><ShieldCheck size={19} /><div><strong>Images are not saved by this app.</strong><p>Uploads are processed in server memory. If the site operator configures metadata AI, each added image is sent to that vision provider for a title and keyword suggestion. AI suggestions can be wrong; check them before use. Hosting and provider policies apply.</p></div></div>
      <details className="technical-details"><summary>Formats and limits</summary><p>JPG, PNG, WebP, AVIF, single-page TIFF and still GIF are accepted. HEIC needs conversion first. Output is capped at 12,000 pixels per side and 64 MP. Final downloads are JPEGs; transparency is flattened to white. Batch downloads are ZIPs containing JPEGs.</p></details>
      <div className="audit-note"><Check size={16} /><span>50-photo benchmark for faithful upscaling.<br /><small>It is not a Real-ESRGAN benchmark or a promise of stock acceptance.</small></span></div>
      <div className="dialog-links"><a href={`${repo}/blob/main/docs/quality/RESULTS.md`} target="_blank" rel="noreferrer">Quality report<ArrowUpRight size={15} /></a><a href={`${repo}/blob/main/docs/RESEARCH.md`} target="_blank" rel="noreferrer">Research & licenses<ArrowUpRight size={15} /></a></div>
    </div>
  </dialog>;
}
