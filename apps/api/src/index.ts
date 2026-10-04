import { buildServer, checkDemoAccountWarning } from './server.js';
import { initializeMetadataCatalog } from './db/catalog-init.js';
import { pool } from './db/pool.js';

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
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
