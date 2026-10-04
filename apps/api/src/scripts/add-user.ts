/**
 * Add User Script.
 * Creates a user with a specified role in an existing tenant.
 * Accepts parameters from CLI arguments, environment variables, or interactive prompts.
 * Validates password rules, tenant existence, role validity, and records an audit log entry.
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { pool } from '../db/pool.js';
import { initializeMetadataCatalog } from '../db/catalog-init.js';
import { validatePassword } from '../auth/auth-service.js';
import { auditLogService } from '../audit/audit-service.js';
import { ROLES, isValidRole, type TenantRole } from '../auth/auth-types.js';

export interface AddUserOptions {
  email?: string;
  password?: string;
  role?: string | TenantRole;
  tenant?: string;
  tenantId?: string;
  tenantName?: string;
  actorUserId?: string;
  actorEmail?: string;
}

export interface AddUserResult {
  userId: string;
  email: string;
  role: TenantRole;
  tenantId: string;
  tenantName: string;
}

function parseCliArgs(): AddUserOptions {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: pnpm user:add [options]

Options:
  --email <email>       User email address (env: USER_EMAIL, EMAIL)
  --password <password> User password, min 10 chars (env: USER_PASSWORD, PASSWORD)
  --role <role>         User role: ${ROLES.join(', ')} (env: USER_ROLE, ROLE)
  --tenant <name|id>    Target workspace name or ID (env: TENANT_NAME, TENANT_ID)
  -h, --help            Show this help message
`);
    process.exit(0);
  }

  const options: AddUserOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) options.email = args[++i];
    else if (arg === '--password' && args[i + 1]) options.password = args[++i];
    else if (arg === '--role' && args[i + 1]) options.role = args[++i];
    else if ((arg === '--tenant' || arg === '--tenant-id' || arg === '--tenant-name') && args[i + 1]) {
      options.tenant = args[++i];
    }
  }
  return options;
}

export async function addUser(options?: AddUserOptions): Promise<AddUserResult> {
  // Ensure database catalog tables exist
  await initializeMetadataCatalog(pool);

  // 1. Resolve Target Tenant
  let tenantIdentifier =
    options?.tenant ||
    options?.tenantId ||
    options?.tenantName ||
    process.env.TENANT_ID ||
    process.env.TENANT_NAME ||
    process.env.WORKSPACE_ID ||
    process.env.WORKSPACE_NAME;

  let targetTenant: { id: string; name: string } | null = null;

  if (tenantIdentifier) {
    const res = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM public.tenant WHERE id = $1 OR LOWER(name) = LOWER($1)',
      [tenantIdentifier.trim()]
    );
    if (res.rows.length === 0) {
      throw new Error(`Workspace/Tenant "${tenantIdentifier}" not found.`);
    }
    targetTenant = res.rows[0];
  } else {
    const allTenants = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM public.tenant ORDER BY created_at ASC'
    );
    if (allTenants.rows.length === 0) {
      throw new Error('No workspaces exist in database. Please run pnpm bootstrap:owner first.');
    }

    if (allTenants.rows.length === 1) {
      targetTenant = allTenants.rows[0];
    } else if (process.stdin.isTTY) {
      console.log('Available workspaces:');
      allTenants.rows.forEach((t, idx) => {
        console.log(`  [${idx + 1}] ${t.name} (${t.id})`);
      });
      const rl = readline.createInterface({ input, output });
      try {
        const choice = await rl.question('Select workspace number or enter name/ID: ');
        const trimmedChoice = choice.trim();
        const num = parseInt(trimmedChoice, 10);
        if (!isNaN(num) && num >= 1 && num <= allTenants.rows.length) {
          targetTenant = allTenants.rows[num - 1];
        } else {
          const matched = allTenants.rows.find(
            (t) => t.id === trimmedChoice || t.name.toLowerCase() === trimmedChoice.toLowerCase()
          );
          if (!matched) {
            throw new Error(`Workspace "${trimmedChoice}" not found.`);
          }
          targetTenant = matched;
        }
      } finally {
        rl.close();
      }
    } else {
      throw new Error(
        'Multiple workspaces exist. Specify TENANT_ID or TENANT_NAME via environment variable or --tenant flag.'
      );
    }
  }

  // 2. Read user parameters
  let email = options?.email || process.env.USER_EMAIL || process.env.EMAIL;
  let role = options?.role || process.env.USER_ROLE || process.env.ROLE;
  let password = options?.password || process.env.USER_PASSWORD || process.env.PASSWORD;

  if (!email || !role || !password) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input, output });
      try {
        if (!email) {
          email = await rl.question('User email address: ');
        }
        if (!role) {
          const roleInput = await rl.question(`User role [${ROLES.join('/')}] (default: editor): `);
          role = roleInput.trim() || 'editor';
        }
        if (!password) {
          password = await rl.question('User password (min 10 chars): ');
        }
      } finally {
        rl.close();
      }
    } else {
      throw new Error(
        'USER_EMAIL, USER_ROLE, and USER_PASSWORD are required when running non-interactively.'
      );
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('A valid user email address is required.');
  }

  const normalizedRole = role.trim().toLowerCase();
  if (!isValidRole(normalizedRole)) {
    throw new Error(`Invalid role "${role}". Allowed roles: ${ROLES.join(', ')}`);
  }

  // 3. Validate password rules (length >= 10, common passwords blacklist)
  validatePassword(password);

  // 4. Create or link user in database
  const client = await pool.connect();
  let finalUserId: string;
  try {
    await client.query('BEGIN');

    const existingUserRes = await client.query<{ id: string }>(
      'SELECT id FROM public.app_user WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (existingUserRes.rows.length > 0) {
      finalUserId = existingUserRes.rows[0].id;

      // Check if user is already a member of this tenant
      const existingMemberRes = await client.query<{ role: string }>(
        'SELECT role FROM public.tenant_member WHERE user_id = $1 AND tenant_id = $2',
        [finalUserId, targetTenant.id]
      );
      if (existingMemberRes.rows.length > 0) {
        throw new Error(
          `User ${normalizedEmail} is already a member of workspace "${targetTenant.name}" with role "${existingMemberRes.rows[0].role}".`
        );
      }

      // Add to tenant members
      await client.query(
        `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [finalUserId, targetTenant.id, normalizedRole]
      );
    } else {
      finalUserId = `u_${crypto.randomBytes(8).toString('hex')}`;
      const passwordHash = await argon2.hash(password);

      // Create new app_user
      await client.query(
        `INSERT INTO public.app_user (id, email, password_hash, last_tenant_id, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())`,
        [finalUserId, normalizedEmail, passwordHash, targetTenant.id]
      );

      // Add to tenant members
      await client.query(
        `INSERT INTO public.tenant_member (user_id, tenant_id, role, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [finalUserId, targetTenant.id, normalizedRole]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 5. Write an audit log entry
  await auditLogService.log({
    tenantId: targetTenant.id,
    userId: options?.actorUserId || finalUserId,
    userEmail: options?.actorEmail || normalizedEmail,
    action: 'user.add',
    entityType: 'member',
    entityId: finalUserId,
    afterState: {
      userId: finalUserId,
      email: normalizedEmail,
      role: normalizedRole,
      tenantId: targetTenant.id,
      tenantName: targetTenant.name,
    },
  });

  return {
    userId: finalUserId,
    email: normalizedEmail,
    role: normalizedRole as TenantRole,
    tenantId: targetTenant.id,
    tenantName: targetTenant.name,
  };
}

// Direct execution from CLI
const isDirectCli = process.argv[1]?.endsWith('add-user.ts') || process.argv[1]?.endsWith('add-user.js');
if (isDirectCli) {
  const cliArgs = parseCliArgs();
  addUser(cliArgs)
    .then((result) => {
      console.log('Successfully created user:');
      console.log(`  User ID:    ${result.userId}`);
      console.log(`  Email:      ${result.email}`);
      console.log(`  Role:       ${result.role}`);
      console.log(`  Tenant ID:  ${result.tenantId}`);
      console.log(`  Workspace:  ${result.tenantName}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Failed to add user: ${err.message}`);
      process.exit(1);
    });
}
