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
      <span className="eyebrow">A LITTLE CLARITY</span><h2 id="about-title">Bigger. Not made up.</h2>
      <p>OpenUpscale enlarges images with colour-managed, low-halo resampling. It keeps your image faithful; it doesn’t invent missing details.</p>
      <ol className="how-steps"><li><span>01</span><div><strong>Add an image</strong><p>Up to 4 MB each. A batch holds 20.</p></div></li><li><span>02</span><div><strong>Choose your size</strong><p>Start at 2× for the best balance.</p></div></li><li><span>03</span><div><strong>Compare & download</strong><p>Use 100% zoom to inspect real pixels.</p></div></li></ol>
      <div className="privacy-note"><ShieldCheck size={19} /><div><strong>Your images stay yours.</strong><p>Images are uploaded for processing in server memory. This app saves no image files and uses no analytics. Results stay in this tab until you remove them or close it. Hosting providers may retain request metadata.</p></div></div>
      <details className="technical-details"><summary>Formats & limits</summary><p>JPG, PNG, WebP, AVIF, single-page TIFF, and still GIF. HEIC needs conversion first. Output is capped at 12,000 pixels per side and 64 MP. Large results may need WebP or a smaller scale on serverless hosts. JPG replaces transparency with white. Animated images are not supported.</p></details>
      <div className="audit-note"><Check size={16} /><span>Evaluated on 50 distinct test photographs.<br /><small>Measured fidelity, not an AI-quality claim.</small></span></div>
      <div className="dialog-links"><a href={`${repo}/blob/arena/13c01e58-upscaler-free/docs/quality/RESULTS.md`} target="_blank" rel="noreferrer">Quality report<ArrowUpRight size={15} /></a><a href={`${repo}/blob/arena/13c01e58-upscaler-free/docs/RESEARCH.md`} target="_blank" rel="noreferrer">Research & licenses<ArrowUpRight size={15} /></a></div>
    </div>
  </dialog>;
}
