import { ArrowUpRight, Github } from 'lucide-react';
export function Header({ onOpenDocs }: { onOpenDocs: () => void }) {
  return <header className="site-header">
    <div className="header-inner">
      <a className="wordmark" href="/" aria-label="OpenUpscale home"><span className="brand-symbol"><ArrowUpRight size={24} strokeWidth={2.4} /></span>OpenUpscale<span className="free-label">FREE</span></a>
      <nav aria-label="Main navigation">
        <button className="nav-link" onClick={onOpenDocs}>How it works</button>
        <a className="github-link" href="https://github.com/alistairfoxlondon-pixel/Upscaler-Free" target="_blank" rel="noreferrer" aria-label="OpenUpscale on GitHub (opens in a new tab)"><Github size={17} /><span>Open source</span><ArrowUpRight className="external-arrow" size={14} /></a>
      </nav>
    </div>
  </header>;
}
