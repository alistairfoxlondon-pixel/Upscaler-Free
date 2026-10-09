import React from 'react';
import { Shield, Zap, Trash2, Cpu, EyeOff } from 'lucide-react';
import { SystemInfo } from '../types.ts';

interface PrivacyBannerProps {
  systemInfo: SystemInfo | null;
}

export const PrivacyBanner: React.FC<PrivacyBannerProps> = ({ systemInfo }) => {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 sm:p-6 backdrop-blur-sm">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs">
        {/* Pillar 1 */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 shrink-0 mt-0.5">
            <Zap className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-200">100% Cloud-Based</div>
            <p className="text-slate-400 leading-relaxed">
              Super-resolution runs on server-grade workers. Zero lag, CPU heat, or battery drain
              on your phone or laptop.
            </p>
          </div>
        </div>

        {/* Pillar 2 */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0 mt-0.5">
            <Trash2 className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-200">Automatic File Deletion</div>
            <p className="text-slate-400 leading-relaxed">
              Files are held in temporary memory buffers and auto-purged after 15 minutes or
              immediately after you download them.
            </p>
          </div>
        </div>

        {/* Pillar 3 */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0 mt-0.5">
            <EyeOff className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-200">No Account Required</div>
            <p className="text-slate-400 leading-relaxed">
              Completely free and open-source. No registration, no credit cards, no tracking
              cookies, and no usage watermarks.
            </p>
          </div>
        </div>

        {/* Pillar 4 */}
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0 mt-0.5">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="font-semibold text-slate-200">Real-ESRGAN & Lanczos-3</div>
            <p className="text-slate-400 leading-relaxed">
              Powered by libvips high-precision sinc resampling, bilateral de-ringing, and adaptive
              unsharp edge enhancement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
