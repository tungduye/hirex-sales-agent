import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/modules/channels/server/channel-actions.ts', import.meta.url), 'utf8');
const section = (name) => source.slice(source.indexOf(`export async function ${name}(`), source.indexOf('\nexport async function', source.indexOf(`export async function ${name}(`) + 10));

const adapter = readFileSync(new URL('../src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts', import.meta.url), 'utf8');
const executor = readFileSync(new URL('../src/modules/channels/server/execute-channel-outbound-action.ts', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/modules/channels/core/execute-outbound-action.ts', import.meta.url), 'utf8');

test('Zalo group replies go through the normal send path (no more temporary block)', () => {
  assert.doesNotMatch(source, /isZaloGroupConversation|ZALO_GROUP_UNSUPPORTED/);
});

test('the bridge request marks a group and only for a manual reply addressed to the group', () => {
  assert.match(adapter, /const group = command\.threadKind === "GROUP";/);
  assert.match(adapter, /command\.source !== "HUMAN_MANUAL" \|\| !command\.providerConversationId \|\| command\.recipientExternalId !== command\.providerConversationId/);
  assert.match(adapter, /\.\.\.\(group \? \{ threadType: "GROUP" \} : \{\}\)/);
});

test('group-ness comes from the shared database rule and an unknown answer stops the send', () => {
  assert.match(executor, /rpc\("is_zalo_group_conversation", \{ p_conversation_id: row\.conversation_id \}\)/);
  assert.match(executor, /if \(groupError \|\| typeof group !== "boolean"\) return null;/);
  assert.match(core, /claimed\.threadKind === "GROUP" \? \{ threadKind: "GROUP" as const \} : \{\}/);
});

test('cancelling a pending message only touches never-attempted approved actions', () => {
  const cancel = section('cancelPendingManualChannelMessage');
  assert.match(cancel, /hasPermission\("inbox\.reply"\)/);
  assert.match(cancel, /canAccessChannelAccount/);
  assert.match(cancel, /\.eq\("status", "APPROVED"\)\.eq\("attempt_count", 0\)/);
  assert.match(cancel, /status: "CANCELLED"/);
});

test('Zalo system notices do not make a one-to-one chat a group', async () => {
  const { isZaloGroupThread } = await import('../src/modules/assistant/core/assistant-tools.ts');
  assert.equal(isZaloGroupThread('ZALO', '9187084085466763670', 'system'), false);
  assert.equal(isZaloGroupThread('ZALO', '9187084085466763670', '9187084085466763670'), false);
  assert.equal(isZaloGroupThread('ZALO', 'group-1', 'member-9'), true);
});

test('history-synced groups (conversationKind GROUP) count as groups', async () => {
  const { isGroupConversation } = await import('../src/modules/assistant/core/assistant-tools.ts');
  assert.equal(isGroupConversation({ conversationKind: 'GROUP' }), true);
  assert.equal(isGroupConversation({ conversationKind: 'USER' }), false);
});

test('the inbox lists a shared group once and lets the member pick the sending nick', () => {
  const loader = readFileSync(new URL('../src/modules/inbox/server/get-omnichannel-inbox-data.ts', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../src/modules/inbox/server/get-omnichannel-conversation-detail.ts', import.meta.url), 'utf8');
  const list = readFileSync(new URL('../src/modules/inbox/components/infinite-conversation-list.tsx', import.meta.url), 'utf8');
  assert.match(loader, /rpc\("get_inbox_last_outbound_at"/);
  assert.match(loader, /mergeGroupCopies\(conversations, lastOutboundAt, ambiguous\)/);
  assert.match(detail, /rpc\("is_zalo_group_conversation"/);
  assert.match(detail, /await canAccessChannelAccount\(accountId\)/, 'only nicks the member may use');
  assert.match(list, /conversation\.copyIds\.map\(\(id\)=>fetch\(`\/api\/inbox\/conversations\/\$\{id\}\/preferences`/, 'menu actions reach every copy');
});

test('expired Facebook Page chats offer the chat in Meta Business Suite', () => {
  const detail = readFileSync(new URL('../src/modules/inbox/server/get-omnichannel-conversation-detail.ts', import.meta.url), 'utf8');
  const composer = readFileSync(new URL('../src/modules/channels/components/conversation-composer.tsx', import.meta.url), 'utf8');
  assert.match(detail, /businessSuiteUrl: channelType === "FACEBOOK" \? businessSuiteInboxUrl\(text\(channelAccount\.external_account_id\)\) : null/);
  assert.match(composer, /\{businessSuiteUrl\?<a href=\{businessSuiteUrl\} target="_blank" rel="noopener noreferrer"/);
});
