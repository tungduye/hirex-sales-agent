"use client";

import { EmojiPicker } from "./emoji-picker";
import { buildMentions, mentionQueryAt, suggestMembers, type MentionPick } from "../core/zalo-mentions";
import { insertAt } from "../core/text-insert";
import { Bot, ChevronDown, FileText, Paperclip, Reply, SendHorizontal, Sparkles, Undo2, X, Zap } from "lucide-react";
import { formatFileSize, isZaloImage, MAX_ZALO_FILES_PER_SEND, zaloContentType, zaloFileProblem, ZALO_FILE_PROBLEM_TEXT } from "../core/zalo-files";
import { DRAFT_EVENT, draftStore, readDraft, writeDraft } from "../core/composer-drafts";
import { useActionState,useEffect,useMemo,useRef,useState,useTransition } from "react";
import type { ChannelType } from "../core/channel-contracts";
import { approveChannelMessage,cancelPendingManualChannelMessage,dispatchPendingManualChannelMessage,saveQuickReply,sendManualChannelMessage,sendZaloFileReply } from "../server/channel-actions";
import { generateOmnichannelDraft } from "../server/omnichannel-ai-actions";
import { generateHoleDraft, type HoleDraftResult } from "@/modules/assistant/server/hole-draft-action";
import type { ChannelActionState } from "../types/channel-action-state";
import type { QuickReplyTemplate } from "../types/quick-reply";
import { isFacebookResponseWindowOpen } from "../core/facebook-response-window";
import { INBOX_OPTIMISTIC_EVENT } from "@/modules/inbox/components/inbox-live-events";
import { RecFlowBar, REC_FLOW_EVENT } from "@/modules/rec-flow/components/rec-flow-bar";
import { saveRecFlow } from "@/modules/rec-flow/server/rec-flow-actions";
import { splitParts, type RecFlowState } from "@/modules/rec-flow/core/rec-flow";

