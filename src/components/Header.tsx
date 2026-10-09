import React from 'react';
import { Layers, Github, BookOpen, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  onOpenDocs: () => void;
  activeCount: number;
}

export const Header: React.FC<HeaderProps> = ({ onOpenDocs, activeCount }) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-[#0b0f17]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
        {/* Zone 1: Single text wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 shadow-md shadow-cyan-500/10">
            <Layers className="h-5 w-5 text-white" />
          </div>
          <a href="/" className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
            OpenUpscale
          </a>
        </div>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
          <a
            href="#upscaler"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Cloud Upscaler
          </a>
          <a
            href="#samples"
            className="hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Sample Benchmarks
          </a>
          <button
            onClick={onOpenDocs}
            className="hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <BookOpen className="h-4 w-4 text-cyan-400" />
            <span>Open Source & Docs</span>
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-400 whitespace-nowrap shrink-0">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>100% Ephemeral Memory</span>
          </div>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="https://github.com/alistairfoxlondon-pixel/Upscaler-Free"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            title="View Open Source Code on GitHub"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">Star on GitHub</span>
            <span className="text-[11px] text-slate-400 font-mono">MIT</span>
          </a>
        </div>
      </div>
    </header>
  );
};
