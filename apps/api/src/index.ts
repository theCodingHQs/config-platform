import { buildServer, checkDemoAccountWarning } from './server.js';
import { initializeMetadataCatalog } from './db/catalog-init.js';
import { pool } from './db/pool.js';
import { startReportScheduler } from './reports/report-scheduler.js';
import { platformSettings } from './platform/platform-settings.js';
import { liveCluster } from './live/cluster/index.js';

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
    // Live connections and rules run on one server (the leader); all share live data
    liveCluster.start().catch((err) => console.error('[live] could not start:', err));
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
