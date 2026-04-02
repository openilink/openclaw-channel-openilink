#!/bin/bash
set -e

echo "=== Installing OpenClaw ==="
npm install -g openclaw

echo "=== Installing plugin from local source ==="
rm -rf /root/.openclaw/extensions/openclaw-channel-openilink
mkdir -p /root/.openclaw/extensions/openclaw-channel-openilink
cp -r /tmp/plugin-src/dist /root/.openclaw/extensions/openclaw-channel-openilink/
cp /tmp/plugin-src/package.json /root/.openclaw/extensions/openclaw-channel-openilink/
cp /tmp/plugin-src/openclaw.plugin.json /root/.openclaw/extensions/openclaw-channel-openilink/
cd /root/.openclaw/extensions/openclaw-channel-openilink && npm install --omit=dev 2>&1
cd /

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

    # Verify that the file reply contains full file metadata (not just filename)
    # buildBodyFromItems should produce "[File: test-report.pdf (200.0KB)]" with URL
    VERIFY_RESULT=$(node -e "
      fetch('http://mock-hub:9200/replies')
        .then(r => r.json())
        .then(replies => {
          console.error('All replies:');
          for (const r of replies) console.error(JSON.stringify(r.content).slice(0, 300));

          const fileReply = replies.find(r => r.content && r.content.includes('test-report.pdf'));
          if (!fileReply) { console.log('NO_FILE_REPLY'); return; }

          // Check for structured file format from buildBodyFromItems
          const c = fileReply.content;
          const hasFormat = c.includes('[File:') || c.includes('200.0KB') || c.includes('fake-media');
          if (hasFormat) {
            console.log('FULL_FILE_INFO');
          } else {
            console.log('FILENAME_ONLY');
          }
        })
        .catch(e => { console.error(e); console.log('ERROR'); });
    " 2>&1) || VERIFY_RESULT="ERROR"

    echo "Verify result: $VERIFY_RESULT"

    case "$VERIFY_RESULT" in
      *FULL_FILE_INFO*)
        echo "=== SUCCESS: file message forwarded with full metadata (name, size, URL) ==="
        kill $OC_PID 2>/dev/null || true
        exit 0
        ;;
      *FILENAME_ONLY*)
        echo "=== FAIL: file message forwarded but only filename, missing [File:] format/size/URL ==="
        kill $OC_PID 2>/dev/null || true
        exit 1
        ;;
      *NO_FILE_REPLY*)
        echo "=== FAIL: no reply contains test-report.pdf ==="
        kill $OC_PID 2>/dev/null || true
        exit 1
        ;;
      *)
        echo "=== FAIL: verification error ==="
        kill $OC_PID 2>/dev/null || true
        exit 1
        ;;
    esac
  fi
done

echo "=== FAIL: expected $EXPECTED_REPLIES replies but only got $REPLY_COUNT within timeout ==="
node -e "fetch('http://mock-hub:9200/replies').then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))" 2>/dev/null || true
kill $OC_PID 2>/dev/null || true
exit 1
