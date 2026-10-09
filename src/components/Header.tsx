import { Github, Layers, BookOpen } from 'lucide-react';

interface HeaderProps {
  onOpenDocs: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenDocs }) => (
  <header className="sticky top-0 z-40 w-full border-b border-line bg-surface/85 backdrop-blur">
    <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <a href="/" className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
          <Layers className="h-4.5 w-4.5" />
        </span>
        <span className="text-base font-bold tracking-tight text-ink">OpenUpscale</span>
      </a>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpenDocs}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:bg-canvas hover:text-ink"
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">How it works</span>
        </button>
        <a
          href="https://github.com/alistairfoxlondon-pixel/Upscaler-Free"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          <Github className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </div>
  </header>
);
