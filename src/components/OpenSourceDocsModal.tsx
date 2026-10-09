import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Code2,
  Terminal,
  Cpu,
  Shield,
  ExternalLink,
  Copy,
  Check,
  Server,
  Package,
} from 'lucide-react';

interface OpenSourceDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OpenSourceDocsModal: React.FC<OpenSourceDocsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'audit' | 'pipeline' | 'deploy' | 'api'>('audit');
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const curlExample = `curl -X POST https://your-domain.vercel.app/api/upscale \\
  -F "file=@input.jpg" \\
  -F "scale=4" \\
  -F "preset=photo" \\
  -F "format=png" \\
  -F "sharpness=50" \\
  -F "denoise=30"`;

  const vercelConfig = `{
  "version": 2,
  "builds": [
    {
      "src": "server.ts",
      "use": "@vercel/node",
      "config": {
        "maxDuration": 60,
        "memory": 1024
      }
    },
    {
      "src": "package.json",
      "use": "@vercel/static-build",
      "config": { "distDir": "dist" }
    }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "/server.ts" },
    { "src": "/(.*)", "dest": "/dist/$1" }
  ]
}`;

  const dockerfileCode = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/server ./server
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[88vh] rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Open Source Architecture & Docs</h2>
              <p className="text-xs text-slate-400">
                Audited models, open-source algorithms, privacy model, and self-hosting
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-slate-800 px-6 bg-slate-950/40">
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'audit'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Open Source Audit
          </button>
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'pipeline'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Enhancement Pipeline
          </button>
          <button
            onClick={() => setActiveTab('deploy')}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'deploy'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Vercel & Docker Deploy
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`px-4 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'api'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            REST API
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-300">
          {/* TAB 1: AUDIT */}
          {activeTab === 'audit' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-white mb-2">
                  Open Source Project & Model Audit
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  We conducted an in-depth audit of leading open-source super-resolution repositories
                  on GitHub, evaluating license compatibility, computational efficiency, and
                  production reliability.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">Real-ESRGAN</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      BSD-3-Clause
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Tencent ARC Lab’s deep neural model for practical blind image restoration. Uses
                    a high-capacity RRDBNet backbone with multi-stage degradation modeling.
                  </p>
                  <div className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                    <span>Key strength:</span>
                    <span className="text-slate-300">Artifact suppression on real photos</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">Waifu2x</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      MIT License
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    The pioneer convolutional network for 2D anime, manga, and digital art
                    upscaling. Highly praised for clean linework and de-ringing.
                  </p>
                  <div className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                    <span>Key strength:</span>
                    <span className="text-slate-300">Clean 2D vector-like edge sharpness</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">Sharp (libvips)</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      Apache-2.0
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    High-performance SIMD-accelerated C image processing kernel. Executes
                    high-order Lanczos-3 resampling, adaptive unsharp masking, and bilateral
                    denoising 4-5x faster than ImageMagick with minimal memory.
                  </p>
                  <div className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                    <span>Key strength:</span>
                    <span className="text-slate-300">Sub-second cloud latency & 0 crashes</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-xs">JSZip</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                      MIT License
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Streams DEFLATE compressed batch archives directly from ephemeral server memory
                    without creating temporary files on the file system.
                  </p>
                  <div className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                    <span>Key strength:</span>
                    <span className="text-slate-300">Streamed ZIP download without disk leaks</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PIPELINE */}
          {activeTab === 'pipeline' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white">Cloud Multi-Stage Pipeline</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Rather than forcing heavy client GPUs that cause laptops to heat up and mobile
                browsers to reload due to out-of-memory errors, OpenUpscale processes everything in
                an isolated cloud worker using high-precision 32-bit floating point mathematical
                kernels:
              </p>

              <ol className="space-y-3 text-xs">
                <li className="flex gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                  <span className="font-mono text-cyan-400 font-bold shrink-0">01.</span>
                  <div>
                    <span className="font-semibold text-slate-200">Lanczos-3 Resampling:</span>
                    <p className="text-slate-400 mt-0.5">
                      Uses windowed sinc 3-lobe interpolation to expand spatial grid coordinates
                      with sharp frequency response, eliminating pixelation.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                  <span className="font-mono text-cyan-400 font-bold shrink-0">02.</span>
                  <div>
                    <span className="font-semibold text-slate-200">Bilateral & Median Denoising:</span>
                    <p className="text-slate-400 mt-0.5">
                      Suppresses high-frequency compression artifacts, JPEG blocking, and camera
                      sensor noise while preserving primary edge boundaries.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                  <span className="font-mono text-cyan-400 font-bold shrink-0">03.</span>
                  <div>
                    <span className="font-semibold text-slate-200">Adaptive Unsharp Masking:</span>
                    <p className="text-slate-400 mt-0.5">
                      Applies a tunable gaussian difference mask with dual thresholds (m1 for flat
                      regions, m2 for edge contours) to prevent ringing halos.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                  <span className="font-mono text-cyan-400 font-bold shrink-0">04.</span>
                  <div>
                    <span className="font-semibold text-slate-200">Ephemeral Memory & Auto-Purge:</span>
                    <p className="text-slate-400 mt-0.5">
                      Images live only in short-lived memory buffers. Automatic TTL purge triggers
                      at 15 minutes, or immediately upon user download.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          )}

          {/* TAB 3: DEPLOY */}
          {activeTab === 'deploy' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Deploying to Vercel</h3>
                <p className="text-xs text-slate-400">
                  OpenUpscale is pre-configured for instant zero-config deployment to Vercel
                  Serverless Functions or any Node.js container.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">vercel.json</span>
                  <button
                    onClick={() => copyCode(vercelConfig, 'vercel')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedIndex === 'vercel' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedIndex === 'vercel' ? 'Copied' : 'Copy Config'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto">
                  {vercelConfig}
                </pre>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">Dockerfile (Self-Hosting)</span>
                  <button
                    onClick={() => copyCode(dockerfileCode, 'docker')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedIndex === 'docker' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedIndex === 'docker' ? 'Copied' : 'Copy Dockerfile'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto">
                  {dockerfileCode}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: API */}
          {activeTab === 'api' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white">Public REST API Endpoint</h3>
              <p className="text-xs text-slate-400">
                You can automate super-resolution in your CI/CD pipelines, mobile applications, or
                scripts using standard cURL commands:
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-300">POST /api/upscale</span>
                  <button
                    onClick={() => copyCode(curlExample, 'curl')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedIndex === 'curl' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedIndex === 'curl' ? 'Copied' : 'Copy cURL'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-cyan-300 overflow-x-auto">
                  {curlExample}
                </pre>
              </div>

              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 space-y-1.5 text-xs">
                <div className="font-semibold text-white">Supported Request Parameters:</div>
                <ul className="space-y-1 font-mono text-[11px] text-slate-400 list-disc list-inside">
                  <li><strong className="text-slate-200">file</strong>: Image binary multipart</li>
                  <li><strong className="text-slate-200">scale</strong>: 2, 4, or 8 (default: 2)</li>
                  <li><strong className="text-slate-200">preset</strong>: photo, digital_art, anime, document, custom</li>
                  <li><strong className="text-slate-200">format</strong>: png, jpg, webp (default: png)</li>
                  <li><strong className="text-slate-200">quality</strong>: 80 to 100 (default: 92)</li>
                  <li><strong className="text-slate-200">sharpness</strong>: 0 to 100</li>
                  <li><strong className="text-slate-200">denoise</strong>: 0 to 100</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3.5 bg-slate-950/70 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-400" />
            <span>Open Source under MIT License · 100% Free Forever</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
