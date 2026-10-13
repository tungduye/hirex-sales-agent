export function zaloContactDisplayName(externalId: string, providerName: string | null): string {
  return providerName?.trim() || `Zalo ${externalId}`;
}

export function mayUpgradeZaloContactName(current: string | null | undefined, externalId: string): boolean {
  return current === "Zalo contact" || current === `Zalo ${externalId}`;
}

export function mayUpgradeZaloAccountName(current: string | null | undefined, accountZaloId: string): boolean {
  const normalized = current?.trim().toLowerCase();
  return current === null || normalized === "hirex qa zalo" || normalized === "zalo account" ||
    normalized === `zalo ${accountZaloId}`.toLowerCase();
}
