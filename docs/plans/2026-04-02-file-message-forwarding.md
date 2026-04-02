# File Message Forwarding to OpenClaw — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Forward file/image/voice/video messages from WeChat (via Hub) to OpenClaw AI, so the AI can see and respond to non-text messages.

**Architecture:** The Hub already sends complete `items[]` data (including `media.url`, `file_name`, `file_size`) in WebSocket events to apps. The plugin currently ignores `items` and only reads `content` (a plain string). We need to: (1) add `items` type definitions, (2) extract media info from items and build a richer body for the AI, (3) ensure the Hub proxy URL is accessible for file downloads. There are also two Hub-side improvements: (a) the relay items sent to apps contain the **raw WeChat CDN URL** instead of a Hub proxy URL because `convertRelayItem` runs before `processMedia` — we need to fix this timing or build the proxy URL at relay-item conversion time; (b) the `media.url` field in relay items should always be a URL that external apps can access.

**Tech Stack:** TypeScript, OpenClaw Plugin SDK, ws (WebSocket)

**Repos:**
- `openclaw-channel-openilink` (plugin) — `/tmp/openclaw-channel-openilink`
- `openilink-hub` (Hub) — `/Users/su/Workspace/src/github.com/openilink/openilink-hub`

---

## Part A: Hub-Side Fix — Ensure Apps Receive Accessible Media URLs

### Context

In `internal/bot/manager.go`, the message flow is:

1. `parseMessage(msg)` (line 305) — converts `msg.Items` to relay items via `convertRelayItem`
2. `go m.downloadMedia(inst, msg, msgID)` (line 341) — **async** goroutine that calls `processMedia`, which updates `msg.Items[i].Media.URL` to a storage URL or Hub proxy URL
3. `deliverToApps(inst, msg, parsed, ...)` (line 358) — sends `parsed.relayItems` to apps

Problem: Step 1 runs **before** step 2, so relay items contain the **original WeChat CDN URL** (from `ilink.CDNMedia.FullURL`), which is inaccessible to external apps. The relay items are a snapshot taken at parse time and never updated.

For **image** messages this hasn't been reported as broken — likely because OpenClaw doesn't currently process image URLs from items either (it only gets `content` text). But for file forwarding to work, the URL must be accessible.

### Solution

In `convertRelayItem`, when building relay items for app delivery, generate the Hub CDN proxy URL on the spot using the `EncryptQueryParam` and `AESKey` fields (which are always available at parse time). This doesn't require waiting for the async download. The Hub proxy endpoint `/api/v1/channels/media` will download-on-demand when the app fetches it.

However, `convertRelayItem` currently doesn't have access to `baseURL` or `botDBID`. We need to either:
- (Option A) Pass these as parameters to `convertRelayItem` and `parseMessage`
- (Option B) Build the proxy URL in `deliverToApps` when constructing the event data, post-processing `parsed.relayItems`

Option B is cleaner — it doesn't change the shared `parseMessage` function signature (which is also used by `deliverToAI`, `storeMessage`, etc.).

---

### Task 1: Add proxy URL builder for relay items in app_dispatch.go

**Files:**
- Modify: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/app_dispatch.go:22-62`

**Step 1: Write the failing test**

Create a test for a new helper function `resolveMediaURLs` that replaces raw CDN URLs with Hub proxy URLs in relay items.

File: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/app_dispatch_test.go`

