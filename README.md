# Config Platform

A multi-tenant, metadata-driven configuration and business application platform built with Node.js, Fastify, PostgreSQL, and React.

---

## Development Setup

The platform ships zero dummy or demo data. Workspaces start completely clean.

1. **Start local PostgreSQL** (provisions development & test databases via Docker Compose):
   ```bash
   pnpm test:db:up
   ```

2. **Start the Backend API** (catalog migrations run automatically on startup under advisory lock, creating all required tables):
   ```bash
   pnpm dev:api
   ```

3. **Bootstrap the Initial Workspace Owner**:
   ```bash
   pnpm bootstrap:owner
   ```
   *(Prompts for owner email, secure password, and workspace name, or reads `BOOTSTRAP_*` environment variables).*

4. **Add Additional Users (Any Role, Anytime)**:
   ```bash
   # Interactive prompt:
   pnpm user:add

   # Or via CLI arguments / environment variables:
   pnpm user:add --email member@company.com --role editor --tenant "Primary Workspace" --password "SecurePass2026!"

   # In production Docker container:
   pnpm user:add:prod
   ```

5. **Start the Web Frontend**:
   ```bash
   pnpm dev:web
   ```

---

## Deploy

### Single-Port Architecture

In production, the Fastify API service serves both the API routes and the built React web application (`apps/web/dist` via `@fastify/static`):
- **All API routes** are mounted under the `/api` prefix (e.g. `/api/auth/*`, `/api/schema/*`, `/api/entities/*`, `/api/pages/*`, `/api/members/*`, `/api/workspace/*`, `/api/audit-logs`).
- **Health probes** remain at the root level: `/health`, `/health/live` (liveness probe), and `/health/ready` (readiness probe).
- **Static Assets & SPA Fallback**: All non-`/api` and non-`/health` GET routes fall back to `index.html` for client-side routing.
- **Cache-Control Policy**:
  - Hashed static assets (`/assets/*`): `public, max-age=31536000, immutable`
  - HTML entry point (`index.html` and `/`): `no-store, no-cache, must-revalidate`
- **CORS Policy**: In production, CORS is **OFF by default** (`origin: false`), as the web app is served directly from the same origin. Set `WEB_URL` only if accessing the API from a distinct origin.

---

### Required Environment Variables

#### 1. Secrets (Sensitive Credentials)
The codebase reads the following exact secret environment variables:

| Secret Variable | Required | Description | Example |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **Yes** | Primary pooled PostgreSQL connection URI for application queries. The only required DB variable. | `postgresql://user:pass@ep-pooler.neon.tech/dbname?sslmode=require` |
| `DATABASE_URL_DIRECT` | Optional | Direct unpooled PostgreSQL connection URI for DDL migrations & advisory locking. Defaults to `DATABASE_URL`. | `postgresql://user:pass@ep-direct.neon.tech/dbname?sslmode=require` |
| `COOKIE_SECRET` | **Yes** | 32+ character cryptographic secret for signing session cookies | `your-32-char-random-secret-must-be-long!` |
| `RESEND_API_KEY` | Conditional | API key for Resend email service (required if using Resend) | `re_1234567890` |
| `SMTP_URL` | Conditional | SMTP connection URI (required if using SMTP instead of Resend) | `smtp://user:pass@smtp.mailgun.org:587` |
| `TEST_DATABASE_URL` | Optional (test only) | Dedicated test database URI used during test suites. Defaults to `postgresql://postgres:postgres@localhost:5432/config_platform_test`. Refuses to run if it matches or points to the same host and database as `DATABASE_URL`. | `postgresql://postgres:postgres@localhost:5432/config_platform_test` |

#### 2. Non-Secret Configuration

| Configuration Variable | Required | Description | Default |
| :--- | :--- | :--- | :--- |
| `PUBLIC_URL` | **Yes** | Canonical public base URL for verification emails, invite links, and assets | `http://localhost:4000` |
| `NODE_ENV` | Recommended | Environment mode (`production`, `development`, `test`) | `development` |
| `PORT` | Optional | Port for the API server | `4000` |
| `HOST` | Optional | Network host address to bind the server to | `0.0.0.0` |
| `SIGNUP_MODE` | Optional | Registration mode: `open` or `invite_only`. In production, defaults to `invite_only` | `invite_only` in prod, `open` in dev |
| `EMAIL_FROM` | Conditional | Sender address. **REQUIRED** in production when `RESEND_API_KEY` or `SMTP_URL` is configured | `noreply@yourdomain.com` |
| `REQUIRE_EMAIL_VERIFICATION` | Optional | Enforce verification before login. Must be explicitly `false` in prod if no email provider is configured | `false` |
| `STATEMENT_TIMEOUT_MS` | Optional | Database statement execution timeout in milliseconds coerced before `SET LOCAL` | `10000` |
| `TRUST_PROXY` | Optional | Fastify reverse proxy trust setting (`true`, `false`, or IP/CIDR) for client IP rate limiting | `false` |
| `WEB_URL` | Optional | Allowed CORS origin. In production, CORS is disabled by default; set this only for cross-origin setups | `http://localhost:3000` in dev, disabled in prod |
| `WEB_DIST_PATH` | Optional | Filesystem path to pre-built web client distribution folder | `apps/web/dist` |

> **Production Startup Guards**:
> 1. If `NODE_ENV=production` and `REQUIRE_EMAIL_VERIFICATION` is not explicitly set to `false`, server startup fails immediately unless either `RESEND_API_KEY` or `SMTP_URL` is configured.
> 2. If `NODE_ENV=production` and an email provider (`RESEND_API_KEY` or `SMTP_URL`) is configured, `EMAIL_FROM` is strictly required; startup fails otherwise.
> 3. If `NODE_ENV=production` and the demo account `admin@example.com` exists in the database, a prominent security warning is emitted at startup.

