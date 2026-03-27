#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "🧪 Starting integration test..."
docker compose up --build --abort-on-container-exit --exit-code-from openclaw

echo "🧹 Cleaning up..."
docker compose down -v
