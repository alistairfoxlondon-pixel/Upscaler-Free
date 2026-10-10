import express from 'express';
import path from 'node:path';
import { createApp } from './server/app.ts';

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;
async function start() {
  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve('dist');
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(dist, { maxAge: 0 }));
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`OpenUpscale listening on http://0.0.0.0:${PORT}`));
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
}
start().catch(error => { console.error('Unable to start OpenUpscale:', error); process.exitCode = 1; });
