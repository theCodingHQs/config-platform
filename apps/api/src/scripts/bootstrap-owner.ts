/**
 * Bootstrap Owner Script.
 * One-time script that creates the first owner from env vars or interactive CLI prompts.
 * Refuses to run if any tenant already exists in the database.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { pool } from '../db/pool.js';
import { initializeMetadataCatalog } from '../db/catalog-init.js';
import { defaultStorageAdapter } from '../db/storage-adapter.js';
import { validatePassword } from '../auth/auth-service.js';

export interface BootstrapOwnerOptions {
  email?: string;
  password?: string;
  tenantName?: string;
}

export interface BootstrapOwnerResult {
  userId: string;
  tenantId: string;
  email: string;
  tenantName: string;
}

export async function bootstrapOwner(options?: BootstrapOwnerOptions): Promise<BootstrapOwnerResult> {
  // 0. Ensure catalog migrations are applied first
  await initializeMetadataCatalog(pool);

  // 1. Refuse to run if any tenant already exists
  const existing = await pool.query('SELECT COUNT(*)::int AS count FROM public.tenant');
  if (existing.rows[0]?.count > 0) {
    throw new Error('Bootstrap rejected: tenants already exist in database.');
  }

  // 2. Read parameters from options, environment, or interactive prompt
  let email = options?.email || process.env.BOOTSTRAP_EMAIL || process.env.OWNER_EMAIL;
  let password = options?.password || process.env.BOOTSTRAP_PASSWORD || process.env.OWNER_PASSWORD;
  let tenantName = options?.tenantName || process.env.BOOTSTRAP_TENANT_NAME || process.env.TENANT_NAME;

  if (!email || !password) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input, output });
      try {
        if (!email) {
          email = await rl.question('Owner email address: ');
        }
        if (!password) {
          password = await rl.question('Owner password (min 10 chars): ');
        }
        if (!tenantName) {
          const nameInput = await rl.question('Initial workspace name [Primary Workspace]: ');
          tenantName = nameInput.trim() || 'Primary Workspace';
        }
      } finally {
        rl.close();
      }
    } else {
      throw new Error(
        'BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD environment variables are required when running non-interactively.'
      );
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Owner email address is required.');
  }
  validatePassword(password);
  const finalTenantName = (tenantName || 'Primary Workspace').trim();

  const hash = await argon2.hash(password);
  const tenantId = `t_${crypto.randomBytes(8).toString('hex')}`;
  const userId = `u_${crypto.randomBytes(8).toString('hex')}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create tenant
    await client.query(
      `INSERT INTO public.tenant (id, name, schema_version, created_at)
       VALUES ($1, $2, 1, NOW())`,
      [tenantId, finalTenantName]
    );

    // Create owner app_user with email_verified = true
    await client.query(
      `INSERT INTO public.app_user (id, email, password_hash, last_tenant_id, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())`,
      [userId, normalizedEmail, hash, tenantId]
    );

    // Add member as owner
    await client.query(
      `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
       VALUES ($1, $2, 'owner', NOW())`,
      [userId, tenantId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Provision tenant PostgreSQL schema
  await defaultStorageAdapter.initTenant(tenantId);

  return {
    userId,
    tenantId,
    email: normalizedEmail,
    tenantName: finalTenantName,
  };
}

// Direct execution from CLI
const isDirectCli = process.argv[1]?.endsWith('bootstrap-owner.ts') || process.argv[1]?.endsWith('bootstrap-owner.js');
if (isDirectCli) {
  bootstrapOwner()
    .then((result) => {
      console.log('Successfully bootstrapped initial owner and workspace:');
      console.log(`  Tenant ID:   ${result.tenantId}`);
      console.log(`  Workspace:   ${result.tenantName}`);
      console.log(`  Owner Email: ${result.email}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Bootstrap failed: ${err.message}`);
      process.exit(1);
    });
}
