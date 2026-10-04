/**
 * Database Cleanliness Verification Script.
 * Prints total tenant count, user emails, and flags admin@example.com or any default tenant.
 *
 * Usage:
 *   pnpm check:db-clean
 */

import { pool } from '../db/pool.js';

export interface DbCleanReport {
  clean: boolean;
  tenantCount: number;
  userCount: number;
  tenants: Array<{ id: string; name: string; createdAt: string; flagged: boolean }>;
  users: Array<{ email: string; emailVerified: boolean; flagged: boolean }>;
  flags: string[];
}

export async function checkDbClean(): Promise<DbCleanReport> {
  const flags: string[] = [];

  // Query tenants
  const tenantRows = await pool.query<{ id: string; name: string; created_at: Date }>(
    `SELECT id, name, created_at FROM public.tenant ORDER BY created_at ASC`
  );

  const tenants = tenantRows.rows.map((t) => {
    const isDefault = t.id === 'default' || t.name.toLowerCase().includes('demo enterprise');
    if (isDefault) {
      flags.push(`Default demo tenant detected: id="${t.id}", name="${t.name}"`);
    }
    return {
      id: t.id,
      name: t.name,
      createdAt: t.created_at ? new Date(t.created_at).toISOString() : 'unknown',
      flagged: isDefault,
    };
  });

  // Query users
  const userRows = await pool.query<{ email: string; email_verified: boolean }>(
    `SELECT email, email_verified FROM public.app_user ORDER BY created_at ASC`
  );

  const users = userRows.rows.map((u) => {
    const isDemo = u.email.toLowerCase() === 'admin@example.com';
    if (isDemo) {
      flags.push(`Demo user account detected: "${u.email}"`);
    }
    return {
      email: u.email,
      emailVerified: Boolean(u.email_verified),
      flagged: isDemo,
    };
  });

  const clean = flags.length === 0;

  return {
    clean,
    tenantCount: tenants.length,
    userCount: users.length,
    tenants,
    users,
    flags,
  };
}

// Direct execution from CLI
const isDirectCli = process.argv[1]?.endsWith('check-db-clean.ts') || process.argv[1]?.endsWith('check-db-clean.js');
if (isDirectCli) {
  checkDbClean()
    .then((report) => {
      console.log('==============================================================================');
      console.log('Database Cleanliness Report');
      console.log('==============================================================================');
      console.log(`Total Tenants: ${report.tenantCount}`);
      for (const t of report.tenants) {
        const flagText = t.flagged ? ' [FLAGGED: Demo Tenant]' : '';
        console.log(`  - [${t.id}] "${t.name}" (created: ${t.createdAt})${flagText}`);
      }
      console.log('------------------------------------------------------------------------------');
      console.log(`Total Users: ${report.userCount}`);
      for (const u of report.users) {
        const flagText = u.flagged ? ' [FLAGGED: Demo Account]' : '';
        console.log(`  - ${u.email} (verified: ${u.emailVerified})${flagText}`);
      }
      console.log('==============================================================================');
      if (report.clean) {
        console.log('[OK] Database is clean: No demo accounts or default demo tenants detected.');
        process.exit(0);
      } else {
        console.warn(`[WARNING] Database contains ${report.flags.length} flagged item(s):`);
        for (const flag of report.flags) {
          console.warn(`  - ${flag}`);
        }
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error(`Check DB Clean failed: ${err.message}`);
      process.exit(1);
    });
}
