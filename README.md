# openclaw-channel-openilink

[OpenClaw](https://github.com/openclaw/openclaw) 的 Channel 插件，通过 [OpeniLink Hub](https://github.com/openilink/openilink-hub) 接入微信 Bot。

安装后，OpenClaw AI 可以通过 Hub 管理的微信 Bot 收发消息。

## 工作原理

```
OpenClaw AI 助手
    ↕ （插件 SDK）
[openclaw-channel-openilink]
    ↕ （WebSocket + HTTP）
OpeniLink Hub Bot API
    ↕ （iLink 协议）
微信 ClawBot
```

- **收消息**：微信用户发消息 → Hub 通过 WebSocket 推送给插件 → 插件转发给 OpenClaw AI 处理
- **发消息**：OpenClaw AI 生成回复 → 插件调 Hub Bot API 发送 → Hub 通过 Bot 发到微信

## 安装

```bash
# 配置 GitHub Packages
echo "@openilink:registry=https://npm.pkg.github.com" >> ~/.npmrc

# 安装插件
openclaw plugins install @openilink/openclaw-channel-openilink
```

## 配置

### 前置步骤

1. 部署或访问一个 [OpeniLink Hub](https://github.com/openilink/openilink-hub) 实例
2. 在 Hub 上安装 **OpenClaw** App 到你的 Bot（应用市场 → OpenClaw → 安装）
3. 在安装详情页复制 **Token**

### 单账户

编辑 OpenClaw 配置文件（`openclaw.yaml`）：

```yaml
channels:
  openilink:
    hub_url: "https://hub.openilink.com"
    app_token: "app_你的token"
```

### 多账户

连接多个 Hub Bot（不同 Bot 或不同 Hub 实例）：

```yaml
channels:
  openilink:
    accounts:
      sales-bot:
        hub_url: "https://hub.openilink.com"
        app_token: "app_销售bot的token"
      support-bot:
        hub_url: "https://hub.openilink.com"
        app_token: "app_客服bot的token"
```

每个账户维护独立的 WebSocket 连接，互不干扰。

### 重启 OpenClaw

```bash
openclaw restart
```

配置完成后，微信消息会自动转发到 OpenClaw AI 处理。

## 配置参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `hub_url` | string | 是 | OpeniLink Hub 地址（如 `https://hub.openilink.com`） |
| `app_token` | string | 是 | 从 Hub 安装 OpenClaw App 后获取的 Token |

## 功能

- **实时消息** — 通过 WebSocket 持久连接接收 Hub 消息
- **自动重连** — 断线后 5 秒自动重连
- **私聊/群聊** — 支持直接对话和群组消息
- **媒体消息** — 支持通过 Hub Bot API 发送图片
- **多账户** — 同时连接多个 Bot
- **链路追踪** — Trace ID 端到端传递，方便调试

## 开发

```bash
git clone https://github.com/openilink/openclaw-channel-openilink.git
cd openclaw-channel-openilink
npm install
npm run build

# 本地开发链接
openclaw plugins install --link .
```

## 相关链接

- [OpeniLink Hub](https://github.com/openilink/openilink-hub) — 微信 Bot 消息管理平台
- [OpenClaw](https://github.com/openclaw/openclaw) — 开源 AI 助手
- [OpenClaw 插件文档](https://docs.openclaw.ai/tools/plugin) — 插件开发指南

## License

MIT

---

## English

OpenClaw channel plugin for [OpeniLink Hub](https://github.com/openilink/openilink-hub) — bridge OpenClaw AI to WeChat bots.

### Quick Start

```bash
# Configure GitHub Packages registry
echo "@openilink:registry=https://npm.pkg.github.com" >> ~/.npmrc

# Install
openclaw plugins install @openilink/openclaw-channel-openilink
```

Configure `openclaw.yaml`:

```yaml
channels:
  openilink:
    hub_url: "https://hub.openilink.com"
    app_token: "your_app_token"
```

Then `openclaw restart`.

### How to Get Your Token

1. Log into your OpeniLink Hub
2. Go to your Bot → App Marketplace → Install **OpenClaw** app
3. Copy the **Token** from the installation detail page
4. Paste into your OpenClaw config

### Features

- Real-time messaging via WebSocket
- Auto-reconnect (5s backoff)
- Direct and group chat support
- Media messages (images)
- Multi-account support
- Trace ID propagation
