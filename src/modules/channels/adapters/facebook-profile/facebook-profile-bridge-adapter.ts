import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import type {CanonicalInboundMessage,ChannelAdapter,ChannelSendResult,SendMessageCommand,VerifiedWebhook} from "../../core/channel-contracts";
import {ChannelError} from "../../core/channel-errors";
import type {ChannelTransport} from "../../core/channel-transport";
import type {ProviderHealthStatus} from "../../core/provider-health";
import {requireTrustedFacebookProfileBridgeOrigin} from "./trusted-bridge-origin";

const MAX_CLOCK_SKEW_SECONDS=300;
const SEND_PATH="/v1/messages/send";
type BridgeEvent={eventId:string;accountId:string;threadId:string;messageId:string;senderId:string;senderName?:string|null;accountName?:string|null;recipientIds:string[];text:string|null;isSelf:boolean;occurredAt:string;attachments:Array<{id:string|null;filename:string|null;contentType:string|null;sizeBytes:number|null;url:string|null}>};

function safe(value:unknown,max=512):value is string{return typeof value==="string"&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)}
function equal(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)}
function parse(value:unknown):BridgeEvent{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ChannelError("INVALID_WEBHOOK",false);
  const event=value as Partial<BridgeEvent>;
  if(!safe(event.eventId)||!safe(event.accountId)||!safe(event.threadId)||!safe(event.messageId)||!safe(event.senderId)||!Array.isArray(event.recipientIds)||!event.recipientIds.every(id=>safe(id))||(event.text!==null&&typeof event.text!=="string")||typeof event.isSelf!=="boolean"||!Array.isArray(event.attachments)||event.attachments.length>20||typeof event.occurredAt!=="string"||!Number.isFinite(Date.parse(event.occurredAt)))throw new ChannelError("INVALID_WEBHOOK",false);
  return event as BridgeEvent;
}

