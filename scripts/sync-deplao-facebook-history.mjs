import env from '@next/env';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import { stableUuid } from './lib/zalo-history-remote-writer.mjs';

// Import only local, already received/sent text. No Facebook sends or AI jobs.
env.loadEnvConfig(process.cwd());
const apply = process.argv.includes('--apply');
const workspace = 'da7cef02-036a-4ee9-b3d7-5c7df54c73a0';
const owner = '1da75536-6742-4e3c-bced-c8baf4bf7fff';
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) } });
const local = new DatabaseSync('C:/Users/Admin/AppData/Local/HireX/ZaloRuntime/deplao-qa-profile/deplao-tool.db', { readOnly: true });
async function checked(query) { const r = await query; if (r.error) throw new Error(`SYNC_DB_${r.error.code || 'FAILED'}`); return r.data; }
try {
  const summary = { mode: apply ? 'apply' : 'preview', accounts: 0, conversations: 0, messages: 0, skipped: 0 };
  // Discover connected accounts from this designated Deplao profile on every run.
  // Never read login credentials or reactivate accounts disabled on HireX.
  const accounts = local.prepare("SELECT id,facebook_id,name,status FROM fb_accounts WHERE status='connected' ORDER BY facebook_id").all();
  for (const account of accounts) {
    const uid = account.facebook_id;
    if (typeof uid !== 'string' || !/^\d{5,32}$/.test(uid)) { summary.skipped++; continue; }
    let remote = await checked(client.from('channel_accounts').select('id,deleted_at,operator_enabled').eq('workspace_id', workspace)
      .eq('channel_type', 'FACEBOOK_PROFILE').eq('provider', 'FACEBOOK_PROFILE_BRIDGE').eq('external_account_id', uid).maybeSingle());
    if (remote?.deleted_at || remote?.operator_enabled === false) { summary.skipped++; continue; }
    const accountId = remote?.id || stableUuid(`deplao-facebook:account:${workspace}:${uid}`);
    if (apply && !remote) await checked(client.from('channel_accounts').insert({ id: accountId, workspace_id: workspace, connected_by: owner,
      external_account_id: uid, display_name: account.name, channel_type: 'FACEBOOK_PROFILE', provider: 'FACEBOOK_PROFILE_BRIDGE',
      status: 'CONNECTED', capabilities: [], metadata: { syncSource: 'deplao-history', syncOnly: true } }));
    summary.accounts++;
    const messages = local.prepare("SELECT id,thread_id,sender_id,body,timestamp,is_self FROM fb_messages WHERE account_id=? AND type='text' AND is_unsent=0 ORDER BY timestamp,id").all(account.id);
    const conversations = new Map();
    for (const message of messages) {
      const self = message.is_self === 1;
      if (!message.body || !/^\d+$/.test(message.thread_id) ||
          (self ? message.sender_id !== uid : message.sender_id !== message.thread_id)) { summary.skipped++; continue; }
      const occurred = new Date(message.timestamp).toISOString();
      let conversation = conversations.get(message.thread_id);
      if (!conversation) {
        conversation = await checked(client.from('omnichannel_conversations').select('id,last_message_at').eq('workspace_id', workspace)
          .eq('channel_account_id', accountId).eq('provider_conversation_id', message.thread_id).maybeSingle());
        if (!conversation) {
          const id = stableUuid(`deplao-facebook:conversation:${accountId}:${message.thread_id}`);
          const contactId = stableUuid(`deplao-facebook:contact:${accountId}:${message.thread_id}`);
          const contact = local.prepare("SELECT display_name FROM contacts WHERE owner_zalo_id=? AND contact_id=? AND channel='facebook'").get(uid, message.thread_id);
          const name = contact?.display_name || `Facebook ${message.thread_id}`;
          if (apply) {
            await checked(client.from('contacts').upsert({ id: contactId, workspace_id: workspace, full_name: name, source: 'FACEBOOK_PROFILE' }, { onConflict: 'id', ignoreDuplicates: true }));
            await checked(client.from('contact_channels').upsert({ id: stableUuid(`deplao-facebook:contact-channel:${contactId}`), workspace_id: workspace,
              contact_id: contactId, channel_type: 'FACEBOOK_PROFILE', channel_value: message.thread_id, is_primary: true,
              metadata: { channelAccountId: accountId } }, { onConflict: 'id', ignoreDuplicates: true }));
            await checked(client.from('omnichannel_conversations').insert({ id, workspace_id: workspace, channel_account_id: accountId,
              channel_type: 'FACEBOOK_PROFILE', provider_conversation_id: message.thread_id, contact_id: contactId,
              takeover_mode: 'HUMAN_TAKEOVER', last_message_at: occurred,
              metadata: { participantExternalId: message.thread_id, participantDisplayName: name, syncSource: 'deplao-history' } }));
          }
          conversation = { id, last_message_at: occurred };
        }
        conversations.set(message.thread_id, conversation); summary.conversations++;
      }
      if (apply) {
        await checked(client.from('omnichannel_messages').upsert({ id: stableUuid(`deplao-facebook:message:${accountId}:${message.id}`),
          workspace_id: workspace, channel_account_id: accountId, conversation_id: conversation.id, channel_type: 'FACEBOOK_PROFILE',
          provider_message_id: message.id, direction: self ? 'OUTBOUND' : 'INBOUND', sender_external_id: message.sender_id,
          recipient_external_ids: [self ? message.thread_id : uid], text_content: message.body, attachment_count: 0,
          ...(self ? { sent_at: occurred } : { received_at: occurred }), metadata: { syncSource: 'deplao-history', historical: true } },
          { onConflict: 'workspace_id,channel_account_id,provider_message_id', ignoreDuplicates: true }));
        if (!conversation.last_message_at || Date.parse(occurred) > Date.parse(conversation.last_message_at)) {
          await checked(client.from('omnichannel_conversations').update({ last_message_at: occurred }).eq('id', conversation.id).eq('workspace_id', workspace));
          conversation.last_message_at = occurred;
        }
      }
      summary.messages++;
    }
  }
  console.log(JSON.stringify(summary));
} catch (error) { console.error(/^SYNC_DB_[A-Z0-9_]+$/.test(error.message) ? error.message : 'FACEBOOK_HISTORY_SYNC_FAILED'); process.exitCode = 1; }
finally { local.close(); }
