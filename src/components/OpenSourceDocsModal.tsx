import { useEffect, useState } from 'react';
import { ExternalLink, ShieldCheck, X } from 'lucide-react';

type Tab = 'about' | 'pipeline' | 'deploy' | 'api';

const PROJECTS = [
  { name: 'Real-ESRGAN', license: 'BSD-3', url: 'https://github.com/xinntao/Real-ESRGAN', note: 'Neural restoration — needs a GPU worker; our recommended upgrade path.' },
  { name: 'SwinIR', license: 'Apache-2.0', url: 'https://github.com/JingyunLiang/SwinIR', note: 'Transformer super-resolution; heavier than serverless budgets allow.' },
  { name: 'waifu2x-ncnn-vulkan', license: 'MIT', url: 'https://github.com/nihui/waifu2x-ncnn-vulkan', note: 'Best for anime; needs a native Vulkan runtime.' },
  { name: 'Upscayl', license: 'AGPL-3.0', url: 'https://github.com/upscayl/upscayl', note: 'Local-GPU desktop app; AGPL and architecture differ from ours.' },
  { name: 'Sharp / libvips', license: 'Apache-2.0', url: 'https://github.com/lovell/sharp', note: 'Our engine: fast, low-memory resize & enhancement.' },
  { name: 'ONNX Runtime', license: 'MIT', url: 'https://github.com/microsoft/onnxruntime', note: 'Portable inference for a future model backend.' },
];

export const OpenSourceDocsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<Tab>('about');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-3 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="docs-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl animate-slide-up"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="docs-title" className="text-sm font-bold text-ink">How OpenUpscale works</h2>
          <button
            onClick={onClose}
            aria-label="Close documentation"
            className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition hover:bg-canvas hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-line px-3 pt-2" aria-label="Documentation sections">
          {([['about', 'About'], ['pipeline', 'Pipeline'], ['deploy', 'Deploy'], ['api', 'API']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`cursor-pointer rounded-t-lg px-3 py-2 text-xs font-semibold transition ${
                tab === id ? 'border-b-2 border-brand text-brand' : 'border-b-2 border-transparent text-ink-faint hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="overflow-y-auto p-5 text-sm text-ink-soft">
          {tab === 'about' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-warn">
                <strong className="text-ink">Honest scope:</strong> this build resamples with Lanczos-3 and enhances edges,
                denoise, and color in the cloud. It does not hallucinate detail like a neural model.
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROJECTS.map((p) => (
                  <a
                    key={p.name}
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-line p-3 transition hover:border-brand/40"
                  >
                    <span className="mb-1 flex items-center justify-between gap-2">
                      <strong className="text-xs text-ink">{p.name}</strong>
                      <span className="font-mono text-[10px] text-ok">{p.license}</span>
                    </span>
                    <span className="block text-[11px] leading-relaxed text-ink-soft">{p.note}</span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] font-medium text-brand">
                      Source <ExternalLink className="h-2.5 w-2.5" />
                    </span>
                  </a>
                ))}
              </div>
              <p className="text-[11px] text-ink-faint">
                Tuned against a 50-image quality benchmark (PSNR / SSIM / clipping) — see <code className="text-brand">docs/RESEARCH.md</code> and <code className="text-brand">scripts/quality-benchmark.mts</code>.
              </p>
            </div>
          )}

          {tab === 'pipeline' && (
            <ol className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                'Validate bytes, format, decoded pixels, and limits',
                'Auto-detect content (photo / art / text) for the Auto mode',
                'Fix EXIF orientation, keep the ICC color profile',
                'Denoise JPEG artifacts, resize with Lanczos-3',
                'Sharpen with a content-aware unsharp mask (no halos, no clipping)',
                'Encode PNG / JPG / WebP, stream back, then forget everything',
              ].map((step, i) => (
                <li key={step} className="rounded-xl border border-line bg-canvas/60 p-3 leading-relaxed">
                  <span className="mr-1.5 font-mono text-brand">{i + 1}.</span>{step}
                </li>
              ))}
            </ol>
          )}

          {tab === 'deploy' && (
            <div className="space-y-3 text-xs leading-relaxed">
              <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[11px] leading-relaxed text-white/90">{`git clone https://github.com/alistairfoxlondon-pixel/Upscaler-Free
cd Upscaler-Free
npm ci && npm run check
vercel --prod`}</pre>
              <p>Vercel auto-detects Vite; <code>api/*.ts</code> become Node functions. No environment variables. Self-host with <code>npm run build && npm start</code>.</p>
              <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-ok">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                No database, cookies, analytics, or disk writes. Images live only in request memory.
              </div>
            </div>
          )}

          {tab === 'api' && (
            <div className="space-y-3 text-xs leading-relaxed">
              <pre className="overflow-x-auto rounded-xl bg-ink p-4 font-mono text-[11px] leading-relaxed text-white/90">{`curl -sS https://your-site.example/api/upscale \\
  -F file=@photo.jpg -F scale=2 -F preset=auto \\
  -F format=webp -F quality=92 --output out.webp`}</pre>
              <p>
                <code>scale</code> 2/4/8 · <code>preset</code> auto/photo/anime/document/custom ·
                <code>format</code> png/jpg/webp · <code>quality</code> 70–100 · optional
                <code>sharpness/denoise/detailBoost</code> (0–100) and <code>contrast/brightness/saturation</code> (−50–50).
              </p>
              <p className="text-[11px] text-ink-faint">
                Response body is the image; <code>X-Upscale-Metadata</code> carries base64url JSON (dimensions, size, time, applied mode).
                Limits: 4 MB in, 12,000 px / 64 MP out. Errors are JSON with an <code>error</code> field.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
