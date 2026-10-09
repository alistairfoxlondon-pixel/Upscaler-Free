import React, { useEffect, useState } from 'react';
import { X, BookOpen, ExternalLink, ShieldCheck, Server, Terminal } from 'lucide-react';

type Tab = 'audit' | 'pipeline' | 'deploy' | 'api';

const projects = [
  { name: 'Real-ESRGAN', license: 'BSD-3-Clause', fit: 'Excellent neural restoration; needs a GPU worker', url: 'https://github.com/xinntao/Real-ESRGAN' },
  { name: 'SwinIR', license: 'Apache-2.0', fit: 'High quality transformer; too heavy for a Vercel function', url: 'https://github.com/JingyunLiang/SwinIR' },
  { name: 'waifu2x-ncnn-vulkan', license: 'MIT', fit: 'Strong anime upscaling; requires Vulkan/native runtime', url: 'https://github.com/nihui/waifu2x-ncnn-vulkan' },
  { name: 'Upscayl', license: 'AGPL-3.0', fit: 'Polished desktop reference; copyleft and local GPU focused', url: 'https://github.com/upscayl/upscayl' },
  { name: 'Sharp / libvips', license: 'Apache-2.0', fit: 'Selected: reliable, low-memory serverless resampling', url: 'https://github.com/lovell/sharp' },
  { name: 'ONNX Runtime', license: 'MIT', fit: 'Best future CPU/GPU model adapter; model weights still need hosting', url: 'https://github.com/microsoft/onnxruntime' },
];

export const OpenSourceDocsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<Tab>('audit');
  useEffect(() => {
    if (!isOpen) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [isOpen, onClose]);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="docs-title" onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-cyan-500/10 p-2 text-cyan-400"><BookOpen className="h-5 w-5" /></span>
            <div><h2 id="docs-title" className="font-bold text-white">Architecture & open-source audit</h2><p className="text-xs text-slate-400">What runs today, what was evaluated, and why</p></div>
          </div>
          <button aria-label="Close documentation" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </header>

        <nav className="flex overflow-x-auto border-b border-slate-800 px-3 sm:px-5" aria-label="Documentation sections">
          {([['audit', 'Project audit'], ['pipeline', 'Pipeline'], ['deploy', 'Deploy'], ['api', 'API']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-4 py-3 text-xs font-semibold ${tab === id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-white'}`}>{label}</button>
          ))}
        </nav>

        <div className="overflow-y-auto p-5 text-sm text-slate-300 sm:p-6">
          {tab === 'audit' && <div className="space-y-4">
            <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4 text-xs leading-relaxed text-amber-100">
              <strong>Honest capability note:</strong> this Vercel build uses deterministic Lanczos-3 resampling and enhancement, not a neural model. Neural super-resolution needs a separate GPU service; labeling ordinary resizing as Real-ESRGAN would be misleading.
            </div>
            <div className="grid gap-3 md:grid-cols-2">{projects.map((project) => <a key={project.name} href={project.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 hover:border-cyan-700">
              <div className="mb-2 flex items-center justify-between"><strong className="text-white">{project.name}</strong><span className="font-mono text-[10px] text-emerald-400">{project.license}</span></div>
              <p className="text-xs leading-relaxed text-slate-400">{project.fit}</p><span className="mt-2 flex items-center gap-1 text-[11px] text-cyan-400">Source <ExternalLink className="h-3 w-3" /></span>
            </a>)}</div>
            <p className="text-xs leading-relaxed text-slate-400">The full dated audit, license caveats, deployment trade-offs, and upgrade path are in <code className="text-cyan-300">docs/RESEARCH.md</code>.</p>
          </div>}

          {tab === 'pipeline' && <div className="space-y-4">
            <h3 className="font-semibold text-white">Server-only processing pipeline</h3>
            <ol className="grid gap-3 sm:grid-cols-2">
              {['Validate file size, format, decoded pixels, and requested settings', 'Apply EXIF orientation and optional pre-resize artifact smoothing', 'Resize in cloud memory with libvips Lanczos-3', 'Apply bounded sharpening, detail, brightness, contrast, and saturation', 'Encode as PNG, progressive JPG, or WebP', 'Stream the result; discard server buffers immediately after the response'].map((step, index) => <li key={step} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs leading-relaxed"><span className="mr-2 font-mono text-cyan-400">{index + 1}.</span>{step}</li>)}
            </ol>
            <div className="flex gap-2 rounded-xl border border-emerald-900 bg-emerald-950/20 p-4 text-xs text-emerald-100"><ShieldCheck className="h-4 w-4 shrink-0" />No database, temporary file, analytics SDK, or persistent object store is used.</div>
          </div>}

          {tab === 'deploy' && <div className="space-y-4 text-xs leading-relaxed">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Server className="h-4 w-4 text-cyan-400" />Vercel</div>
            <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-cyan-200">git clone https://github.com/alistairfoxlondon-pixel/Upscaler-Free{`\n`}cd Upscaler-Free{`\n`}npm ci && npm run check{`\n`}vercel --prod</pre>
            <p>Vercel detects Vite and deploys <code>api/upscale.ts</code> as a Node function. No environment variables are required. The 4 MB input limit leaves safe headroom under serverless request limits.</p>
            <p>For larger files or neural inference, deploy the included Node app on a container host and put a GPU Real-ESRGAN worker behind it. Vercel itself is not a GPU runtime.</p>
          </div>}

          {tab === 'api' && <div className="space-y-4 text-xs leading-relaxed">
            <div className="flex items-center gap-2 text-sm font-semibold text-white"><Terminal className="h-4 w-4 text-cyan-400" />POST /api/upscale</div>
            <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-cyan-200">curl -sS https://your-site.vercel.app/api/upscale \\{`\n`}  -F file=@photo.jpg -F scale=2 -F preset=photo \\{`\n`}  -F format=webp -F quality=92 --output enhanced.webp</pre>
            <p>Multipart fields: <code>scale</code> 2/4/8; <code>preset</code> photo/anime/document/custom; <code>format</code> jpg/png/webp; <code>quality</code> 70–100; and enhancement values <code>sharpness</code>, <code>denoise</code>, <code>detailBoost</code>, <code>contrast</code>, <code>brightness</code>, <code>saturation</code>.</p>
            <p>The successful response body is the image binary. <code>X-Upscale-Metadata</code> contains base64url-encoded JSON dimensions, size, format, and processing time. Errors are JSON.</p>
          </div>}
        </div>
      </section>
    </div>
  );
};
