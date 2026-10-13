export interface FacebookPageCredential {
  pageId: string;
  pageAccessToken: string;
  appSecret: string;
  graphApiVersion: string;
}

export interface FacebookWebhookEnvelope {
  object: "page";
  entry: Array<{
    id: string;
    time: number;
    messaging?: Array<{
      sender?: { id?: string; name?: string };
      recipient?: { id?: string; name?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        is_echo?: boolean;
        text?: string;
        attachments?: Array<{
          type?: string;
          payload?: { url?: string };
        }>;
      };
    }>;
  }>;
}