---

### Initial Workspace Owner Bootstrap

When `SIGNUP_MODE=invite_only` (production default), public registration via `POST /api/auth/signup` is rejected with HTTP 403. To initialize the first workspace and owner:

```bash
# In local development:
pnpm bootstrap:owner

# Non-interactive mode (using environment variables):
BOOTSTRAP_EMAIL="owner@yourdomain.com" \
BOOTSTRAP_PASSWORD="YourSecurePassword123!" \
BOOTSTRAP_TENANT_NAME="Production Workspace" \
pnpm bootstrap:owner
```

#### Inside Built Production Docker Container
Inside the production Docker container (`ENV NODE_ENV=production`), execute the compiled JavaScript entrypoint directly without dev tooling (`tsx` not required):

```bash
# 1. Run inside an active production container:
docker exec -it config-platform node apps/api/dist/scripts/bootstrap-owner.js

# 2. Or as a one-off task container:
docker run --rm -it --env-file .env config-platform:latest node apps/api/dist/scripts/bootstrap-owner.js
```

*Note: The bootstrap script strictly refuses to run if any tenant already exists in the database.*

---

### Database Cleanliness Verification

Run `check:db-clean` to inspect the database state before launch:

```bash
pnpm check:db-clean
```

This command:
- Prints total tenant count and list of all tenants.
- Prints total user count and user emails.
- Flags demo accounts (`admin@example.com`) or default demo tenants (`default` / `Demo Enterprise`).

---

### Workspace Teardown API & Append-Only Audit Trigger

The `DELETE /api/workspace/tenant` endpoint allows workspace owners to delete their tenant and drop its schema:
- **Authentication & Authorization**: Owner role required; requests without owner privileges return HTTP 403.
- **Confirmation & Verification**: Body requires `{ "confirmName": "<tenantName>", "password": "<ownerPassword>" }`. Mismatched name returns HTTP 400; incorrect password returns HTTP 401.
- **Rate-Limiting**: Strictly rate-limited per IP/client.
- **Audit Logging**: An audit log entry (`workspace.delete`) is recorded prior to deletion.
- **Scoped Trigger Interaction**: The `public.audit_log` table enforces an append-only rule via trigger `trg_audit_log_append_only`. Disabling triggers globally (`ALTER TABLE ... DISABLE TRIGGER`) is prohibited because it compromises database-wide immutability. Instead, the teardown transaction executes `SET LOCAL audit.allow_tenant_purge = 'on'`, a session-local flag that permits cleanup exclusively within that transaction while maintaining global trigger enforcement across all other sessions.

---

### Local Database & Testing (Docker Compose)

The repository provides separated Docker configurations for development and customer-facing deployments:

#### 1. Local Development & Testing (`postgres` service)
- **Host Port**: Published on `5432:5432` for direct host access.
- **Credentials**: Simple local credentials (`postgres` / `postgres`).
- **Databases**: Auto-provisions both `config_platform` (dev) and `config_platform_test` (test).

```bash
# Start local Postgres service
pnpm test:db:up

# Stop local Postgres service
pnpm test:db:down
```

#### 2. Customer-Facing Production Stack (`customer` profile / `docker-compose.customer.yml`)
- **No Published Port**: The PostgreSQL container exposes port 5432 only within an isolated Docker internal network (`expose: ["5432"]`), preventing unauthorized exposure on the host network.
- **Generated Password**: Requires `DB_PASSWORD` from the environment or `.env` rather than default passwords.

```bash
# Start customer-facing production stack
DB_PASSWORD=$(openssl rand -hex 16) COOKIE_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker-compose.customer.yml up -d
```

#### Test Database Safety & Automated Schema Teardown
- **Refusal on Conflict**: Test startup strictly refuses to run if `TEST_DATABASE_URL` equals `DATABASE_URL` or points to the same host and database, protecting dev and production data from accidental test pollution.
- **Automated Schema Teardown**: Vitest global teardown automatically records initial schemas, drops every schema created during the test run (`CASCADE`), and resets the test database's public schema between runs, even when a test assertion fails or an error is thrown.

---

### Docker Deployment & Verification

A multi-stage, non-root Dockerfile is included at the repository root.

```bash
# 1. Build the production Docker image
docker build -t config-platform:latest .

# 2. Run container with environment configuration
docker run -d \
  --name config-platform \
  -p 4000:4000 \
  --env-file .env \
  config-platform:latest
```

The container runs as non-root user `appuser` (UID 1001), exposes port 4000, and includes a built-in Docker `HEALTHCHECK` probing `/health/live`.

#### CI-Style Docker Verification Script
Run the automated Docker check script (builds image, starts container with test env vars, waits for `/health/ready`, runs smoke test, and tears down):

```bash
./scripts/docker-check.sh
```

---

### Smoke Test Script

Run the automated smoke test script against any running deployment (local, staging, or production):

```bash
# Standard staging mode (default: full CRUD test and automatic tenant/schema teardown):
SMOKE_MODE=staging ./scripts/smoke.sh http://localhost:4000

# Read-only mode (validates /health/live, /health/ready, and root HTML without mutations):
SMOKE_MODE=readonly ./scripts/smoke.sh https://production.yourdomain.com
```

- When `SIGNUP_MODE=invite_only` blocks registration on a target deployment, `smoke.sh` exits with an actionable message directing operators to use `SMOKE_MODE=readonly` for production or run against staging where registration is enabled.
