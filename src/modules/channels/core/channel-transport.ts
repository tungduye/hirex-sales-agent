export interface ChannelHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs: number;
}

export interface ChannelHttpResponse {
  status: number;
  body: unknown;
}

export interface ChannelTransport {
  request(input: ChannelHttpRequest): Promise<ChannelHttpResponse>;
}

export class FetchChannelTransport implements ChannelTransport {
  async request(input: ChannelHttpRequest): Promise<ChannelHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: { ...input.headers },
        body: input.body,
        signal: controller.signal,
        cache: "no-store",
      });
      const raw = await response.text();
      let body: unknown = null;
      if (raw.length > 0 && raw.length <= 1_000_000) {
        try { body = JSON.parse(raw); } catch { body = null; }
      }
      return { status: response.status, body };
    } finally {
      clearTimeout(timeout);
    }
  }
}