```go
package bot

import (
	"testing"

	"github.com/openilink/openilink-hub/internal/relay"
)

func TestResolveMediaURLs(t *testing.T) {
	baseURL := "https://hub.example.com"
	botDBID := "bot-123"

	items := []relay.MessageItem{
		{Type: "text", Text: "hello"},
		{
			Type:     "file",
			FileName: "doc.pdf",
			Media: &relay.Media{
				URL:       "https://wechat-cdn.example.com/encrypted-file",
				AESKey:    "abc123",
				FileSize:  1024,
				MediaType: "file",
			},
		},
		{
			Type: "image",
			Media: &relay.Media{
				URL:       "https://wechat-cdn.example.com/encrypted-image",
				AESKey:    "def456",
				MediaType: "image",
			},
		},
	}

	result := resolveMediaURLs(items, baseURL, botDBID)

	// Text items should be unchanged
	if result[0].Media != nil {
		t.Error("text item should have no media")
	}

	// File item should have Hub proxy URL
	if result[1].Media.URL == "https://wechat-cdn.example.com/encrypted-file" {
		t.Error("file media URL should have been replaced with proxy URL")
	}
	if result[1].Media.URL == "" {
		t.Error("file media URL should not be empty")
	}
	// Should contain the bot ID and proxy path
	if result[1].Media.FileSize != 1024 {
		t.Error("file size should be preserved")
	}

	// Image item should also have Hub proxy URL
	if result[2].Media.URL == "https://wechat-cdn.example.com/encrypted-image" {
		t.Error("image media URL should have been replaced with proxy URL")
	}

	// Original items should NOT be mutated
	if items[1].Media.URL != "https://wechat-cdn.example.com/encrypted-file" {
		t.Error("original items should not be mutated")
	}
}

func TestResolveMediaURLs_NoMedia(t *testing.T) {
	items := []relay.MessageItem{
		{Type: "text", Text: "hello"},
	}
	result := resolveMediaURLs(items, "https://hub.example.com", "bot-123")
	if len(result) != 1 || result[0].Text != "hello" {
		t.Error("text-only items should pass through unchanged")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/su/Workspace/src/github.com/openilink/openilink-hub && go test ./internal/bot/ -run TestResolveMediaURLs -v`
Expected: FAIL — `resolveMediaURLs` not defined

**Step 3: Write minimal implementation**

Add to `app_dispatch.go` (before `deliverToApps`):

```go
// resolveMediaURLs returns a copy of items with media URLs replaced by
// Hub proxy URLs so that external apps can fetch the media. The original
// slice is not mutated.
func resolveMediaURLs(items []relay.MessageItem, baseURL, botDBID string) []relay.MessageItem {
	out := make([]relay.MessageItem, len(items))
	copy(out, items)
	for i := range out {
		if out[i].Media == nil || out[i].Media.AESKey == "" {
			continue
		}
		// Clone media to avoid mutating the original
		m := *out[i].Media
		m.URL = fmt.Sprintf("%s/api/v1/channels/media?bot=%s&aes=%s&ct=%s",
			baseURL, botDBID, m.AESKey, mediaProxyContentType(out[i].Type))
		out[i].Media = &m
	}
	return out
}

func mediaProxyContentType(itemType string) string {
	switch itemType {
	case "image":
		return "image/jpeg"
	case "voice":
		return "audio/wav"
	case "video":
		return "video/mp4"
	default:
		return "application/octet-stream"
	}
}
```

Wait — the Hub proxy endpoint uses `eqp` (EncryptQueryParam), not just `aes`. But `relay.Media` doesn't include `EncryptQueryParam` — it's stripped during `convertRelayItem`. Let me check...

Looking at `relay.MessageItem.Media` (`relay/protocol.go:42-51`):
```go
type Media struct {
	URL         string `json:"url,omitempty"`
	AESKey      string `json:"aes_key,omitempty"`
	FileSize    int64  `json:"file_size,omitempty"`
	MediaType   string `json:"media_type,omitempty"`
	...
}
```

And `convertRelayItem` (`manager.go:817-827`):
```go
ri.Media = &relay.Media{
	URL:         item.Media.URL,
	AESKey:      item.Media.AESKey,
	...
}
```

The `EncryptQueryParam` is NOT included in `relay.Media`. The Hub CDN proxy endpoint needs `eqp` to download from WeChat. So we have two options:

**(Option A)** Add `EncryptQueryParam` to `relay.Media` and copy it in `convertRelayItem` — then use it to build the proxy URL.

**(Option B)** Use a different approach: instead of building the proxy URL per-item in the app dispatch, pre-process media URLs before creating relay items (i.e., build proxy URLs in `parseMessage` before `convertRelayItem`).

**Option A is cleaner** — we add the field to relay.Media, populate it in convertRelayItem, then use it in `resolveMediaURLs`. The field won't be serialized to WebSocket clients if we use `json:"-"` or we can include it (it's not secret — the WS connection is already authenticated).

Actually, re-reading the Hub proxy endpoint:

```
/api/v1/channels/media?bot={bot_id}&eqp={eqp}&aes={aes}&ct={content_type}
```

It requires **both** `eqp` and `aes`. So we need `EncryptQueryParam` available when building the proxy URL.

**Revised approach:** Add `EQP` field to `relay.Media`, copy it in `convertRelayItem`, use it in `resolveMediaURLs`.

---

### Task 1 (revised): Add EQP to relay.Media and build proxy URLs

