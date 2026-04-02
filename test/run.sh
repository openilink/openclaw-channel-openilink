#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

cleanup() {
  echo "Cleaning up..."
  docker compose down -v
}
trap cleanup EXIT

echo "Building plugin..."
cd "$(dirname "$0")/.." && npm run build && cd test

echo "Starting integration test..."
docker compose up --build --abort-on-container-exit --exit-code-from openclaw
