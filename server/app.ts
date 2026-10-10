import express from 'express';
import { securityHeaders, systemStatus, upscaleHandler } from './http.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
  app.get('/api/system-status', (_req, res) => { securityHeaders(res); res.json(systemStatus()); });
  app.all('/api/upscale', upscaleHandler);
  app.all('/api/*', (_req, res) => { securityHeaders(res); res.status(404).json({ error: 'API route not found.', code: 'NOT_FOUND' }); });
  return app;
}
