import env from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { createCipheriv, randomBytes, createHmac } from 'node:crypto';
env.loadEnvConfig(process.cwd());
const secret = process.env.HIREX_FACEBOOK_PROFILE_BRIDGE_SECRET;
const key = Buffer.from(process.env.CHANNEL_TOKEN_ENCRYPTION_KEY || '', 'base64');
if (!secret || secret.length < 32 || key.length !== 32) throw Error('BRIDGE_CONFIGURATION_MISSING');
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const workspace = 'da7cef02-036a-4ee9-b3d7-5c7df54c73a0';
const result = await client.from('channel_accounts').select('id,workspace_id,connected_by,external_account_id,display_name,deleted_at,operator_enabled')
  .eq('workspace_id', workspace).eq('channel_type', 'FACEBOOK_PROFILE').eq('provider', 'FACEBOOK_PROFILE_BRIDGE')
  .in('external_account_id', ['61586595958719', '61589876247001']);
if (result.error || result.data?.length !== 2) throw Error('ACCOUNT_MAPPING_INVALID');
for (const account of result.data) {
  if (account.deleted_at || account.operator_enabled === false) throw Error('ACCOUNT_DISABLED');
  const path = `/v1/accounts/${account.external_account_id}/health`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`GET\n${path}\n${timestamp}\n\n`).digest('hex');
  const response = await fetch(`http://127.0.0.1:18791${path}`, { headers: { 'x-hirex-timestamp': timestamp, 'x-hirex-signature': signature }, signal: AbortSignal.timeout(10000) });
  const health = response.ok ? (await response.json()).status : `HTTP_${response.status}`;
  if (health !== 'HEALTHY') {
    console.log(JSON.stringify({ name: account.display_name, health, sendEnabled: false }));
    process.exitCode = 1;
    continue;
  }
  if (process.argv.includes('--apply')) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const encrypted = ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
    const saved = await client.rpc('upsert_channel_account_credential', { p_workspace_id: workspace, p_connected_by: account.connected_by,
      p_channel_type: 'FACEBOOK_PROFILE', p_provider: 'FACEBOOK_PROFILE_BRIDGE', p_external_account_id: account.external_account_id,
      p_display_name: account.display_name, p_capabilities: ['SEND_TEXT', 'REPLY'], p_access_token_encrypted: null,
      p_webhook_secret_encrypted: encrypted, p_configuration: { bridgeBaseUrl: 'http://127.0.0.1:18791' } });
    if (saved.error || saved.data !== account.id) throw Error('ACCOUNT_CONFIGURATION_FAILED');
  }
  console.log(JSON.stringify({ name: account.display_name, health: 'HEALTHY', sendEnabled: process.argv.includes('--apply') }));
}