export class FacebookProfileBridgeAdapter implements ChannelAdapter{
  readonly channelType="FACEBOOK_PROFILE" as const;
  readonly capabilities=new Set(["SEND_TEXT","REPLY"] as const);
  constructor(private readonly workspaceId:string,private readonly channelAccountId:string,private readonly credential:{bridgeBaseUrl:string;bridgeAccountId:string;signingSecret:string},private readonly transport:ChannelTransport,private readonly now:()=>number=Date.now){this.credential={...credential,bridgeBaseUrl:requireTrustedFacebookProfileBridgeOrigin(credential.bridgeBaseUrl)}}
  async verifyWebhook(input:{headers:Readonly<Record<string,string>>;body:string}):Promise<VerifiedWebhook>{
    const timestamp=input.headers["x-hirex-timestamp"],signature=input.headers["x-hirex-signature"],seconds=Number(timestamp);
    if(!Number.isSafeInteger(seconds)||Math.abs(Math.floor(this.now()/1000)-seconds)>MAX_CLOCK_SKEW_SECONDS||!signature)throw new ChannelError("INVALID_WEBHOOK",false);
    const expected=createHmac("sha256",this.credential.signingSecret).update(`${timestamp}.${input.body}`).digest("hex");
    if(!equal(signature,expected))throw new ChannelError("INVALID_WEBHOOK",false);
    let payload:unknown;try{payload=JSON.parse(input.body)}catch{throw new ChannelError("INVALID_WEBHOOK",false)}
    const event=parse(payload);if(event.accountId!==this.credential.bridgeAccountId)throw new ChannelError("INVALID_WEBHOOK",false);
    return{channelAccountId:this.channelAccountId,providerEventId:event.eventId,receivedAt:new Date(this.now()).toISOString(),payload:event};
  }
  async normalizeInbound(input:VerifiedWebhook):Promise<CanonicalInboundMessage[]>{
    const event=parse(input.payload);if(event.text===null&&event.attachments.length===0)return[];
    return[{workspaceId:this.workspaceId,channelAccountId:this.channelAccountId,channelType:"FACEBOOK_PROFILE",accountDisplayName:event.accountName?.trim()||null,providerConversationId:event.threadId,providerMessageId:event.messageId,providerEventId:event.eventId,direction:event.isSelf?"OUTBOUND":"INBOUND",sender:{contactId:null,channelType:"FACEBOOK_PROFILE",externalId:event.senderId,displayName:event.senderName?.trim()||null},recipients:event.recipientIds.map(externalId=>({contactId:null,channelType:"FACEBOOK_PROFILE" as const,externalId,displayName:null})),text:event.text,attachments:event.attachments.map(item=>({externalId:item.id,filename:item.filename,contentType:item.contentType,sizeBytes:item.sizeBytes,providerUrl:item.url})),occurredAt:event.occurredAt,rawPayloadReference:null}];
  }
  async sendMessage(command:SendMessageCommand):Promise<ChannelSendResult>{
    const allowedSource=command.source==="HUMAN_MANUAL"||command.source==="CAMPAIGN"||(command.source==="AI_AUTOMATION"&&/^ai-recruiter:[0-9a-f-]{36}:part:\d+$/iu.test(command.idempotencyKey));
    if(command.workspaceId!==this.workspaceId||command.channelAccountId!==this.channelAccountId||command.channelType!=="FACEBOOK_PROFILE"||!allowedSource)throw new ChannelError("PERMISSION_DENIED",false);
    const body=JSON.stringify({workspaceId:command.workspaceId,connectedAccountId:command.channelAccountId,conversationId:command.conversationId,actionId:command.actionId,accountId:this.credential.bridgeAccountId,recipientId:command.recipientExternalId,threadId:command.providerConversationId,text:command.text,attachments:command.attachments,idempotencyKey:command.idempotencyKey,source:command.source});
    const timestamp=Math.floor(this.now()/1000).toString(),signature=createHmac("sha256",this.credential.signingSecret).update(`POST\n${SEND_PATH}\n${timestamp}\n${command.idempotencyKey}\n${body}`).digest("hex");
    const response=await this.transport.request({method:"POST",url:`${this.credential.bridgeBaseUrl}${SEND_PATH}`,headers:{"content-type":"application/json","x-hirex-timestamp":timestamp,"x-hirex-signature":signature,"x-hirex-idempotency-key":command.idempotencyKey},body,timeoutMs:20000});
    const result=response.body as {status?:unknown;messageId?:unknown;threadId?:unknown};
    if(response.status===401||response.status===403)throw new ChannelError("PERMISSION_DENIED",false);if(response.status===429)throw new ChannelError("RATE_LIMITED",true);if(response.status<200||response.status>=300)throw new ChannelError(response.status>=500?"DELIVERY_UNKNOWN":"DELIVERY_REJECTED",response.status>=500);
    if(result?.status!=="SENT"||!safe(result.messageId)||!safe(result.threadId))throw new ChannelError("DELIVERY_UNKNOWN",false);
    return{providerMessageId:result.messageId,providerConversationId:result.threadId,acceptedAt:new Date(this.now()).toISOString()};
  }
  async healthCheck():Promise<ProviderHealthStatus>{
    try{const path=`/v1/accounts/${encodeURIComponent(this.credential.bridgeAccountId)}/health`,timestamp=Math.floor(this.now()/1000).toString(),signature=createHmac("sha256",this.credential.signingSecret).update(`GET\n${path}\n${timestamp}\n\n`).digest("hex"),response=await this.transport.request({method:"GET",url:`${this.credential.bridgeBaseUrl}${path}`,headers:{"x-hirex-timestamp":timestamp,"x-hirex-signature":signature},timeoutMs:10000});if(response.status===401||response.status===403)return"AUTH_REQUIRED";if(response.status<200||response.status>=300||!response.body||typeof response.body!=="object")return"UNKNOWN";const status=(response.body as {status?:unknown}).status;return["HEALTHY","DEGRADED","DISCONNECTED","AUTH_REQUIRED","UNKNOWN"].includes(String(status))?status as ProviderHealthStatus:"UNKNOWN"}catch{return"UNKNOWN"}
  }
}
