import { createHash } from "node:crypto";

export const ATTACHMENT_BUCKET="email-attachments";
export const MAX_ATTACHMENT_BYTES=10*1024*1024;
export const MAX_STEP_ATTACHMENT_BYTES=18*1024*1024;
export const MAX_STEP_ATTACHMENTS=10;
const types:Record<string,readonly string[]>={pdf:["application/pdf"],doc:["application/msword"],docx:["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],xls:["application/vnd.ms-excel"],xlsx:["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],ppt:["application/vnd.ms-powerpoint"],pptx:["application/vnd.openxmlformats-officedocument.presentationml.presentation"],txt:["text/plain"],csv:["text/csv","text/plain"],png:["image/png"],jpg:["image/jpeg"],jpeg:["image/jpeg"]};
export type SafeAttachment={id:string;filename:string;mimeType:string;sizeBytes:number;sha256:string;bytes:Buffer};
export function validateAttachmentDescriptor(name:string,mime:string,size:number){const clean=name.normalize("NFKC");if(!clean||/[\u0000-\u001f\u007f-\u009f\/\\]/.test(clean)||clean.includes("..")||clean.length>255)return "ATTACHMENT_TYPE_UNSUPPORTED" as const;const ext=clean.split(".").pop()?.toLowerCase()??"";if(!types[ext]?.includes(mime.toLowerCase()))return "ATTACHMENT_TYPE_UNSUPPORTED" as const;if(!Number.isInteger(size)||size<1||size>MAX_ATTACHMENT_BYTES)return "ATTACHMENT_SIZE_LIMIT" as const;return null;}
export function safeAttachmentFilename(name:string,id:string){const ext=name.normalize("NFKC").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g,"")||"bin";return `attachment-${id.toLowerCase()}.${ext}`;}
export function sha256(bytes:Buffer){return createHash("sha256").update(bytes).digest("hex");}
export function validateStepAttachmentSet(items:readonly {sizeBytes:number}[]){if(items.length>MAX_STEP_ATTACHMENTS)return "ATTACHMENT_COUNT_LIMIT" as const;return items.reduce((n,x)=>n+x.sizeBytes,0)>MAX_STEP_ATTACHMENT_BYTES?"ATTACHMENT_SIZE_LIMIT" as const:null;}