**Files:**
- Modify: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/relay/protocol.go:42-51`
- Modify: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/manager.go:811-837`
- Modify: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/app_dispatch.go`
- Create: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/app_dispatch_test.go`

**Step 1: Add EQP field to relay.Media**

In `relay/protocol.go`, add `EQP` to the `Media` struct:

```go
type Media struct {
	URL         string `json:"url,omitempty"`
	EQP         string `json:"eqp,omitempty"`       // EncryptQueryParam for Hub proxy
	AESKey      string `json:"aes_key,omitempty"`
	FileSize    int64  `json:"file_size,omitempty"`
	MediaType   string `json:"media_type,omitempty"`
	PlayTime    int    `json:"play_time,omitempty"`
	PlayLength  int    `json:"play_length,omitempty"`
	ThumbWidth  int    `json:"thumb_width,omitempty"`
	ThumbHeight int    `json:"thumb_height,omitempty"`
}
```

**Step 2: Copy EQP in convertRelayItem**

In `manager.go` `convertRelayItem`, add:

```go
ri.Media = &relay.Media{
	URL:         item.Media.URL,
	EQP:         item.Media.EncryptQueryParam,  // add this line
	AESKey:      item.Media.AESKey,
	FileSize:    item.Media.FileSize,
	...
}
```

**Step 3: Write the test for resolveMediaURLs**

Create `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/app_dispatch_test.go` with the test (updated to include EQP):

```go
package bot

import (
	"testing"

	"github.com/openilink/openilink-hub/internal/relay"
)

func TestResolveMediaURLs(t *testing.T) {
	baseURL := "https://hub.example.com"
	botDBID := "bot-123"

	items := []relay.MessageItem{
		{Type: "text", Text: "hello"},
		{
			Type:     "file",
			FileName: "doc.pdf",
			Media: &relay.Media{
				URL:       "https://wechat-cdn.example.com/encrypted-file",
				EQP:       "eqp-file-param",
				AESKey:    "abc123",
				FileSize:  1024,
				MediaType: "file",
			},
		},
		{
			Type: "image",
			Media: &relay.Media{
				URL:       "https://wechat-cdn.example.com/encrypted-image",
				EQP:       "eqp-image-param",
				AESKey:    "def456",
				MediaType: "image",
			},
		},
	}

	result := resolveMediaURLs(items, baseURL, botDBID)

	// Text items unchanged
	if result[0].Media != nil {
		t.Error("text item should have no media")
	}

	// File item: proxy URL with eqp + aes
	want := "https://hub.example.com/api/v1/channels/media?bot=bot-123&eqp=eqp-file-param&aes=abc123&ct=application%2Foctet-stream"
	if result[1].Media.URL != want {
		t.Errorf("file URL = %q, want %q", result[1].Media.URL, want)
	}
	if result[1].Media.FileSize != 1024 {
		t.Error("file size should be preserved")
	}

	// Image item: proxy URL
	wantImg := "https://hub.example.com/api/v1/channels/media?bot=bot-123&eqp=eqp-image-param&aes=def456&ct=image%2Fjpeg"
	if result[2].Media.URL != wantImg {
		t.Errorf("image URL = %q, want %q", result[2].Media.URL, wantImg)
	}

	// Original not mutated
	if items[1].Media.URL != "https://wechat-cdn.example.com/encrypted-file" {
		t.Error("original items should not be mutated")
	}
}

func TestResolveMediaURLs_NoMedia(t *testing.T) {
	items := []relay.MessageItem{
		{Type: "text", Text: "hello"},
	}
	result := resolveMediaURLs(items, "https://hub.example.com", "bot-123")
	if len(result) != 1 || result[0].Text != "hello" {
		t.Error("text-only items should pass through unchanged")
	}
}

func TestResolveMediaURLs_AlreadyStorageURL(t *testing.T) {
	items := []relay.MessageItem{
		{
			Type: "image",
			Media: &relay.Media{
				URL:       "https://storage.example.com/bot-123/2026/04/02/img.jpg",
				EQP:       "", // empty EQP means already processed by storage
				AESKey:    "",
				MediaType: "image",
			},
		},
	}
	result := resolveMediaURLs(items, "https://hub.example.com", "bot-123")
	// No EQP → URL should NOT be replaced
	if result[0].Media.URL != "https://storage.example.com/bot-123/2026/04/02/img.jpg" {
		t.Error("items without EQP should keep their original URL")
	}
}
```

**Step 4: Run test to verify it fails**

