#!/usr/bin/env bash
# ==============================================================================
# Smoke Test Script for Config Platform
# Usage: ./scripts/smoke.sh [BASE_URL]
# Example: ./scripts/smoke.sh http://localhost:4000
#
# Environment variables:
#   SMOKE_MODE=staging|readonly|production (default: staging; assumes email verification disabled)
#   DATABASE_URL (optional: fallback for direct DB cleanup if endpoint unreachable)
# ==============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:4000}"
# Trim trailing slash if present
BASE_URL="${BASE_URL%/}"
SMOKE_MODE="${SMOKE_MODE:-staging}"

COOKIE_JAR="$(mktemp)"
TENANT_ID=""
CSRF_TOKEN=""
SMOKE_TENANT=""
SMOKE_PASSWORD=""
CLEANED_UP=0

cleanup() {
  local exit_code=$?
  if [ "$CLEANED_UP" -eq 0 ] && [ -n "${TENANT_ID:-}" ] && [ -n "${CSRF_TOKEN:-}" ]; then
    CLEANED_UP=1
    echo "[CLEANUP] Cleaning up throwaway tenant '$TENANT_ID' and its PostgreSQL schema..."
    TEARDOWN_BODY="{\"confirmName\":\"$SMOKE_TENANT\",\"password\":\"$SMOKE_PASSWORD\"}"
    CLEANUP_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
      -H "Content-Type: application/json" \
      -H "x-csrf-token: $CSRF_TOKEN" \
      -d "$TEARDOWN_BODY" \
      -X DELETE \
      "$BASE_URL/api/workspace/tenant" || true)
    CLEANUP_CODE=$(echo "$CLEANUP_RESP" | tail -n1)
    if [ "$CLEANUP_CODE" = "200" ]; then
      echo "[OK] Throwaway tenant '$TENANT_ID' and schema cleaned up."
    else
      echo "[WARN] Cleanup endpoint returned status $CLEANUP_CODE."
      if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
        echo "[INFO] Running direct DB cleanup fallback via psql..."
        psql "$DATABASE_URL" -c "DROP SCHEMA IF EXISTS \"t_${TENANT_ID}\" CASCADE; DELETE FROM public.tenant WHERE id = '${TENANT_ID}';" >/dev/null 2>&1 || true
      fi
    fi
  fi
  rm -f "$COOKIE_JAR"
  exit $exit_code
}
trap cleanup EXIT INT TERM

echo "[INFO] Running smoke test against base URL: $BASE_URL (SMOKE_MODE: $SMOKE_MODE)"

# ==============================================================================
# READONLY MODE (SMOKE_MODE=readonly)
# Checks only /health/live, /health/ready, and that root page serves HTML.
# ==============================================================================
if [ "$SMOKE_MODE" = "readonly" ]; then
  echo "[INFO] Executing read-only smoke checks (no mutations)..."

  # 1. /health/live
  echo "[READONLY 1/3] Checking /health/live..."
  LIVE_RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health/live")
  LIVE_CODE=$(echo "$LIVE_RESP" | tail -n1)
  LIVE_BODY=$(echo "$LIVE_RESP" | head -n -1)
  if [ "$LIVE_CODE" -ne 200 ] || [[ "$LIVE_BODY" != *"live"* ]]; then
    echo "[ERROR] Liveness probe failed (HTTP $LIVE_CODE): $LIVE_BODY"
    exit 1
  fi
  echo "[OK] /health/live returned 200 ($LIVE_BODY)"

  # 2. /health/ready
  echo "[READONLY 2/3] Checking /health/ready..."
  READY_RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health/ready")
  READY_CODE=$(echo "$READY_RESP" | tail -n1)
  READY_BODY=$(echo "$READY_RESP" | head -n -1)
  if [ "$READY_CODE" -ne 200 ] || [[ "$READY_BODY" != *"ready"* ]]; then
    echo "[ERROR] Readiness probe failed (HTTP $READY_CODE): $READY_BODY"
    exit 1
  fi
  echo "[OK] /health/ready returned 200 ($READY_BODY)"

  # 3. Root page serves HTML
  echo "[READONLY 3/3] Checking root URL serves HTML..."
  ROOT_RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/")
  ROOT_CODE=$(echo "$ROOT_RESP" | tail -n1)
  ROOT_BODY=$(echo "$ROOT_RESP" | head -n -1)
  if [ "$ROOT_CODE" -ne 200 ] || ! echo "$ROOT_BODY" | grep -iq "<!DOCTYPE html>\|<html"; then
    echo "[ERROR] Root URL did not serve HTML (HTTP $ROOT_CODE)"
    exit 1
  fi
  echo "[OK] Root URL served HTML successfully (HTTP 200)"

  echo "=========================================================================="
  echo "Read-only smoke test passed successfully against $BASE_URL!"
  echo "=========================================================================="
  exit 0
