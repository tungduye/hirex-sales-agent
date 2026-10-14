import env from '@next/env';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HUMAN_DOCUMENT_URL, HUMAN_FOLDER_URL, HUMAN_DOCUMENT_FILTER, parseHumanSnapshot, parseHumanFolders } from '../src/modules/human-documents/core/api-snapshot.ts';
env.loadEnvConfig(process.cwd());
const workspace = process.argv[2];
if (!/^[a-z0-9-]{36}$/.test(workspace || '')) throw Error('WORKSPACE_REQUIRED');
const file = `runtime/human-documents/${workspace}.enc`;
const key = Buffer.from(process.env.EMAIL_TOKEN_ENCRYPTION_KEY || '', 'base64');
function decrypt(raw) { const [,iv,tag,body] = raw.split(':'); const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(body,'base64')),cipher.final()]).toString(); }
const token=decrypt(await readFile(`runtime/human-documents/${workspace}.api-token.enc`,'utf8'));
async function request(url,options={}) { const r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(60000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});if(!r.ok)throw Error('HUMAN_FETCH_FAILED');return r.json(); }
const folders=parseHumanFolders(await request(HUMAN_FOLDER_URL));
const documents=parseHumanSnapshot(await request(HUMAN_DOCUMENT_URL,{method:'POST',body:JSON.stringify(HUMAN_DOCUMENT_FILTER)})).map(doc=>{
  const folderPath=folders.paths.get(doc.groupId);if(!folderPath)throw Error('FOLDER_MISSING');return {...doc,group:folderPath.at(-1),folderPath};
});
const snapshot={importedAt:new Date().toISOString(),documents,folderPaths:folders.order.map(id=>folders.paths.get(id))};
const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(snapshot)),cipher.final()]);
const encrypted=['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join(':');
await writeFile(`${file}.before-tree-api`,await readFile(file),{flag:'wx',mode:0o600});
await writeFile(`${file}.tree.tmp`,encrypted,{flag:'wx',mode:0o600});await rename(`${file}.tree.tmp`,file);
console.log(JSON.stringify({documents:documents.length,folders:folders.paths.size,unmapped:0}));
