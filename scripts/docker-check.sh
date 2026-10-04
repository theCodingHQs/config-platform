#!/usr/bin/env bash
# ==============================================================================
# CI/Local Docker Verification Script
# Builds the production Docker image, boots it with test env vars,
# waits for /health/ready, runs scripts/smoke.sh, and tears down the container.
#
# Usage: ./scripts/docker-check.sh
# ==============================================================================

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker is not installed or not in PATH."
  exit 1
fi

TEST_PORT="${TEST_PORT:-4001}"
CONTAINER_NAME="config-platform-docker-check-$$"
IMAGE_TAG="config-platform:ci-test"

# Fallback test database URL if not provided in environment
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@host.docker.internal:5432/config_platform}"
DATABASE_URL_DIRECT="${DATABASE_URL_DIRECT:-$DATABASE_URL}"

teardown() {
  local exit_code=$?
  echo "[INFO] Tearing down test container '$CONTAINER_NAME'..."
  docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  exit $exit_code
}
trap teardown EXIT INT TERM

# ------------------------------------------------------------------------------
# 1. Build production Docker image
# ------------------------------------------------------------------------------
echo "[STEP 1/4] Building production Docker image ($IMAGE_TAG)..."
docker build -t "$IMAGE_TAG" .

# ------------------------------------------------------------------------------
# 2. Start container with test environment variables
# ------------------------------------------------------------------------------
echo "[STEP 2/4] Starting container on port $TEST_PORT..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "$TEST_PORT:$TEST_PORT" \
  -e PORT="$TEST_PORT" \
  -e HOST="0.0.0.0" \
  -e NODE_ENV="production" \
  -e SIGNUP_MODE="open" \
  -e REQUIRE_EMAIL_VERIFICATION="false" \
  -e COOKIE_SECRET="ci-test-cookie-secret-at-least-32-chars!" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e DATABASE_URL_DIRECT="$DATABASE_URL_DIRECT" \
  "$IMAGE_TAG"

# ------------------------------------------------------------------------------
# 3. Wait for /health/ready
# ------------------------------------------------------------------------------
echo "[STEP 3/4] Waiting for container readiness at http://127.0.0.1:$TEST_PORT/health/ready..."
READY=0
for i in $(seq 1 45); do
  if curl -s -f "http://127.0.0.1:$TEST_PORT/health/ready" >/dev/null 2>&1; then
    READY=1
    echo "[OK] Container is ready (attempt $i)."
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo "[ERROR] Container failed to report ready within 45 seconds. Docker logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi

# ------------------------------------------------------------------------------
# 4. Run scripts/smoke.sh against container
# ------------------------------------------------------------------------------
echo "[STEP 4/4] Executing scripts/smoke.sh against container..."
SMOKE_MODE=staging ./scripts/smoke.sh "http://127.0.0.1:$TEST_PORT"

echo "=========================================================================="
echo "Docker verification passed successfully!"
echo "=========================================================================="
exit 0
