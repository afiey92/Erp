import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { catalogRoutes } from './routes/catalog.js';
import { purchasingRoutes } from './routes/purchasing.js';
import { reportsRoutes } from './routes/reports.js';
import { salesRoutes } from './routes/sales.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

export function createApp(store) {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'meog-erp' });
  });

  app.use('/api', catalogRoutes(store));
  app.use('/api', salesRoutes(store));
  app.use('/api', purchasingRoutes(store));
  app.use('/api', reportsRoutes(store));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON.' });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message = status === 500 ? 'Unexpected server error.' : error.message;
    if (status === 500) console.error(error);
    return res.status(status).json({ error: message });
  });

  return app;
}
