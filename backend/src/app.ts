import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { config } from './config';
import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import { ValidationError } from './services/scheduler';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api', emailRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Express 5 forwards rejected promises from async handlers here.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: err.issues });
    }
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
