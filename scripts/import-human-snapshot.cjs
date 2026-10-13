// Offline, explicitly scoped import. Does not connect to Human or send documents to AI.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const [source, workspace] = process.argv.slice(2);
if (!source || !/^[0-9a-f-]{36}$/i.test(workspace || '')) throw Error('SOURCE_AND_WORKSPACE_REQUIRED');
const raw = fs.readFileSync(source, 'utf8');
const input = JSON.parse(raw);
const rows = Array.isArray(input) ? input : input.data;
if (!Array.isArray(rows) || !rows.length || rows.length > 20000) throw Error('INVALID_DOCUMENT_LIST');
const ids = new Set();
const documents = rows.map(row => {
  if (!Number.isSafeInteger(row.docId) || row.docId <= 0 || ids.has(row.docId) || typeof row.docName !== 'string' || !row.docName.trim() || (row.status != null && typeof row.status !== 'string')) throw Error('INVALID_OR_DUPLICATE_DOCUMENT');
  ids.add(row.docId);
  return { id: row.docId, name: row.docName, group: String(row.groupDocument ?? row.groupName ?? 'Chưa phân nhóm'), status: row.status ?? '' };
});
const snapshot = { importedAt: new Date().toISOString(), sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'), documents };
const key = Buffer.from(process.env.EMAIL_TOKEN_ENCRYPTION_KEY || '', 'base64');
if (key.length !== 32) throw Error('ENCRYPTION_KEY_REQUIRED');
const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const body = Buffer.concat([cipher.update(JSON.stringify(snapshot),'utf8'), cipher.final()]);
const encrypted = ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),body.toString('base64')].join(':');
const folder = path.join(process.cwd(),'runtime','human-documents');
fs.mkdirSync(folder,{recursive:true,mode:0o700});
const target = path.join(folder,workspace+'.enc');
if (fs.existsSync(target)) throw Error('SNAPSHOT_ALREADY_EXISTS_BACKUP_REQUIRED');
fs.writeFileSync(target,encrypted,{flag:'wx',mode:0o600});
console.log(JSON.stringify({documents:documents.length,withStatus:documents.filter(d=>d.status.trim()).length,importedAt:snapshot.importedAt,sha256:snapshot.sourceSha256}));
