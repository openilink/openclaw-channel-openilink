#!/bin/bash
set -e

echo "=== Installing OpenClaw ==="
npm install -g openclaw

echo "=== Installing plugin (no config yet) ==="
rm -rf /root/.openclaw/extensions/openclaw-channel-openilink
openclaw plugins install openclaw-channel-openilink

echo "=== Writing config after plugin is installed ==="
mkdir -p /root/.openclaw
cp /tmp/openclaw.config.json /root/.openclaw/openclaw.json

echo "=== Starting OpenClaw gateway (background, 45s timeout) ==="
timeout 45 openclaw gateway --verbose 2>&1 &
OC_PID=$!

echo "=== Waiting for replies to arrive at mock-hub ==="
# We expect 2 replies: one for the text message, one for the file message.
EXPECTED_REPLIES=2
for i in $(seq 1 40); do
  sleep 1
  # Check if gateway is still alive
  if ! kill -0 $OC_PID 2>/dev/null; then
    echo "=== FAIL: gateway process died ==="
    exit 1
  fi
  REPLY_COUNT=$(node -e "fetch('http://mock-hub:9200/replies').then(r=>r.json()).then(d=>{console.log(d.length)}).catch(()=>console.log(0))" 2>/dev/null || echo 0)
  echo "poll $i: $REPLY_COUNT replies"
  if [ "$REPLY_COUNT" -ge "$EXPECTED_REPLIES" ]; then
    echo "=== Received $REPLY_COUNT replies, verifying content ==="

    # Verify that one of the replies contains the file name (test-report.pdf)
    HAS_FILE=$(node -e "
      fetch('http://mock-hub:9200/replies')
        .then(r => r.json())
        .then(replies => {
          const hasFile = replies.some(r => r.content && r.content.includes('test-report.pdf'));
          console.log(hasFile ? 'yes' : 'no');
        })
        .catch(() => console.log('no'));
    " 2>/dev/null || echo "no")

    if [ "$HAS_FILE" = "yes" ]; then
      echo "=== SUCCESS: received $REPLY_COUNT replies, file message forwarded correctly ==="
      kill $OC_PID 2>/dev/null || true
      exit 0
    else
      echo "=== FAIL: replies received but file info (test-report.pdf) not found in any reply ==="
      node -e "fetch('http://mock-hub:9200/replies').then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))" 2>/dev/null || true
      kill $OC_PID 2>/dev/null || true
      exit 1
    fi
  fi
done

echo "=== FAIL: expected $EXPECTED_REPLIES replies but only got $REPLY_COUNT within timeout ==="
node -e "fetch('http://mock-hub:9200/replies').then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))" 2>/dev/null || true
kill $OC_PID 2>/dev/null || true
exit 1
