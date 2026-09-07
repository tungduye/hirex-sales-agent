export interface ReplyEvidence {
  workspaceId: string; emailAccountId: string; providerThreadId: string;
  direction: string; fromEmail: string | null; receivedAt: string | null; autoSubmitted?: string | null;
}
export interface SentEvidence {
  workspaceId: string; emailAccountId: string; providerThreadId: string;
  recipientEmail: string; sentAt: string;
}

const normalize = (value: string | null) => value?.trim().toLowerCase() ?? null;
export function isStrongCampaignReply(message: ReplyEvidence, sent: SentEvidence): boolean {
  const received = Date.parse(message.receivedAt ?? "");
  const sentAt = Date.parse(sent.sentAt);
  return message.workspaceId === sent.workspaceId && message.emailAccountId === sent.emailAccountId
    && message.providerThreadId === sent.providerThreadId && message.direction === "INBOUND"
    && normalize(message.fromEmail) === normalize(sent.recipientEmail)
    && (!message.autoSubmitted || message.autoSubmitted.trim().toLowerCase()==="no")
    && Number.isFinite(received) && Number.isFinite(sentAt) && received > sentAt;
}

export interface BounceEvidence {
  contentType: string | null; status: string | null; action: string | null;
  finalRecipient: string | null; failedRecipients: string[]; diagnosticCode: string | null;
}
export function classifyHardBounce(evidence: BounceEvidence, expectedRecipient: string): boolean {
  const recipient = normalize(expectedRecipient);
  const candidates = [evidence.finalRecipient, ...evidence.failedRecipients].map(normalize).filter(Boolean);
  if (!recipient || !candidates.includes(recipient)) return false;
  const permanentStatus = /^5\.\d{1,3}\.\d{1,3}$/.test(evidence.status?.trim() ?? "");
  const failedAction = evidence.action?.trim().toLowerCase() === "failed";
  const deliveryStatus = evidence.contentType?.toLowerCase().includes("message/delivery-status") === true;
  const permanentDiagnostic = /\b550\b|user unknown|mailbox unavailable/i.test(evidence.diagnosticCode ?? "");
  return (permanentStatus && failedAction && deliveryStatus) || (failedAction && permanentDiagnostic && deliveryStatus);
}

export function parseDeliveryStatusText(raw:unknown){const fields=new Map<string,string>();if(typeof raw!=="string"||raw.length>100000)return{finalRecipient:null,originalRecipient:null,action:null,status:null,diagnosticCode:null};for(const line of raw.split(/\r?\n/)){const match=line.match(/^([A-Za-z-]+):\s*(.*)$/);if(match&&!fields.has(match[1].toLowerCase()))fields.set(match[1].toLowerCase(),match[2].trim());}const recipient=(name:string)=>{const value=fields.get(name)?.replace(/^[^;]+;\s*/,"").trim().toLowerCase();return value&&/^[^\s@<>]+@[^\s@<>]+$/.test(value)?value:null;};const clean=(value:string|undefined)=>value?.trim()||null;return{finalRecipient:recipient("final-recipient"),originalRecipient:recipient("original-recipient"),action:clean(fields.get("action"))?.toLowerCase()??null,status:clean(fields.get("status")),diagnosticCode:clean(fields.get("diagnostic-code"))};}