Run: `cd /Users/su/Workspace/src/github.com/openilink/openilink-hub && go test ./internal/bot/ -run TestResolveMediaURLs -v`
Expected: FAIL — `resolveMediaURLs` undefined

**Step 5: Write implementation**

Add to `app_dispatch.go`:

```go
import "net/url"

// resolveMediaURLs returns a copy of items with raw CDN URLs replaced by
// Hub proxy URLs so external apps can fetch media. Items without EQP
// (already processed or text-only) are left unchanged.
func resolveMediaURLs(items []relay.MessageItem, baseURL, botDBID string) []relay.MessageItem {
	out := make([]relay.MessageItem, len(items))
	copy(out, items)
	for i := range out {
		if out[i].Media == nil || out[i].Media.EQP == "" {
			continue
		}
		m := *out[i].Media
		m.URL = fmt.Sprintf("%s/api/v1/channels/media?bot=%s&eqp=%s&aes=%s&ct=%s",
			baseURL, botDBID, m.EQP, m.AESKey, url.QueryEscape(mediaProxyContentType(out[i].Type)))
		out[i].Media = &m
	}
	return out
}

func mediaProxyContentType(itemType string) string {
	switch itemType {
	case "image":
		return "image/jpeg"
	case "voice":
		return "audio/wav"
	case "video":
		return "video/mp4"
	default:
		return "application/octet-stream"
	}
}
```

**Step 6: Run test to verify it passes**

Run: `cd /Users/su/Workspace/src/github.com/openilink/openilink-hub && go test ./internal/bot/ -run TestResolveMediaURLs -v`
Expected: PASS

**Step 7: Commit**

```bash
git add internal/relay/protocol.go internal/bot/manager.go internal/bot/app_dispatch.go internal/bot/app_dispatch_test.go
git commit -m "feat: add EQP to relay.Media and build proxy URLs for app media delivery"
```

---

### Task 2: Use resolveMediaURLs in deliverToApps

**Files:**
- Modify: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/app_dispatch.go:22-62`
- Modify: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/manager.go` (Manager struct needs baseURL access)

**Step 1: Verify Manager has baseURL field**

Check that `Manager` struct has `baseURL`. It's used in `processMedia` (line 745), so it should already exist.

Run: `grep -n 'baseURL' /Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/bot/manager.go | head -5`

**Step 2: Update deliverToApps to resolve media URLs**

In `deliverToApps`, replace `p.relayItems` with resolved items. Change lines 55-62:

```go
// Resolve media URLs for external app access
resolvedItems := resolveMediaURLs(p.relayItems, m.baseURL, inst.DBID)

event := appdelivery.NewEvent(eventType, map[string]any{
	"message_id": msg.ExternalID,
	"sender":     map[string]any{"id": msg.Sender, "role": "user"},
	"group":      groupInfo(msg),
	"content":    content,
	"msg_type":   p.msgType,
	"items":      resolvedItems,
})
```

**Step 3: Run existing tests**

Run: `cd /Users/su/Workspace/src/github.com/openilink/openilink-hub && go test ./internal/bot/ -v`
Expected: PASS

**Step 4: Commit**

```bash
git add internal/bot/app_dispatch.go
git commit -m "feat: resolve media proxy URLs before delivering events to apps"
```

---

### Task 3: Verify Hub CDN proxy endpoint handles file type

**Files:**
- Read: `/Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/api/media_handler.go`

**Step 1: Verify the CDN proxy handles all content types**

The proxy endpoint at `GET /api/v1/channels/media` should work for files. Check that it doesn't filter by content type. Read `media_handler.go` lines 12-85 and verify `handleChannelMedia` calls `inst.Provider.DownloadMedia()` regardless of media type.

**Step 2: Verify auth for app tokens**

The endpoint must accept app tokens (Bearer auth) since OpenClaw will use its app token to fetch media. Check the auth middleware for this route.

Run: `grep -n 'channels/media' /Users/su/Workspace/src/github.com/openilink/openilink-hub/internal/api/router.go`

Check if the route is behind auth middleware that accepts app tokens.

**Step 3: If changes needed, implement and test. If not, document and move on.**

No commit needed if no changes required.

---

## Part B: Plugin-Side Fix — Handle Items in Inbound Events

### Task 4: Add items type definitions to types.ts

**Files:**
- Modify: `/tmp/openclaw-channel-openilink/src/types.ts`

**Step 1: Add MessageItem and Media types**

Add the following types to `types.ts`, and add `items` to the event data interface:

