"use client";

import { ChevronDown, SendHorizontal, Sparkles } from "lucide-react";
import { useActionState,useEffect,useRef,useState } from "react";
import type { ChannelType } from "../core/channel-contracts";
import { approveChannelMessage,dispatchPendingManualChannelMessage,proposeChannelMessage,sendManualChannelMessage } from "../server/channel-actions";
import { generateOmnichannelDraft,type OmnichannelAiState } from "../server/omnichannel-ai-actions";
import type { ChannelActionState } from "../types/channel-action-state";
import type { QuickReplyTemplate } from "../types/quick-reply";
import { isFacebookResponseWindowOpen } from "../core/facebook-response-window";
import { INBOX_OPTIMISTIC_EVENT } from "@/modules/inbox/components/inbox-live-events";

const initial:ChannelActionState={status:"idle",message:null};
const initialAi:OmnichannelAiState={status:"idle",message:null,draftText:null};
function createRequestId(){
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function ConversationComposer({conversationId,channelType,conversationStatus,lastInboundAt,proposedActions,pendingActions,quickReplies}:{conversationId:string;channelType:ChannelType;conversationStatus:string;lastInboundAt:string|null;proposedActions:Array<{id:string;text:string|null;proposedBy:string}>;pendingActions:Array<{id:string;text:string|null}>;quickReplies:QuickReplyTemplate[]}){
  const[state,send,pending]=useActionState(sendManualChannelMessage,initial),[text,setText]=useState("");
  const formRef=useRef<HTMLFormElement>(null);
  const[idempotencyKey,setIdempotencyKey]=useState(createRequestId);
  const submittedTextRef=useRef<string|null>(null);
  useEffect(()=>{
    if(!submittedTextRef.current||state.status==="idle")return;
    if(state.status==="error")window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:idempotencyKey,conversationId,text:submittedTextRef.current,timestamp:new Date().toISOString(),status:"FAILED"}}));
    if(state.status!=="success")return;
    const reset=window.setTimeout(()=>{submittedTextRef.current=null;setText("");setIdempotencyKey(createRequestId())},0);
    return()=>window.clearTimeout(reset);
  },[state,idempotencyKey,conversationId]);
  function ensureRequestId(){if(!idempotencyKey)setIdempotencyKey(createRequestId());}
  function updateText(value:string){setText(value);if(!idempotencyKey||state.status!=="idle")setIdempotencyKey(createRequestId());}
  const eligible=quickReplies.filter(reply=>reply.channelTypes.length===0||reply.channelTypes.includes(channelType));
  const responseWindowOpen=channelType!=="FACEBOOK"||isFacebookResponseWindowOpen({status:conversationStatus,latestInboundAt:lastInboundAt},new Date());
  return <div>
    {eligible.length>0?<div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">{eligible.map(reply=><button key={reply.id} type="button" onClick={()=>updateText(reply.textContent)} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-300 hover:text-blue-700" title={reply.shortcut}>{reply.name}</button>)}</div>:null}
    <form action={send} onSubmit={()=>{const value=text.trim();if(!value)return;submittedTextRef.current=value;window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:idempotencyKey,conversationId,text:value,timestamp:new Date().toISOString(),status:"SENDING"}}));setText("");}} ref={formRef} className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100"><input type="hidden" name="conversationId" value={conversationId}/><input suppressHydrationWarning type="hidden" name="idempotencyKey" value={idempotencyKey}/><textarea name="text" required value={text} onFocus={ensureRequestId} onChange={event=>updateText(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(text.trim()&&!pending&&responseWindowOpen&&idempotencyKey)formRef.current?.requestSubmit();}}} placeholder="Nhập tin nhắn…" rows={1} className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-slate-400"/><button type="submit" title="Gửi" disabled={pending||!responseWindowOpen||!idempotencyKey||!text.trim()} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" aria-label="Gửi tin nhắn">{pending?<span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"/>:<SendHorizontal className="size-5"/>}</button></form>
    <p className="mt-1.5 px-1 text-[10px] text-slate-400">Enter để gửi · Shift + Enter để xuống dòng</p>
    {!responseWindowOpen?<p className="mt-2 text-xs font-medium text-amber-700">Đã hết thời gian phản hồi Facebook. Bản nháp vẫn được giữ nhưng không thể gửi.</p>:null}
    {state.message?<p className="mt-2 text-xs text-slate-600">{state.message}</p>:null}{channelType==="FACEBOOK"?<AiDraft conversationId={conversationId}/>:null}<ProposedList actions={proposedActions} approvalDisabled={!responseWindowOpen}/>{pendingActions.map(action=><Pending key={action.id} action={action}/>)}</div>;
}