const initial:ChannelActionState={status:"idle",message:null};
function createRequestId(){
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** A file picked for a Zalo chat: uploaded, then sent as its own message. */
type PickedFile={key:string;file:File;previewUrl:string|null;status:"ready"|"uploading"|"sending"|"sent"|"failed";attachmentId?:string;error?:string};
const wait=(ms:number)=>new Promise(resolve=>window.setTimeout(resolve,ms));
async function uploadZaloFile(conversationId:string,file:File):Promise<{id:string}|{error:string}>{
  const body=new FormData();body.set("file",file);
  try{
    const response=await fetch(`/api/inbox/conversations/${conversationId}/attachments`,{method:"POST",body});
    const result=await response.json().catch(()=>null) as {ok?:boolean;id?:string;message?:string}|null;
    return result?.ok&&typeof result.id==="string"?{id:result.id}:{error:result?.message??"Chưa tải tệp lên được."};
  }catch{return{error:"Mất kết nối khi tải tệp lên."};}
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

export function ConversationComposer({conversationId,channelType,conversationStatus,lastInboundAt,proposedActions,pendingActions,quickReplies,isGroup=false,businessSuiteUrl=null,mentionMembers=[],replyTo=null,onCancelReply}:{replyTo?:{messageId:string;text:string;sender:string}|null;onCancelReply?:()=>void;conversationId:string;channelType:ChannelType;conversationStatus:string;lastInboundAt:string|null;proposedActions:Array<{id:string;text:string|null;proposedBy:string}>;pendingActions:Array<{id:string;text:string|null}>;quickReplies:QuickReplyTemplate[];isGroup?:boolean;businessSuiteUrl?:string|null;mentionMembers?:Array<{uid:string;name:string;avatarUrl:string|null}>}){
  // Zalo groups cannot be sent to from HireX yet (the bridge sends one-to-one only).
  const zaloGroup=channelType==="ZALO"&&isGroup;
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
  // Zalo group: typing "@" suggests members; picked names are sent as real Zalo mentions.
  const[caret,setCaret]=useState(0);
  const[picks,setPicks]=useState<MentionPick[]>([]);
  const[mentionIndex,setMentionIndex]=useState(0);
  const[mentionDismissed,setMentionDismissed]=useState<number|null>(null);
  // Zalo: files picked with the paperclip, pasted, or dropped on the box; each is sent as its own message.
  const canAttach=channelType==="ZALO";
  const fileInputRef=useRef<HTMLInputElement>(null);
  const[files,setFiles]=useState<PickedFile[]>([]);
  const filesRef=useRef<PickedFile[]>([]);
  useEffect(()=>{filesRef.current=files;},[files]);
  useEffect(()=>()=>{for(const item of filesRef.current)if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);},[]);
  const[sendingFiles,setSendingFiles]=useState(false);
  const[dragging,setDragging]=useState(false);
  const pendingFiles=files.filter(item=>item.status==="ready"||item.status==="failed");
  // Rec flow: Hola's proposed next state (step, what the candidate said) is saved once its draft is sent.
  const recFlowChat=!isGroup&&(channelType==="ZALO"||channelType==="FACEBOOK"||channelType==="FACEBOOK_PROFILE");
  const pendingFlowRef=useRef<RecFlowState|null>(null);
  async function commitFlow(){
    const flow=pendingFlowRef.current;pendingFlowRef.current=null;
    if(!flow||!recFlowChat)return;
    const saved=await saveRecFlow({conversationId,flow}).catch(()=>null);
    if(saved)window.dispatchEvent(new CustomEvent(REC_FLOW_EVENT,{detail:{conversationId,state:saved}}));
  }
  useEffect(()=>{
    if(!submittedTextRef.current||state.status==="idle")return;
    if(state.status==="error"){
      const failed=submittedTextRef.current;
      window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:idempotencyKey,conversationId,text:failed,timestamp:new Date().toISOString(),status:"FAILED"}}));
      // Not sent: put the text back so it is not lost (it stays saved as this conversation's draft).
      const restore=window.setTimeout(()=>{submittedTextRef.current=null;setText(current=>current||failed);},0);
      return()=>window.clearTimeout(restore);
    }
    if(state.status!=="success")return;
    void commitFlow();
    const reset=window.setTimeout(()=>{submittedTextRef.current=null;setText("");setPicks([]);setIdempotencyKey(createRequestId());writeDraft(draftStore(),conversationId,"",[],Date.now());window.dispatchEvent(new Event(DRAFT_EVENT));onCancelReply?.();},0);
    return()=>window.clearTimeout(reset);
  },[state,idempotencyKey,conversationId,onCancelReply]);
  // This conversation's unsent text comes back when it is opened again.
  useEffect(()=>{
    const draft=readDraft(draftStore(),conversationId,Date.now());
    if(!draft)return;
    const load=window.setTimeout(()=>{setText(current=>current||draft.text);setPicks(current=>current.length?current:draft.picks);},0);
    return()=>window.clearTimeout(load);
  },[conversationId]);
  useEffect(()=>{
    if(submittedTextRef.current)return;
    const save=window.setTimeout(()=>{writeDraft(draftStore(),conversationId,text,picks,Date.now());window.dispatchEvent(new Event(DRAFT_EVENT));},400);
    return()=>window.clearTimeout(save);
  },[conversationId,text,picks]);
  // Choosing "Trả lời" on a message puts the cursor in the box.
  useEffect(()=>{if(replyTo)window.requestAnimationFrame(()=>textareaRef.current?.focus());},[replyTo]);
  function ensureRequestId(){if(!idempotencyKey)setIdempotencyKey(createRequestId());}
  function updateText(value:string){setText(value);if(!idempotencyKey||state.status!=="idle")setIdempotencyKey(createRequestId());}
  const templates=useMemo(()=>{const ids=new Set(quickReplies.map(item=>item.id));return [...quickReplies,...localTemplates.filter(item=>!ids.has(item.id))].filter(reply=>reply.channelTypes.length===0||reply.channelTypes.includes(channelType));},[quickReplies,localTemplates,channelType]);
  const slashQuery=/^\/(\S*)$/u.exec(text)?.[1]??null;
  const mentionQuery=zaloGroup&&mentionMembers.length>0?mentionQueryAt(text,caret):null;
  const mentionOptions=mentionQuery&&mentionQuery.start!==mentionDismissed?suggestMembers(mentionMembers,mentionQuery.query):[];
  const showMentions=mentionOptions.length>0;
  const mentions=zaloGroup?buildMentions(text,picks):[];
  const showQuick=quickOpen||slashQuery!==null;
  const matches=matchQuickReplies(templates,slashQuery??"");
  const responseWindowOpen=(channelType!=="FACEBOOK"||isFacebookResponseWindowOpen({status:conversationStatus,latestInboundAt:lastInboundAt},new Date()));

  function closeQuick(){setQuickOpen(false);setActiveIndex(0);if(slashQuery!==null)updateText("");}
  function pickTemplate(template:QuickReplyTemplate){setQuickOpen(false);setActiveIndex(0);updateText(template.textContent);setHint(null);setBeforeDraft(null);window.requestAnimationFrame(()=>textareaRef.current?.focus());}
  function askAssistant(which:"hola"|"hole"){
    // Whatever is already typed is passed as a hint ("hẹn PV thứ 3 lúc 10h") for the assistant to expand.
    const typed=slashQuery!==null?"":text.trim();
    const name=which==="hola"?"Hola":"Hole";
    setQuickOpen(false);setDrafter(which);setHint(which==="hola"?"Hola đang soạn…":"Hole đang đọc hồ sơ khách và soạn… (khoảng 10–20 giây)");
    startDrafting(async()=>{
      let draft:string|null=null,message:string|null=null;
      if(which==="hola"){const formData=new FormData();formData.set("conversationId",conversationId);formData.set("instruction",typed.slice(0,1000));const result=await generateOmnichannelDraft({status:"idle",message:null,draftText:null},formData);draft=result.draftText;message=result.message;pendingFlowRef.current=result.flow??null;}
      else{const result:HoleDraftResult=await generateHoleDraft({conversationId,instruction:typed.slice(0,1000)}).catch(()=>({draftText:null,message:"Hole chưa kết nối được, thử lại sau."}));draft=result.draftText;message=result.message;pendingFlowRef.current=result.flow??null;}
      setDrafter(null);
      if(draft){setBeforeDraft(text);updateText(draft);setHint(`${name} đã soạn nháp${splitParts(draft).length>1?", mỗi đoạn ngăn bởi dòng --- là một tin riêng":""}; sửa lại rồi bấm Gửi.`);window.requestAnimationFrame(()=>textareaRef.current?.focus());}
      else setHint(message??`${name} chưa soạn được, anh/chị thử lại sau.`);
    });
  }
  // Emoji go in at the caret (or replace the selection), and the caret moves after them.
  function insertEmoji(emoji:string){
    const area=textareaRef.current;
    const next=insertAt(text,emoji,area?.selectionStart??text.length,area?.selectionEnd??text.length);
    updateText(next.text);
    window.requestAnimationFrame(()=>{area?.focus();area?.setSelectionRange(next.caret,next.caret);});
  }
  function pickMention(member:MentionPick){
    if(!mentionQuery)return;
    const inserted=`@${member.name} `;
    const next=text.slice(0,mentionQuery.start)+inserted+text.slice(caret);
    const position=mentionQuery.start+inserted.length;
    updateText(next);setCaret(position);setMentionIndex(0);
    setPicks(current=>current.some(item=>item.uid===member.uid&&item.name===member.name)?current:[...current,{uid:member.uid,name:member.name}]);
    window.requestAnimationFrame(()=>{textareaRef.current?.focus();textareaRef.current?.setSelectionRange(position,position);});
  }
  function undoDraft(){if(beforeDraft===null)return;updateText(beforeDraft);setBeforeDraft(null);setHint(null);}
  function addFiles(list:FileList|File[]|null){
    if(!canAttach||!list)return;
    const picked=Array.from(list),problems:string[]=[],added:PickedFile[]=[];
    for(const file of picked){
      const problem=zaloFileProblem({name:file.name,size:file.size});
      if(problem){problems.push(`${file.name}: ${ZALO_FILE_PROBLEM_TEXT[problem]}`);continue;}
      added.push({key:createRequestId(),file,status:"ready",previewUrl:isZaloImage(file.name,zaloContentType(file.name,file.type))?URL.createObjectURL(file):null});
    }
    const room=MAX_ZALO_FILES_PER_SEND-filesRef.current.filter(item=>item.status!=="sent").length;
    for(const item of added.slice(Math.max(0,room)))if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);
    if(added.length>room)problems.push(`Mỗi lần gửi tối đa ${MAX_ZALO_FILES_PER_SEND} tệp.`);
    if(room>0&&added.length)setFiles(current=>[...current.filter(item=>item.status!=="sent"),...added.slice(0,room)]);
    setHint(problems.length?problems.join(" "):null);
  }
  function removeFile(key:string){setFiles(current=>{const item=current.find(entry=>entry.key===key);if(item?.previewUrl)URL.revokeObjectURL(item.previewUrl);return current.filter(entry=>entry.key!==key);});}
  function patchFile(key:string,patch:Partial<PickedFile>){setFiles(current=>current.map(item=>item.key===key?{...item,...patch}:item));}
  // Text first (with its tags and quote), then each file in order. A file that fails stays in the box to retry.
  async function sendWithFiles(){
    if(sendingFiles)return;
    setSendingFiles(true);setHint(null);
    try{
      // Text: one message, or several when lines of "---" split it (Hola drafts up to 3 short messages).
      const parts=splitParts(text);
      if(parts.length&&formRef.current){
        const base=new FormData(formRef.current);
        for(let index=0;index<parts.length;index++){
          const part=parts[index]!,key=index===0?idempotencyKey:createRequestId();
          const formData=new FormData();
          formData.set("conversationId",conversationId);formData.set("idempotencyKey",key);formData.set("text",part);
          const partMentions=zaloGroup?buildMentions(part,picks):[];
          if(partMentions.length)formData.set("mentions",JSON.stringify(partMentions));
          const quote=base.get("quoteMessageId");
          if(index===0&&typeof quote==="string"&&quote)formData.set("quoteMessageId",quote);
          if(index>0)await wait(1200);
          window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:key,conversationId,text:part,timestamp:new Date().toISOString(),status:"SENDING"}}));
          const result=await sendManualChannelMessage(initial,formData);
          if(result.status!=="success"){
            window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:key,conversationId,text:part,timestamp:new Date().toISOString(),status:"FAILED"}}));
            // Keep what was not sent in the box.
            setText(parts.slice(index).join("\n---\n"));setIdempotencyKey(createRequestId());
            setHint(result.message??"Chưa gửi được tin nhắn.");return;
          }
        }
        void commitFlow();
        setText("");setPicks([]);setIdempotencyKey(createRequestId());writeDraft(draftStore(),conversationId,"",[],Date.now());window.dispatchEvent(new Event(DRAFT_EVENT));
        if(pendingFiles.length)await wait(1200);
      }
      onCancelReply?.();
      let failures=0,first=true;
      for(const item of filesRef.current.filter(entry=>entry.status==="ready"||entry.status==="failed")){
        if(!first)await wait(1200);
        first=false;
        let attachmentId=item.attachmentId;
        if(!attachmentId){
          patchFile(item.key,{status:"uploading",error:undefined});
          const uploaded=await uploadZaloFile(conversationId,item.file);
          if("error" in uploaded){failures++;patchFile(item.key,{status:"failed",error:uploaded.error});continue;}
          attachmentId=uploaded.id;
        }
        patchFile(item.key,{status:"sending",attachmentId,error:undefined});
        let result=await sendZaloFileReply({conversationId,attachmentId,idempotencyKey:createRequestId()});
        // The nick finishes the previous message first: wait a moment and try once more.
        if(result.status==="error"&&result.message?.includes("đang xử lý")){await wait(2500);result=await sendZaloFileReply({conversationId,attachmentId,idempotencyKey:createRequestId()});}
        if(result.status==="success")patchFile(item.key,{status:"sent"});
        else{failures++;patchFile(item.key,{status:"failed",error:result.message??"Chưa gửi được tệp."});}
      }
      setHint(failures?`${failures} tệp chưa gửi được. Bấm Gửi để thử lại hoặc bỏ tệp đó.`:null);
      window.setTimeout(()=>setFiles(current=>{for(const item of current)if(item.status==="sent"&&item.previewUrl)URL.revokeObjectURL(item.previewUrl);return current.filter(item=>item.status!=="sent");}),1500);
    }finally{setSendingFiles(false);}
  }

  return <div>
    {showQuick?<QuickReplyMenu templates={matches} total={templates.length} activeIndex={Math.min(activeIndex,Math.max(0,matches.length-1))} query={slashQuery} draftText={slashQuery===null?text.trim():""} onPick={pickTemplate} onClose={closeQuick} onSaved={template=>{setLocalTemplates(current=>[...current,template]);setHint(`Đã lưu mẫu /${template.shortcut}.`);}}/>:null}
    {zaloGroup?<p className="mb-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs leading-5 text-sky-900">Nhóm Zalo: tin nhắn sẽ gửi vào nhóm, mọi thành viên đều thấy.{mentionMembers.length?" Gõ @ để tag thành viên.":""}</p>:null}
    {showMentions?<div role="listbox" aria-label="Tag thành viên" className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">{mentionOptions.map((member,index)=>{const person=mentionMembers.find(item=>item.uid===member.uid);return <button key={`${member.uid}:${member.name}`} type="button" role="option" aria-selected={index===mentionIndex} onMouseDown={event=>{event.preventDefault();pickMention(member);}} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${index===mentionIndex?"bg-blue-50 text-blue-800":"hover:bg-slate-50"}`}>{person?.avatarUrl?<img src={person.avatarUrl} alt="" className="size-6 rounded-full object-cover"/>:<span className="flex size-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">{member.uid==="-1"?"@":member.name.slice(0,1).toUpperCase()}</span>}<span className="truncate font-medium">{member.uid==="-1"?"@All · cả nhóm":member.name}</span></button>;})}</div>:null}
    {replyTo&&channelType==="ZALO"?<div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-blue-400 bg-blue-50 px-3 py-1.5 text-xs"><Reply className="mt-0.5 size-3.5 shrink-0 text-blue-600"/><div className="min-w-0 flex-1"><p className="font-semibold text-blue-800">Trả lời {replyTo.sender}</p><p className="truncate text-slate-600">{replyTo.text}</p></div><button type="button" onClick={onCancelReply} aria-label="Bỏ trả lời" className="rounded p-0.5 text-slate-400 hover:bg-blue-100 hover:text-slate-700"><X className="size-3.5"/></button></div>:null}
    {recFlowChat?<RecFlowBar conversationId={conversationId}/>:null}
    <form action={send} onDragOver={canAttach?event=>{if(Array.from(event.dataTransfer.types).includes("Files")){event.preventDefault();setDragging(true);}}:undefined} onDragLeave={canAttach?()=>setDragging(false):undefined} onDrop={canAttach?event=>{if(event.dataTransfer.files.length){event.preventDefault();setDragging(false);addFiles(event.dataTransfer.files);}}:undefined} onSubmit={event=>{if(pendingFiles.length>0||splitParts(text).length>1){event.preventDefault();void sendWithFiles();return;}const value=text.trim();if(!value)return;submittedTextRef.current=value;window.dispatchEvent(new CustomEvent(INBOX_OPTIMISTIC_EVENT,{detail:{id:idempotencyKey,conversationId,text:value,timestamp:new Date().toISOString(),status:"SENDING"}}));setText("");setHint(null);setBeforeDraft(null);}} ref={formRef} className={`rounded-[14px] border bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 ${dragging?"border-blue-400 ring-2 ring-blue-200":"border-slate-300"}`}>
      <input type="hidden" name="conversationId" value={conversationId}/>{mentions.length?<input type="hidden" name="mentions" value={JSON.stringify(mentions)}/>:null}{replyTo&&channelType==="ZALO"?<input type="hidden" name="quoteMessageId" value={replyTo.messageId}/>:null}<input suppressHydrationWarning type="hidden" name="idempotencyKey" value={idempotencyKey}/>
      {files.length?<ul aria-label="Tệp sẽ gửi" className="flex flex-wrap gap-2 px-3 pt-3">{files.map(item=><li key={item.key} className={`relative flex max-w-[240px] items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${item.status==="failed"?"border-red-200 bg-red-50":item.status==="sent"?"border-emerald-200 bg-emerald-50":"border-slate-200 bg-slate-50"}`} title={item.error??item.file.name}>
        {item.previewUrl?<img src={item.previewUrl} alt="" className="size-9 shrink-0 rounded object-cover"/>:<span className="flex size-9 shrink-0 items-center justify-center rounded bg-white text-slate-500"><FileText className="size-4"/></span>}
        <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{item.file.name}</span><span className={`block truncate ${item.status==="failed"?"text-red-600":"text-slate-500"}`}>{item.status==="uploading"?"Đang tải lên…":item.status==="sending"?"Đang gửi…":item.status==="sent"?"Đã gửi":item.status==="failed"?item.error??"Chưa gửi được":formatFileSize(item.file.size)}</span></span>
        {item.status==="uploading"||item.status==="sending"?<span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"/>:item.status!=="sent"?<button type="button" onClick={()=>removeFile(item.key)} disabled={sendingFiles} aria-label={`Bỏ ${item.file.name}`} className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"><X className="size-3.5"/></button>:null}
      </li>)}</ul>:null}
      <label htmlFor={`composer-${conversationId}`} className="sr-only">Nội dung tin nhắn</label>
      <textarea id={`composer-${conversationId}`} ref={textareaRef} name="text" required={pendingFiles.length===0} value={text} onFocus={ensureRequestId} onChange={event=>{updateText(event.target.value);setCaret(event.target.selectionStart??event.target.value.length);setMentionIndex(0);setMentionDismissed(null);if(hint&&!drafting)setHint(null);setActiveIndex(0);}}
        onSelect={event=>setCaret(event.currentTarget.selectionStart??0)}
        onPaste={canAttach?event=>{if(event.clipboardData.files.length){event.preventDefault();addFiles(event.clipboardData.files);}}:undefined}
        onKeyDown={event=>{
          if(showMentions){
            if(event.key==="ArrowDown"){event.preventDefault();setMentionIndex(index=>(index+1)%mentionOptions.length);return;}
            if(event.key==="ArrowUp"){event.preventDefault();setMentionIndex(index=>(index-1+mentionOptions.length)%mentionOptions.length);return;}
            if((event.key==="Enter"&&!event.shiftKey)||event.key==="Tab"){event.preventDefault();pickMention(mentionOptions[Math.min(mentionIndex,mentionOptions.length-1)]);return;}
            if(event.key==="Escape"){event.preventDefault();setMentionDismissed(mentionQuery?.start??null);return;}
          }
          if(showQuick&&matches.length>0){
            if(event.key==="ArrowDown"){event.preventDefault();setActiveIndex(index=>(index+1)%matches.length);return;}
            if(event.key==="ArrowUp"){event.preventDefault();setActiveIndex(index=>(index-1+matches.length)%matches.length);return;}
            if((event.key==="Enter"&&!event.shiftKey)||event.key==="Tab"){event.preventDefault();pickTemplate(matches[Math.min(activeIndex,matches.length-1)]);return;}
          }
          if(showQuick&&event.key==="Escape"){event.preventDefault();closeQuick();return;}
          if(replyTo&&event.key==="Escape"){event.preventDefault();onCancelReply?.();return;}
          if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if((text.trim()||pendingFiles.length)&&slashQuery===null&&!pending&&!sendingFiles&&!drafting&&responseWindowOpen&&idempotencyKey)formRef.current?.requestSubmit();}
        }}
        placeholder="Nhập tin nhắn… (Enter gửi · Shift+Enter xuống dòng · / mẫu trả lời)" rows={3} disabled={drafting} className="block max-h-48 min-h-[72px] w-full resize-none rounded-t-[14px] bg-transparent px-3.5 pb-1 pt-3 text-sm leading-6 outline-none placeholder:text-slate-400 disabled:text-slate-400"/>
      <div className="flex flex-wrap items-center gap-1 px-2 pb-2 pt-1">
        <button type="button" onClick={()=>setQuickOpen(open=>!open)} aria-expanded={showQuick} className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold ${showQuick?"bg-slate-100 text-slate-900":"text-slate-700 hover:bg-slate-100"}`} title="Câu trả lời mẫu (gõ / để mở)"><Zap className="size-[15px]"/>Mẫu</button>
        <EmojiPicker onPick={insertEmoji} disabled={drafting}/>
        {canAttach?<><input ref={fileInputRef} type="file" multiple hidden onChange={event=>{addFiles(event.target.files);event.target.value="";}}/><button type="button" onClick={()=>fileInputRef.current?.click()} disabled={drafting||sendingFiles} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60" title="Gửi ảnh hoặc tệp (tối đa 25 MB mỗi tệp). Có thể dán ảnh (Ctrl+V) hoặc kéo thả tệp vào ô soạn tin."><Paperclip className="size-[15px]"/>Tệp</button></>:null}
        <button type="button" onClick={()=>askAssistant("hola")} disabled={drafting} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60" title={text.trim()&&slashQuery===null?"Hola (nhanh): viết lại ý anh/chị đã gõ thành câu trả lời hoàn chỉnh":"Hola (nhanh): đọc các tin gần nhất và soạn nháp"}>{drafter==="hola"?<span className="size-3.5 animate-spin rounded-full border-2 border-violet-600 border-t-transparent"/>:<Sparkles className="size-[15px]"/>}Hola</button>
        <button type="button" onClick={()=>askAssistant("hole")} disabled={drafting} className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60" title={text.trim()&&slashQuery===null?"Hole (kỹ): đọc hồ sơ khách, tra job/chiến dịch rồi viết ý anh/chị đã gõ thành câu trả lời":"Hole (kỹ): đọc hội thoại, hồ sơ khách, tra job/chiến dịch khi cần rồi soạn nháp"}>{drafter==="hole"?<span className="size-3.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"/>:<Bot className="size-[15px]"/>}Hole</button>
        {beforeDraft!==null&&!drafting?<button type="button" onClick={undoDraft} className="inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"><Undo2 className="size-3.5"/>Hoàn tác</button>:null}
        <span className="min-w-0 flex-1 truncate px-1 text-right text-xs text-slate-500" aria-live="polite">{hint??(state.status==="error"?state.message:null)}</span>
        <button type="submit" disabled={pending||sendingFiles||drafting||!responseWindowOpen||!idempotencyKey||(!text.trim()&&pendingFiles.length===0)||slashQuery!==null} className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" aria-label="Gửi tin nhắn">{pending||sendingFiles?<span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"/>:<>Gửi<SendHorizontal className="size-4"/></>}</button>
      </div>
    </form>
    {!responseWindowOpen?<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-amber-700"><span>{businessSuiteUrl?"Đã quá 24 giờ từ tin cuối của khách nên HireX không gửi được qua Facebook. Bản nháp vẫn được giữ; trả lời trong Meta Business Suite (không giới hạn thời gian): mở hộp thư của Page rồi chọn khách trong danh sách.":"Đã hết thời gian phản hồi Facebook. Bản nháp vẫn được giữ nhưng không thể gửi."}</span>{businessSuiteUrl?<a href={businessSuiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-lg border border-blue-200 bg-white px-2.5 py-1 font-semibold text-blue-700 hover:bg-blue-50">Mở trong Meta Business Suite ↗</a>:null}</p>:null}
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
