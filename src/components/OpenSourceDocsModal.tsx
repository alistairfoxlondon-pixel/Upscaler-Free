import React, { useEffect, useState } from 'react';
import { X, BookOpen, Copy, Check } from 'lucide-react';
import { REPO_URL } from '../config.ts';

interface OpenSourceDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CURL_EXAMPLE = `curl -X POST http://localhost:3000/api/upscale \\
  -F "file=@input.jpg" \\
  -F "scale=4" \\
  -F "preset=photo" \\
  -F "format=png"`;

const SELF_HOST = `npm install --legacy-peer-deps
npm run build
NODE_ENV=production npm start`;

export const OpenSourceDocsModal: React.FC<OpenSourceDocsModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const CodeBlock = ({ code, id }: { code: string; id: string }) => (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-slate-950 border border-slate-800 p-3.5 pr-12 text-xs text-slate-300 font-mono">
        {code}
      </pre>
      <button
        type="button"
        onClick={() => copy(code, id)}
        aria-label="Copy to clipboard"
        className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-md cursor-pointer"
      >
        {copied === id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="docs-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col w-full max-w-2xl max-h-[88vh] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 id="docs-title" className="text-base font-bold text-white">
              About & API
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 space-y-6 text-sm text-slate-300 leading-relaxed">
          <section className="space-y-2">
            <h3 className="font-semibold text-white">How it upscales</h3>
            <p>
              Images are enhanced by an ESRGAN super-resolution network (the open-source{' '}
              <span className="font-mono text-slate-200">@upscalerjs/esrgan-slim</span> models, MIT) that runs on the
              server with TensorFlow.js. It generates new edge and texture detail, which plain resizing cannot do.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>
                AI runs up to 2 MP for 2x and 4x, and up to 0.25 MP for 8x. Larger images use a fast resize, and the
                result says so.
              </li>
              <li>Maximum output size is 12000 px on either side.</li>
              <li>Transparency is kept. Sharpness applies an unsharp mask after upscaling.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-white">Privacy</h3>
            <p>
              Uploads are held in server memory only and are never written to disk. Results stay in memory for up to
              15 minutes and are also returned to your browser for download.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-white">API</h3>
            <p>
              <span className="font-mono text-slate-200">POST /api/upscale</span> (multipart field <code>file</code>)
              accepts <code>scale</code> (2, 4, 8), <code>preset</code>, <code>sharpness</code> (0–100),{' '}
              <code>denoise</code> (0–100), <code>format</code> (png, jpg, webp) and <code>quality</code>. The JSON
              response includes <code>dataUrl</code>, dimensions, timing, and <code>engine</code> (
              <code>esrgan</code> or <code>lanczos</code>).
            </p>
            <CodeBlock code={CURL_EXAMPLE} id="curl" />
          </section>

          <section className="space-y-2">
            <h3 className="font-semibold text-white">Self-host</h3>
            <p>
              Requires Node.js 20 or newer. Install all dependencies (the dev tools are needed to run the server).
            </p>
            <CodeBlock code={SELF_HOST} id="host" />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-cyan-400 hover:text-cyan-300 hover:underline"
            >
              Source code on GitHub
            </a>
          </section>
        </div>
      </div>
    </div>
  );
};