function Pending({action}:{action:{id:string;text:string|null}}){const[state,dispatch,pending]=useActionState(dispatchPendingManualChannelMessage,initial);return <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs"><span className="truncate">Đang chờ: {action.text}</span><form action={dispatch}><input type="hidden" name="actionId" value={action.id}/><button disabled={pending} className="rounded bg-blue-600 px-2 py-1 font-semibold text-white disabled:opacity-50">{pending?"Đang gửi…":"Gửi tin đang chờ"}</button></form>{state.message?<span>{state.message}</span>:null}</div>}

function Proposed({action,approvalDisabled}:{action:{id:string;text:string|null;proposedBy:string};approvalDisabled:boolean}){const[state,approve,pending]=useActionState(approveChannelMessage,initial);return <div className="mt-2 flex items-center justify-between gap-2 rounded border bg-white p-2 text-xs"><span className="truncate">{action.proposedBy}: {action.text}</span><form action={approve}><input type="hidden" name="actionId" value={action.id}/><button disabled={pending||approvalDisabled} className="rounded bg-emerald-600 px-2 py-1 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Duyệt</button></form>{state.message?<span>{state.message}</span>:null}</div>}

function ProposedList({actions,approvalDisabled}:{actions:Array<{id:string;text:string|null;proposedBy:string}>;approvalDisabled:boolean}){
  if(actions.length===0)return null;
  return <details className="group mt-2 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/60">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-violet-800 hover:bg-violet-100/70">
      <Sparkles className="size-3.5"/><span className="flex-1">Bản nháp AI đang chờ ({actions.length})</span><span className="font-normal text-violet-600">Mở để xem</span><ChevronDown className="size-3.5 transition-transform group-open:rotate-180"/>
    </summary>
    <div className="max-h-48 overflow-y-auto border-t border-violet-200 bg-white px-2 pb-2">{actions.map(action=><Proposed key={action.id} action={action} approvalDisabled={approvalDisabled}/>)}</div>
  </details>;
}

function AiDraft({conversationId}:{conversationId:string}){const[state,action,pending]=useActionState(generateOmnichannelDraft,initialAi);const[proposalState,proposeAction,proposalPending]=useActionState(proposeChannelMessage,initial);return <div className="mt-2"><form action={action} className="flex gap-2"><input type="hidden" name="conversationId" value={conversationId}/><input name="instruction" maxLength={1000} placeholder="Optional AI drafting instruction" className="flex-1 rounded border bg-white px-2 py-1 text-xs"/><button disabled={pending} className="rounded border bg-white px-2 py-1 text-xs font-semibold">{pending?"Drafting…":"AI draft"}</button></form>{state.draftText?<form action={proposeAction} className="mt-2 flex gap-2"><input type="hidden" name="conversationId" value={conversationId}/><input type="hidden" name="proposedBy" value="AI_ASSIST"/><textarea name="text" readOnly value={state.draftText} className="min-h-16 flex-1 rounded border bg-white px-2 py-1 text-xs"/><button disabled={proposalPending} className="self-end rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white">Propose reviewed draft</button></form>:null}{proposalState.message?<p className="mt-1 text-xs text-slate-500">{proposalState.message}</p>:null}{state.message?<p className="mt-1 text-xs text-slate-500">{state.message}</p>:null}</div>}
