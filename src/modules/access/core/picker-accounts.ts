// Accounts as the account picker shows them (Vai trò và phân quyền). Pure; covered by tests/account-picker.test.mjs.
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export type PickerAccount = { id: string; channel: string; name: string; owner?: string | null; free?: boolean; detail?: string | null; needsReconnect?: boolean };

/**
 * Accounts as the picker shows them. Two accounts with the same name (two Gmail boxes both called "Mai Ngọc") also
 * show their address, so they can be told apart; an account that needs reconnecting says so.
 */
export function toPickerAccounts(rows: Array<{ id: string; channel_type: string; display_name: string | null; external_account_id: string; status?: string | null; primary_profile_id?: string | null }>,
  owner: (row: { primary_profile_id?: string | null }) => { owner?: string | null; free?: boolean } = () => ({})): PickerAccount[] {
  const key = (row: (typeof rows)[number]) => `${row.channel_type}|${fold((row.display_name || row.external_account_id).trim())}`;
  const seen = new Map<string, number>(); for (const row of rows) seen.set(key(row), (seen.get(key(row)) ?? 0) + 1);
  return rows.map((row) => ({ id: row.id, channel: row.channel_type, name: row.display_name || row.external_account_id,
    detail: (seen.get(key(row)) ?? 0) > 1 && row.display_name ? row.external_account_id : null,
    needsReconnect: Boolean(row.status) && row.status !== "CONNECTED", ...owner(row) }));
}

