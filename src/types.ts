export interface OpeniLinkConfig {
  hubUrl: string;
  appToken: string;
}

// Hub WS message types
export interface HubWSInit {
  type: "init";
  data: {
    installation_id: string;
    bot_id: string;
    app_name: string;
    app_slug: string;
  };
}

export interface HubWSEvent {
  type: "event";
  v: number;
  trace_id: string;
  installation_id: string;
  bot: { id: string };
  event: {
    type: string;
    id: string;
    timestamp: number;
    data: {
      content?: string;
      sender?: { id: string; name: string };
      group?: { id: string; name: string } | null;
      msg_type?: string;
      message_id?: string;
      [key: string]: unknown;
    };
  };
}

export interface HubWSAck {
  type: "ack";
  req_id: string;
  ok: boolean;
}

export interface HubWSError {
  type: "error";
  req_id?: string;
  error: string;
}

export type HubWSMessage = HubWSInit | HubWSEvent | HubWSAck | HubWSError | { type: "pong" };
