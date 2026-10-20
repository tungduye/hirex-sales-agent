import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { VersionCache } from '../src/modules/human-documents/core/version-cache.ts';
test('snapshot authorizes every cache hit and invalidates updated/deleted files', async () => {
  let denied = false, version = 1, reads = 0, workspaceId = 'A', deleted = false;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/modules/human-documents/server/snapshot.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, process: { cwd: () => '/test' }, require: name => {
    if (name === 'server-only') return {};
    if (name === 'node:path') return path;
    if (name === 'node:fs/promises') return { stat: async () => { if (deleted) throw Object.assign(Error(), { code: 'ENOENT' }); return { ino: 1, size: 100, mtimeMs: version, ctimeMs: version }; }, readFile: async () => { reads++; return JSON.stringify({ importedAt: String(version), documents: [] }); } };
    if (name.includes('access-control')) return { requireDocumentReader: async () => { if (denied) throw Error('FORBIDDEN'); return { workspaceId }; } };
    if (name.includes('credential-encryption')) return { decryptCredential: text => text };
    if (name.includes('version-cache')) return { VersionCache };
    return {};
  } });
  const load = exports.loadHumanSnapshot;
  await load(); await load(); assert.equal(reads, 1);
  denied = true; await assert.rejects(load(), /FORBIDDEN/); assert.equal(reads, 1);
  denied = false; workspaceId = 'B'; await load(); assert.equal(reads, 2);
  workspaceId = 'A'; version = 2; assert.equal((await load()).importedAt, '2'); assert.equal(reads, 3);
  deleted = true; assert.equal(await load(), null);
  deleted = false; await load(); assert.equal(reads, 4);
});
