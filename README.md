# openclaw-channel-openilink

OpenClaw channel plugin that bridges OpenClaw AI to WeChat (and other messaging platforms) via [OpeniLink Hub](https://github.com/openilink/openilink-hub).

## How It Works

```
OpenClaw Gateway
    | (plugin SDK)
[openclaw-channel-openilink]
    | (WebSocket + HTTP)
OpeniLink Hub Bot API
    |
WeChat / other channels (via iLink)
```

1. **Inbound**: When a user sends a message on WeChat, Hub receives it and forwards it to this plugin over a WebSocket connection. The plugin dispatches the message to OpenClaw AI for processing.
2. **Outbound**: When OpenClaw AI generates a response, the plugin sends it back to Hub via `POST /bot/v1/message/send`, which delivers it to the user on WeChat.

## Installation

```bash
openclaw plugins install openclaw-channel-openilink
```

## Configuration

### Prerequisites

1. Deploy or access an [OpeniLink Hub](https://github.com/openilink/openilink-hub) instance.
2. Create an App on Hub and install it to a bot.
3. Copy the **Hub URL** and the **App Token** from the installation page.

### Single Account

In your OpenClaw configuration file (`openclaw.yaml`):

```yaml
channels:
  openilink:
    hub_url: "https://hub.openilink.com"
    app_token: "your_app_installation_token"
```

### Multi-Account

To connect multiple Hub app installations (e.g., different bots or different Hub instances):

```yaml
channels:
  openilink:
    accounts:
      bot-sales:
        hub_url: "https://hub.openilink.com"
        app_token: "token_for_sales_bot"
      bot-support:
        hub_url: "https://hub.openilink.com"
        app_token: "token_for_support_bot"
```

Each account maintains its own WebSocket connection to Hub and operates independently.

## Configuration Reference

| Field       | Type   | Required | Description                                          |
|-------------|--------|----------|------------------------------------------------------|
| `hub_url`   | string | Yes      | OpeniLink Hub base URL (e.g., `https://hub.openilink.com`) |
| `app_token` | string | Yes      | App installation token obtained from Hub             |

## Features

- **Real-time messaging** via persistent WebSocket connection to Hub
- **Auto-reconnect** with 5-second backoff on connection loss
- **Direct and group chat** support
- **Media messages** (images) via Hub Bot API
- **Multi-account** support for connecting multiple bots
- **Trace ID propagation** for end-to-end message tracing

## How to Get Your App Token

1. Log into your OpeniLink Hub instance.
2. Navigate to **Apps** and create a new app (or use an existing one).
3. Go to the app's **Installations** tab.
4. Install the app to the desired bot.
5. After installation, copy the displayed **App Token**.
6. Paste it into your OpenClaw configuration as shown above.

## Development

```bash
git clone https://github.com/openilink/openclaw-channel-openilink.git
cd openclaw-channel-openilink
npm install
npm run build
```

## License

MIT
