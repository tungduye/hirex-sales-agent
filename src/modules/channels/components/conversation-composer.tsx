"use client";

import { Bot, ChevronDown, SendHorizontal, Sparkles, Undo2, X, Zap } from "lucide-react";
import { useActionState,useEffect,useMemo,useRef,useState,useTransition } from "react";
import type { ChannelType } from "../core/channel-contracts";
import { approveChannelMessage,cancelPendingManualChannelMessage,dispatchPendingManualChannelMessage,saveQuickReply,sendManualChannelMessage } from "../server/channel-actions";
import { generateOmnichannelDraft } from "../server/omnichannel-ai-actions";
import { generateHoleDraft } from "@/modules/assistant/server/hole-draft-action";
import type { ChannelActionState } from "../types/channel-action-state";
import type { QuickReplyTemplate } from "../types/quick-reply";
import { isFacebookResponseWindowOpen } from "../core/facebook-response-window";
import { INBOX_OPTIMISTIC_EVENT } from "@/modules/inbox/components/inbox-live-events";

const initial:ChannelActionState={status:"idle",message:null};
function createRequestId(){
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** Lower-case, no Vietnamese accents: "Chào hỏi" matches "chao". */
export function foldText(value:string){return value.normalize("NFD").replace(/\p{Diacritic}/gu,"").replace(/đ/gu,"d").replace(/Đ/gu,"D").toLowerCase().trim();}
/** A valid shortcut (a-z, 0-9, "-", "_") made from a template name. */
export function shortcutFromName(name:string){return foldText(name).replace(/[^a-z0-9]+/gu,"-").replace(/^-+|-+$/gu,"").slice(0,40);}
/** Templates for "/<query>": shortcut prefix matches first, then name or text containing the query. */
export function matchQuickReplies(templates:QuickReplyTemplate[],query:string){
  const needle=foldText(query);if(!needle)return templates;
  const starts=templates.filter(item=>item.shortcut.startsWith(needle));
  const rest=templates.filter(item=>!starts.includes(item)&&(foldText(item.name).includes(needle)||item.shortcut.includes(needle)||foldText(item.textContent).includes(needle)));
  return [...starts,...rest];
}

export function ConversationComposer({conversationId,channelType,conversationStatus,lastInboundAt,proposedActions,pendingActions,quickReplies,isGroup=false}:{conversationId:string;channelType:ChannelType;conversationStatus:string;lastInboundAt:string|null;proposedActions:Array<{id:string;text:string|null;proposedBy:string}>;pendingActions:Array<{id:string;text:string|null}>;quickReplies:QuickReplyTemplate[];isGroup?:boolean}){
  // Zalo groups cannot be sent to from HireX yet (the bridge sends one-to-one only).
  const groupBlocked=channelType==="ZALO"&&isGroup;
  const[state,send,pending]=useActionState(sendManualChannelMessage,initial),[text,setText]=useState("");
  const formRef=useRef<HTMLFormElement>(null);
  const textareaRef=useRef<HTMLTextAreaElement>(null);
  const[idempotencyKey,setIdempotencyKey]=useState(createRequestId);
  const submittedTextRef=useRef<string|null>(null);
  const[hint,setHint]=useState<string|null>(null);
  // Quick replies: opened with the "Mẫu" button or by typing "/" at the start of the message.
  const[localTemplates,setLocalTemplates]=useState<QuickReplyTemplate[]>([]);
  const[quickOpen,setQuickOpen]=useState(false);
  const[activeIndex,setActiveIndex]=useState(0);
  // Assistant draft: replaces the text, which can be put back with "Hoàn tác".
  // Two drafters: Hola (fast, reads the last messages) and Hole (reads the customer's record and looks things up).
  const[drafting,startDrafting]=useTransition();
  const[drafter,setDrafter]=useState<"hola"|"hole"|null>(null);
  const[beforeDraft,setBeforeDraft]=useState<string|null>(null);
  useEffect(()=>{
    if(!submittedTextRef.current||state.status==="idle")return;
    if(state.status==="error")window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:idempotencyKey,conversationId,text:submittedTextRef.current,timestamp:new Date().toISOString(),status:"FAILED"}}));
    if(state.status!=="success")return;
    const reset=window.setTimeout(()=>{submittedTextRef.current=null;setText("");setIdempotencyKey(createRequestId())},0);
    return()=>window.clearTimeout(reset);
  },[state,idempotencyKey,conversationId]);
  function ensureRequestId(){if(!idempotencyKey)setIdempotencyKey(createRequestId());}
  function updateText(value:string){setText(value);if(!idempotencyKey||state.status!=="idle")setIdempotencyKey(createRequestId());}
  const templates=useMemo(()=>{const ids=new Set(quickReplies.map(item=>item.id));return [...quickReplies,...localTemplates.filter(item=>!ids.has(item.id))].filter(reply=>reply.channelTypes.length===0||reply.channelTypes.includes(channelType));},[quickReplies,localTemplates,channelType]);
  const slashQuery=/^\/(\S*)$/u.exec(text)?.[1]??null;
  const showQuick=quickOpen||slashQuery!==null;
  const matches=matchQuickReplies(templates,slashQuery??"");
  const responseWindowOpen=!groupBlocked&&(channelType!=="FACEBOOK"||isFacebookResponseWindowOpen({status:conversationStatus,latestInboundAt:lastInboundAt},new Date()));

  function closeQuick(){setQuickOpen(false);setActiveIndex(0);if(slashQuery!==null)updateText("");}
  function pickTemplate(template:QuickReplyTemplate){setQuickOpen(false);setActiveIndex(0);updateText(template.textContent);setHint(null);setBeforeDraft(null);window.requestAnimationFrame(()=>textareaRef.current?.focus());}
  function askAssistant(which:"hola"|"hole"){
    // Whatever is already typed is passed as a hint ("hẹn PV thứ 3 lúc 10h") for the assistant to expand.
    const typed=slashQuery!==null?"":text.trim();
    const name=which==="hola"?"Hola":"Hole";
    setQuickOpen(false);setDrafter(which);setHint(which==="hola"?"Hola đang soạn…":"Hole đang đọc hồ sơ khách và soạn… (khoảng 10–20 giây)");
    startDrafting(async()=>{
      let draft:string|null=null,message:string|null=null;
      if(which==="hola"){const formData=new FormData();formData.set("conversationId",conversationId);formData.set("instruction",typed.slice(0,1000));const result=await generateOmnichannelDraft({status:"idle",message:null,draftText:null},formData);draft=result.draftText;message=result.message;}
      else{const result=await generateHoleDraft({conversationId,instruction:typed.slice(0,1000)}).catch(()=>({draftText:null,message:"Hole chưa kết nối được, thử lại sau."}));draft=result.draftText;message=result.message;}
      setDrafter(null);
      if(draft){setBeforeDraft(text);updateText(draft);setHint(`${name} đã soạn nháp, sửa lại rồi bấm Gửi.`);window.requestAnimationFrame(()=>textareaRef.current?.focus());}
      else setHint(message??`${name} chưa soạn được, anh/chị thử lại sau.`);
    });
  }
  function undoDraft(){if(beforeDraft===null)return;updateText(beforeDraft);setBeforeDraft(null);setHint(null);}

  return <div>
    {showQuick?<QuickReplyMenu templates={matches} total={templates.length} activeIndex={Math.min(activeIndex,Math.max(0,matches.length-1))} query={slashQuery} draftText={slashQuery===null?text.trim():""} onPick={pickTemplate} onClose={closeQuick} onSaved={template=>{setLocalTemplates(current=>[...current,template]);setHint(`Đã lưu mẫu /${template.shortcut}.`);}}/>:null}
    {groupBlocked?<p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Đây là nhóm Zalo: HireX chưa gửi được tin vào nhóm. Anh/chị vẫn soạn nháp được (Hola/Hole) rồi sao chép sang ứng dụng Zalo để gửi.</p>:null}
    <form action={send} onSubmit={()=>{const value=text.trim();if(!value)return;submittedTextRef.current=value;window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:idempotencyKey,conversationId,text:value,timestamp:new Date().toISOString(),status:"SENDING"}}));setText("");setHint(null);setBeforeDraft(null);}} ref={formRef} className="rounded-[14px] border border-slate-300 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
      <input type="hidden" name="conversationId" value={conversationId}/><input suppressHydrationWarning type="hidden" name="idempotencyKey" value={idempotencyKey}/>
      <label htmlFor={`composer-${conversationId}`} className="sr-only">Nội dung tin nhắn</label>
      <textarea id={`composer-${conversationId}`} ref={textareaRef} name="text" required value={text} onFocus={ensureRequestId} onChange={event=>{updateText(event.target.value);if(hint&&!drafting)setHint(null);setActiveIndex(0);}}
        onKeyDown={event=>{
          if(showQuick&&matches.length>0){
            if(event.key==="ArrowDown"){event.preventDefault();setActiveIndex(index=>(index+1)%matches.length);return;}
            if(event.key==="ArrowUp"){event.preventDefault();setActiveIndex(index=>(index-1+matches.length)%matches.length);return;}
            if((event.key==="Enter"&&!event.shiftKey)||event.key==="Tab"){event.preventDefault();pickTemplate(matches[Math.min(activeIndex,matches.length-1)]);return;}
          }
          if(showQuick&&event.key==="Escape"){event.preventDefault();closeQuick();return;}
          if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(text.trim()&&slashQuery===null&&!pending&&!drafting&&responseWindowOpen&&idempotencyKey)formRef.current?.requestSubmit();}
        }}
        placeholder="Nhập tin nhắn… (Enter gửi · Shift+Enter xuống dòng · / mẫu trả lời)" rows={3} disabled={drafting} className="block max-h-48 min-h-[72px] w-full resize-none rounded-t-[14px] bg-transparent px-3.5 pb-1 pt-3 text-sm leading-6 outline-none placeholder:text-slate-400 disabled:text-slate-400"/>
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2 pt-1">
        <button type="button" onClick={()=>setQuickOpen(open=>!open)} aria-expanded={showQuick} className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold ${showQuick?"bg-slate-100 text-slate-900":"text-slate-700 hover:bg-slate-100"}`} title="Câu trả lời mẫu (gõ / để mở)"><Zap className="size-[15px]"/>Mẫu</button>
        <button type="button" onClick={()=>askAssistant("hola")} disabled={drafting} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60" title={text.trim()&&slashQuery===null?"Hola (nhanh): viết lại ý anh/chị đã gõ thành câu trả lời hoàn chỉnh":"Hola (nhanh): đọc các tin gần nhất và soạn nháp"}>{drafter==="hola"?<span className="size-3.5 animate-spin rounded-full border-2 border-violet-600 border-t-transparent"/>:<Sparkles className="size-[15px]"/>}Hola</button>
        <button type="button" onClick={()=>askAssistant("hole")} disabled={drafting} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60" title={text.trim()&&slashQuery===null?"Hole (kỹ): đọc hồ sơ khách, tra job/chiến dịch rồi viết ý anh/chị đã gõ thành câu trả lời":"Hole (kỹ): đọc hội thoại, hồ sơ khách, tra job/chiến dịch khi cần rồi soạn nháp"}>{drafter==="hole"?<span className="size-3.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"/>:<Bot className="size-[15px]"/>}Hole</button>
        {beforeDraft!==null&&!drafting?<button type="button" onClick={undoDraft} className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Undo2 className="size-3.5"/>Hoàn tác</button>:null}
        <span className="min-w-0 flex-1 truncate px-1 text-right text-xs text-slate-500" aria-live="polite">{hint??(state.status==="error"?state.message:null)}</span>
        <button type="submit" disabled={pending||drafting||!responseWindowOpen||!idempotencyKey||!text.trim()||slashQuery!==null} className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" aria-label="Gửi tin nhắn">{pending?<span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"/>:<>Gửi<SendHorizontal className="size-4"/></>}</button>
      </div>
    </form>
    {!responseWindowOpen?<p className="mt-2 text-xs font-medium text-amber-700">Đã hết thời gian phản hồi Facebook. Bản nháp vẫn được giữ nhưng không thể gửi.</p>:null}
    {state.message&&state.status!=="error"?<p className="mt-1.5 px-1 text-xs text-slate-500">{state.message}</p>:null}
    <ProposedList actions={proposedActions} approvalDisabled={!responseWindowOpen}/>{pendingActions.map(action=><Pending key={action.id} action={action}/>)}
  </div>;
}

function QuickReplyMenu({templates,total,activeIndex,query,draftText,onPick,onClose,onSaved}:{templates:QuickReplyTemplate[];total:number;activeIndex:number;query:string|null;draftText:string;onPick:(template:QuickReplyTemplate)=>void;onClose:()=>void;onSaved:(template:QuickReplyTemplate)=>void}){
  const[saving,setSaving]=useState(false);
  const[name,setName]=useState("");
  const[saveState,save,savePending]=useActionState(saveQuickReply,initial);
  const listRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({block:"nearest"});},[activeIndex]);
  const shortcut=shortcutFromName(name);
  // Show the new template right away; the server list refreshes on the next page load.
  const savedRef=useRef(false);
  useEffect(()=>{if(saveState.status==="success"&&!savedRef.current&&shortcut){savedRef.current=true;onSaved({id:`local-${shortcut}`,name:name.trim(),shortcut,textContent:draftText,channelTypes:[]});setSaving(false);setName("");}},[saveState,shortcut,name,draftText,onSaved]);
  return <div className="mb-2 max-w-[560px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" role="dialog" aria-label="Câu trả lời mẫu">
    <div className="flex items-center justify-between px-2.5 pb-1 pt-1"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Câu trả lời mẫu · gõ "/" để mở{query?` · đang tìm "${query}"`:""}</p><button type="button" onClick={onClose} aria-label="Đóng" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-3.5"/></button></div>
    <div ref={listRef} role="listbox" aria-label="Danh sách mẫu" className="max-h-56 overflow-y-auto">
      {templates.map((template,index)=><button key={template.id} type="button" role="option" aria-selected={index===activeIndex} data-index={index} onMouseDown={event=>event.preventDefault()} onClick={()=>onPick(template)} className={`block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-700 ${index===activeIndex?"bg-blue-50":"hover:bg-slate-50"}`}><strong className="text-blue-700">/{template.shortcut}</strong> <span className="font-semibold text-slate-800">{template.name}</span> · {template.textContent}</button>)}
      {templates.length===0?<p className="px-2.5 py-3 text-[13px] text-slate-500">{total===0?"Chưa có câu trả lời mẫu nào. Soạn một tin hay dùng rồi lưu thành mẫu ở dưới.":"Không có mẫu nào khớp."}</p>:null}
    </div>
    <div className="mt-1 border-t border-slate-100 px-2.5 pb-1 pt-2">
      {!saving?<button type="button" onClick={()=>setSaving(true)} disabled={!draftText} className="text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline" title={draftText?"":"Gõ nội dung tin nhắn trước, rồi lưu thành mẫu"}>+ Lưu tin đang soạn thành mẫu</button>
      :<form action={save} onSubmit={()=>{savedRef.current=false;}} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="id" value=""/><input type="hidden" name="shortcut" value={shortcut}/><input type="hidden" name="textContent" value={draftText}/>
        <input autoFocus required maxLength={100} value={name} onChange={event=>setName(event.target.value)} placeholder="Tên mẫu, ví dụ: Chào hỏi" className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-blue-400"/>
        <span className="text-xs text-slate-500">{shortcut?`/${shortcut}`:""}</span>
        <button disabled={savePending||!shortcut} className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">{savePending?"Đang lưu…":"Lưu mẫu"}</button>
        <button type="button" onClick={()=>setSaving(false)} className="h-8 px-1.5 text-xs text-slate-500 hover:text-slate-800">Hủy</button>
        {saveState.status==="error"?<p className="w-full text-xs text-rose-600">{saveState.message==="Quick reply could not be saved."?"Chưa lưu được mẫu (tên tắt có thể đã tồn tại).":saveState.message}</p>:null}
      </form>}
    </div>
  </div>;
}

function Pending({action}:{action:{id:string;text:string|null}}){const[state,dispatch,pending]=useActionState(dispatchPendingManualChannelMessage,initial);const[cancelState,cancel,cancelling]=useActionState(cancelPendingManualChannelMessage,initial);const message=cancelState.message??state.message;return <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs"><span className="min-w-0 flex-1 truncate">Đang chờ: {action.text}</span><div className="flex gap-1.5"><form action={dispatch}><input type="hidden" name="actionId" value={action.id}/><button disabled={pending||cancelling} className="rounded bg-blue-600 px-2 py-1 font-semibold text-white disabled:opacity-50">{pending?"Đang gửi…":"Gửi tin đang chờ"}</button></form><form action={cancel}><input type="hidden" name="actionId" value={action.id}/><button disabled={pending||cancelling} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" title="Bỏ tin này, tin chưa được gửi">{cancelling?"Đang huỷ…":"Huỷ"}</button></form></div>{message?<span className="w-full">{message}</span>:null}</div>}

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