fi

if [ "$SMOKE_MODE" = "staging" ]; then
  echo "[INFO] Staging mode: Assumes email verification is disabled on target deployment."
fi

# ------------------------------------------------------------------------------
# 1. Check /health/ready
# ------------------------------------------------------------------------------
echo "[STEP 1/7] Checking /health/ready..."
READY_RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/health/ready")
READY_HTTP_CODE=$(echo "$READY_RESP" | tail -n1)
READY_BODY=$(echo "$READY_RESP" | head -n -1)

if [ "$READY_HTTP_CODE" -ne 200 ]; then
  echo "[ERROR] Readiness check failed with status $READY_HTTP_CODE: $READY_BODY"
  exit 1
fi
echo "[OK] /health/ready returned 200 (status: ready)"

# ------------------------------------------------------------------------------
# 2. Retrieve CSRF token
# ------------------------------------------------------------------------------
echo "[STEP 2/7] Fetching CSRF token from /api/auth/csrf..."
CSRF_JSON=$(curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/auth/csrf")
CSRF_TOKEN=$(echo "$CSRF_JSON" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4 || true)

if [ -z "$CSRF_TOKEN" ]; then
  # Fallback: extract from cookie jar
  CSRF_TOKEN=$(grep 'csrf_token' "$COOKIE_JAR" | awk '{print $NF}' || true)
fi

if [ -z "$CSRF_TOKEN" ]; then
  echo "[ERROR] Failed to extract CSRF token: $CSRF_JSON"
  exit 1
fi
echo "[OK] CSRF token acquired"

# ------------------------------------------------------------------------------
# 3. Sign up a throwaway user and tenant
# ------------------------------------------------------------------------------
RANDOM_SUFFIX="$(date +%s)_$RANDOM"
SMOKE_EMAIL="smoke_${RANDOM_SUFFIX}@example.com"
SMOKE_PASSWORD="SmokeTestPassword123!"
SMOKE_TENANT="Smoke Tenant ${RANDOM_SUFFIX}"

echo "[STEP 3/7] Signing up throwaway user: $SMOKE_EMAIL..."
SIGNUP_PAYLOAD=$(cat <<EOF
{
  "email": "$SMOKE_EMAIL",
  "password": "$SMOKE_PASSWORD",
  "tenantName": "$SMOKE_TENANT"
}
EOF
)

SIGNUP_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d "$SIGNUP_PAYLOAD" \
  "$BASE_URL/api/auth/signup")

SIGNUP_CODE=$(echo "$SIGNUP_RESP" | tail -n1)
SIGNUP_BODY=$(echo "$SIGNUP_RESP" | head -n -1)

# Check if signup was blocked by SIGNUP_MODE=invite_only
if [ "$SIGNUP_CODE" -eq 403 ] || [[ "$SIGNUP_BODY" == *"Public registration is disabled"* ]]; then
  echo "[ERROR] Public signup is disabled on this target deployment (SIGNUP_MODE=invite_only)."
  echo "[HINT] To run automated smoke tests:"
  echo "       - For live/production targets without registration: run with SMOKE_MODE=readonly"
  echo "       - For end-to-end mutation testing: run against staging where SIGNUP_MODE=open"
  exit 1
fi

if [ "$SIGNUP_CODE" -ne 201 ]; then
  echo "[ERROR] Signup failed with status $SIGNUP_CODE: $SIGNUP_BODY"
  exit 1
fi

TENANT_ID=$(echo "$SIGNUP_BODY" | grep -o '"tenantId":"[^"]*' | head -n1 | cut -d'"' -f4 || true)
if [ -z "$TENANT_ID" ]; then
  echo "[ERROR] Failed to extract tenantId from signup response: $SIGNUP_BODY"
  exit 1
fi
echo "[OK] User signed up successfully (tenantId: $TENANT_ID)"

# Refresh CSRF token for the authenticated session
CSRF_JSON=$(curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/auth/csrf")
NEW_CSRF=$(echo "$CSRF_JSON" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4 || true)
if [ -n "$NEW_CSRF" ]; then
  CSRF_TOKEN="$NEW_CSRF"
fi

# ------------------------------------------------------------------------------
# 4. Create an entity via Schema API
# ------------------------------------------------------------------------------
ENTITY_NAME="smoke_item_${RANDOM_SUFFIX}"
echo "[STEP 4/7] Creating entity '$ENTITY_NAME'..."

ENTITY_PAYLOAD=$(cat <<EOF
{
  "name": "$ENTITY_NAME",
  "label": "Smoke Test Entity",
  "fields": [
    {
      "name": "title",
      "label": "Title",
      "type": "text",
      "required": true
    },
    {
      "name": "price",
      "label": "Price",
      "type": "number",
      "required": false
    }
  ]
}
EOF
)

ENTITY_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d "$ENTITY_PAYLOAD" \
  "$BASE_URL/api/schema/entities")

