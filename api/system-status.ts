import type { Request, Response } from 'express';
import { securityHeaders, systemStatus } from '../server/http.ts';
export default function handler(req: Request, res: Response) {
  securityHeaders(res);
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Use GET for system status.' }); }
  return res.status(200).json(systemStatus());
}
