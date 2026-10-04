import type { Pool } from 'pg';
import { pool, directPool } from './pool.js';
import { runCatalogMigrations } from './catalog-migration-runner.js';

let catalogReady = false;

export function isCatalogReady(): boolean {
  return catalogReady;
}

export function setCatalogReady(ready: boolean): void {
  catalogReady = ready;
}

export async function initializeMetadataCatalog(customPool?: Pool): Promise<void> {
  catalogReady = false;
  try {
    const db = customPool || directPool;
    await runCatalogMigrations(db);
    catalogReady = true;
  } catch (err) {
    catalogReady = false;
    throw err;
  }
}