ENTITY_CODE=$(echo "$ENTITY_RESP" | tail -n1)
ENTITY_BODY=$(echo "$ENTITY_RESP" | head -n -1)

if [ "$ENTITY_CODE" -ne 201 ]; then
  echo "[ERROR] Entity creation failed with status $ENTITY_CODE: $ENTITY_BODY"
  exit 1
fi
echo "[OK] Entity '$ENTITY_NAME' created"

# ------------------------------------------------------------------------------
# 5. Create and read back a record
# ------------------------------------------------------------------------------
echo "[STEP 5/7] Creating record in '$ENTITY_NAME'..."
RECORD_TITLE="Smoke Record ${RANDOM_SUFFIX}"
RECORD_PAYLOAD=$(cat <<EOF
{
  "title": "$RECORD_TITLE",
  "price": 125
}
EOF
)

RECORD_CREATE_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d "$RECORD_PAYLOAD" \
  "$BASE_URL/api/entities/$ENTITY_NAME/records")

RECORD_CREATE_CODE=$(echo "$RECORD_CREATE_RESP" | tail -n1)
RECORD_CREATE_BODY=$(echo "$RECORD_CREATE_RESP" | head -n -1)

if [ "$RECORD_CREATE_CODE" -ne 201 ]; then
  echo "[ERROR] Record creation failed with status $RECORD_CREATE_CODE: $RECORD_CREATE_BODY"
  exit 1
fi

RECORD_ID=$(echo "$RECORD_CREATE_BODY" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4 || true)
if [ -z "$RECORD_ID" ]; then
  echo "[ERROR] Could not extract record ID from: $RECORD_CREATE_BODY"
  exit 1
fi
echo "[OK] Record created with ID: $RECORD_ID"

echo "[INFO] Reading back record '$RECORD_ID'..."
READ_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  "$BASE_URL/api/entities/$ENTITY_NAME/records/$RECORD_ID")

READ_CODE=$(echo "$READ_RESP" | tail -n1)
READ_BODY=$(echo "$READ_RESP" | head -n -1)

if [ "$READ_CODE" -ne 200 ]; then
  echo "[ERROR] Record readback failed with status $READ_CODE: $READ_BODY"
  exit 1
fi

if [[ "$READ_BODY" != *"$RECORD_TITLE"* ]]; then
  echo "[ERROR] Read record does not contain expected title: $READ_BODY"
  exit 1
fi
echo "[OK] Record read back successfully and content verified"

# ------------------------------------------------------------------------------
# 6. Teardown throwaway tenant & schema (admin-only endpoint)
# ------------------------------------------------------------------------------
echo "[STEP 6/7] Tearing down throwaway tenant and schema via admin endpoint..."
TEARDOWN_PAYLOAD=$(cat <<EOF
{
  "confirmName": "$SMOKE_TENANT",
  "password": "$SMOKE_PASSWORD"
}
EOF
)

TEARDOWN_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $CSRF_TOKEN" \
  -d "$TEARDOWN_PAYLOAD" \
  -X DELETE \
  "$BASE_URL/api/workspace/tenant")

TEARDOWN_CODE=$(echo "$TEARDOWN_RESP" | tail -n1)
TEARDOWN_BODY=$(echo "$TEARDOWN_RESP" | head -n -1)

if [ "$TEARDOWN_CODE" -ne 200 ]; then
  echo "[ERROR] Teardown failed with status $TEARDOWN_CODE: $TEARDOWN_BODY"
  exit 1
fi
CLEANED_UP=1
echo "[OK] Tenant '$TENANT_ID' and its isolated schema successfully torn down"

# ------------------------------------------------------------------------------
# 7. Verify session is invalidated
# ------------------------------------------------------------------------------
echo "[STEP 7/7] Verifying session is invalidated after tenant teardown..."
AUTH_CHECK_RESP=$(curl -s -w "\n%{http_code}" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  "$BASE_URL/api/auth/me")
AUTH_CHECK_CODE=$(echo "$AUTH_CHECK_RESP" | tail -n1)

if [ "$AUTH_CHECK_CODE" -ne 401 ]; then
  echo "[WARN] Expected HTTP 401 after tenant teardown, got $AUTH_CHECK_CODE"
else
  echo "[OK] Session successfully invalidated (HTTP 401)"
fi

echo "=========================================================================="
echo "Smoke test passed successfully against $BASE_URL with zero leftover state!"
echo "=========================================================================="
exit 0
