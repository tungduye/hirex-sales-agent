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
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        attachments?: Array<{
          type?: string;
          payload?: { url?: string };
        }>;
      };
    }>;
  }>;
}
