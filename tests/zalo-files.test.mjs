import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFileSize, isZaloImage, MAX_ZALO_FILE_BYTES, zaloContentType, zaloFileName, zaloFileProblem } from '../src/modules/channels/core/zalo-files.ts';
import { isSendMessageCommand } from '../src/modules/channels/core/channel-contracts.ts';
import { executeOutboundAction } from '../src/modules/channels/core/execute-outbound-action.ts';

test('file names stay readable, never a path, and keep their extension', () => {
  assert.equal(zaloFileName('CV Nguyễn Văn A.pdf'), 'CV Nguyễn Văn A.pdf');
  assert.equal(zaloFileName('../../secret/a.docx'), '_.._secret_a.docx');
  assert.equal(zaloFileName('  ảnh\u0007 chụp.PNG  '), 'ảnh chụp.PNG');
  assert.equal(zaloFileName('no-extension'), null);
  assert.equal(zaloFileName('.pdf'), null);
  const long = zaloFileName(`${'a'.repeat(400)}.xlsx`);
  assert.equal(long.length, 200); assert.ok(long.endsWith('.xlsx'));
});
test('files that cannot be sent are explained', () => {
  assert.equal(zaloFileProblem({ name: 'a.pdf', size: 10 }), null);
  assert.equal(zaloFileProblem({ name: 'a.pdf', size: 0 }), 'EMPTY');
  assert.equal(zaloFileProblem({ name: 'a.pdf', size: MAX_ZALO_FILE_BYTES + 1 }), 'TOO_LARGE');
  assert.equal(zaloFileProblem({ name: 'a.pdf', size: MAX_ZALO_FILE_BYTES }), null);
  assert.equal(zaloFileProblem({ name: 'setup.EXE', size: 10 }), 'BLOCKED_TYPE');
  assert.equal(zaloFileProblem({ name: 'run.bat', size: 10 }), 'BLOCKED_TYPE');
  assert.equal(zaloFileProblem({ name: 'README', size: 10 }), 'NAME');
});
test('content types come from the browser when sensible, otherwise from the extension', () => {
  assert.equal(zaloContentType('a.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(zaloContentType('a.docx', ''), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(zaloContentType('a.jpg', 'application/octet-stream'), 'image/jpeg');
  assert.equal(zaloContentType('a.weird', 'not a type'), 'application/octet-stream');
  assert.equal(zaloContentType('a.png', 'IMAGE/PNG; charset=x'), 'image/png');
  assert.equal(isZaloImage('a.png', 'image/png'), true);
  assert.equal(isZaloImage('a.heic', 'image/heic'), false);
  assert.equal(isZaloImage('a.pdf', 'application/pdf'), false);
  assert.equal(formatFileSize(500), '500 B'); assert.equal(formatFileSize(2048), '2 KB'); assert.equal(formatFileSize(3.5 * 1024 * 1024), '3.5 MB');
});

const sha = 'a'.repeat(64);
const signedUrl = 'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/sign/channel-attachments/w/outbound/f.pdf?token=eyJhbGciOiJIUzI1NiJ9.e30.sig';
const command = { actionId: 'a1', workspaceId: 'w1', channelAccountId: 'c1', channelType: 'ZALO', providerConversationId: 't1', recipientExternalId: 't1',
  text: null, attachments: [{ id: 'f1', filename: 'CV.pdf', contentType: 'application/pdf', sizeBytes: 10, sha256: sha, signedUrl }], idempotencyKey: 'k1', policyDecisionId: 'p1', source: 'HUMAN_MANUAL' };
test('a send command carries a file either as bytes or as a signed link, never both', () => {
  assert.equal(isSendMessageCommand(command), true);
  assert.equal(isSendMessageCommand({ ...command, attachments: [{ ...command.attachments[0], signedUrl: undefined, contentBase64: 'aGk=' }] }), true);
  assert.equal(isSendMessageCommand({ ...command, attachments: [{ ...command.attachments[0], contentBase64: 'aGk=' }] }), false);
  assert.equal(isSendMessageCommand({ ...command, attachments: [{ ...command.attachments[0], signedUrl: 'http://x/y' }] }), false);
  assert.equal(isSendMessageCommand({ ...command, attachments: [{ ...command.attachments[0], signedUrl: undefined }] }), false);
  assert.equal(isSendMessageCommand({ ...command, attachments: [] }), false);
});
test('the executor asks for the files knowing the channel, so Zalo gets signed links', async () => {
  const now = new Date().toISOString();
  const action = { id: 'a1', workspaceId: 'w1', conversationId: null, providerConversationId: 't1', channelAccountId: 'c1', channelType: 'ZALO', recipientExternalId: 't1',
    status: 'APPROVED', textContent: null, attachmentIds: ['f1'], idempotencyKey: 'k1', policyDecisionId: 'p1', approvedBy: 'u1', approvedAt: now, dispatchSource: 'HUMAN_MANUAL' };
  let asked, sent;
  const result = await executeOutboundAction('a1', {
    loadAction: async () => action, loadPolicy: async () => ({ id: 'p1', workspaceId: 'w1', allowed: true, expiresAt: new Date(Date.now() + 60000).toISOString() }),
    isSuppressed: async () => false, claim: async (input) => ({ ...action, status: 'EXECUTING', executionLockId: input.executionLockId }),
    loadClaimedAttachments: async (input) => { asked = input; return command.attachments; },
    validatePreSend: async () => ({ allowed: true, safeErrorCode: '' }),
    finalizeSent: async () => true, finalizeFailed: async () => true, finalizeUnknown: async () => true, deferConfirmedBusy: async () => true,
    adapters: { get: () => ({ sendMessage: async (value) => { sent = value; return { providerMessageId: 'm1', providerConversationId: 't1', acceptedAt: now }; } }) },
    createLockId: () => 'lock', now: () => now,
  });
  assert.equal(result.status, 'SENT');
  assert.equal(asked.channelType, 'ZALO');
  assert.equal(sent.attachments[0].signedUrl, signedUrl);
  assert.equal(sent.text, null);
});
