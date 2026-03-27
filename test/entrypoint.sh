#!/bin/sh
set -e

echo "=== Installing OpenClaw ==="
npm install -g openclaw

echo "=== Installing plugin (no config yet) ==="
rm -rf /root/.openclaw/extensions/openclaw-channel-openilink
openclaw plugins install openclaw-channel-openilink

echo "=== Writing config after plugin is installed ==="
mkdir -p /root/.openclaw
cp /tmp/openclaw.config.json /root/.openclaw/openclaw.json

echo "=== Starting OpenClaw gateway (background, 30s timeout) ==="
timeout 30 openclaw gateway --verbose 2>&1 &
OC_PID=$!

echo "=== Waiting for reply to arrive at mock-hub ==="
for i in $(seq 1 30); do
  sleep 1
  if node -e "fetch('http://mock-hub:9200/replies').then(r=>r.json()).then(d=>{console.log('poll $i: '+d.length+' replies');process.exit(d.length>0?0:1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "=== SUCCESS: received reply at mock-hub ==="
    kill $OC_PID 2>/dev/null || true
    exit 0
  fi
done

echo "=== FAIL: no reply received within timeout ==="
kill $OC_PID 2>/dev/null || true
exit 1
