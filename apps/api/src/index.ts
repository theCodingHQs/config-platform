import { buildServer, checkDemoAccountWarning } from './server.js';
import { initializeMetadataCatalog } from './db/catalog-init.js';
import { pool } from './db/pool.js';
import { startReportScheduler } from './reports/report-scheduler.js';
import { platformSettings } from './platform/platform-settings.js';
import { liveHub } from './live/live-hub.js';

async function start() {
  try {
    console.log('Initializing metadata catalog in public schema...');
    await initializeMetadataCatalog(pool);
    console.log('Metadata catalog ready.');

    if (process.env.NODE_ENV === 'production') {
      await checkDemoAccountWarning();
    }

    const server = await buildServer();
    const port = Number(process.env.PORT) || 4000;
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });
    console.log(`Backend API listening on http://${host}:${port}`);
    startReportScheduler();
    platformSettings.startAutoRefresh();
    // Live connections (machine gateways, MQTT…) start after the server is up
    liveHub.start().catch((err) => console.error('[live] could not start connections:', err));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
