import path from 'node:path';
import express from 'express';
import { createApp } from './server/app.ts';

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

async function start() {
  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve('dist');
    app.use(express.static(dist, { maxAge: '1y', immutable: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`OpenUpscale listening on http://0.0.0.0:${PORT}`));
}

start();