```typescript
export interface HubMedia {
  url?: string;
  eqp?: string;
  aes_key?: string;
  file_size?: number;
  media_type?: string;
  play_time?: number;
  play_length?: number;
  thumb_width?: number;
  thumb_height?: number;
}

export interface HubMessageItem {
  type: "text" | "image" | "voice" | "file" | "video";
  text?: string;
  file_name?: string;
  media?: HubMedia;
  ref_msg?: {
    title?: string;
    item: HubMessageItem;
  };
}
```

Update `HubWSEvent.event.data` to include `items`:

```typescript
data: {
  content?: string;
  sender?: { id: string; name: string };
  group?: { id: string; name: string } | null;
  msg_type?: string;
  message_id?: string;
  items?: HubMessageItem[];
  [key: string]: unknown;
};
```

**Step 2: Verify types compile**

Run: `cd /tmp/openclaw-channel-openilink && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add HubMessageItem and HubMedia type definitions"
```

---

### Task 5: Extract media info from items in inbound.ts

**Files:**
- Modify: `/tmp/openclaw-channel-openilink/src/inbound.ts`

**Step 1: Add helper to build body from items**

The key change: when `msg_type` is `file`, `image`, `voice`, or `video`, extract the media info from `items` and build a richer body string that includes the file URL and metadata. This body is what gets sent to the AI.

Add a helper function:

```typescript
import type { HubWSEvent, HubMessageItem, OpeniLinkConfig } from "./types.js";

/**
 * Build a human-readable body from event data, incorporating media items.
 * For text messages, returns content as-is.
 * For media messages, appends file/media info so the AI can see what was sent.
 */
function buildBodyFromItems(
  content: string,
  msgType: string | undefined,
  items: HubMessageItem[] | undefined,
): string {
  if (!items || items.length === 0) return content;

  const parts: string[] = [];

  for (const item of items) {
    switch (item.type) {
      case "text":
        if (item.text) parts.push(item.text);
        break;
      case "file": {
        const name = item.file_name || "file";
        const size = item.media?.file_size
          ? ` (${formatFileSize(item.media.file_size)})`
          : "";
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[File: ${name}${size}]${url}`);
        break;
      }
      case "image": {
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[Image]${url}`);
        break;
      }
      case "voice": {
        const duration = item.media?.play_time
          ? ` ${item.media.play_time}s`
          : "";
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[Voice${duration}]${url}`);
        break;
      }
      case "video": {
        const duration = item.media?.play_length
          ? ` ${item.media.play_length}s`
          : "";
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[Video${duration}]${url}`);
        break;
      }
    }
  }

  return parts.join("\n") || content;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

**Step 2: Use buildBodyFromItems in handleInboundEvent**

Replace line 17:
```typescript
const content = eventData.content || "";
```

With:
```typescript
const items = eventData.items as HubMessageItem[] | undefined;
const rawContent = eventData.content || "";
const content = buildBodyFromItems(rawContent, eventData.msg_type, items);
```

**Step 3: Verify it compiles**

Run: `cd /tmp/openclaw-channel-openilink && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/inbound.ts
git commit -m "feat: extract media info from items for file/image/voice/video messages"
```

---

### Task 6: Bump version and finalize

**Files:**
- Modify: `/tmp/openclaw-channel-openilink/package.json`

**Step 1: Bump patch version**

In `package.json`, change `"version": "0.1.5"` to `"version": "0.1.6"`.

**Step 2: Build**

Run: `cd /tmp/openclaw-channel-openilink && npm run build`
Expected: no errors

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.1.6"
```

---

## Summary of Changes

### Hub (openilink-hub)
| File | Change |
|------|--------|
| `internal/relay/protocol.go` | Add `EQP` field to `Media` struct |
| `internal/bot/manager.go` | Copy `EncryptQueryParam` → `EQP` in `convertRelayItem` |
| `internal/bot/app_dispatch.go` | Add `resolveMediaURLs` helper; use it in `deliverToApps` |
| `internal/bot/app_dispatch_test.go` | Tests for `resolveMediaURLs` |

### Plugin (openclaw-channel-openilink)
| File | Change |
|------|--------|
| `src/types.ts` | Add `HubMessageItem`, `HubMedia` types; add `items` to event data |
| `src/inbound.ts` | Add `buildBodyFromItems` helper; use items to build richer body |
| `package.json` | Bump version 0.1.5 → 0.1.6 |
