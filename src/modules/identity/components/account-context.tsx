"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountContext } from "@/types/account";

const AccountContextValue = createContext<AccountContext | null>(null);

export function AccountProvider({ account, children }: { account: AccountContext; children: ReactNode }) {
  return <AccountContextValue.Provider value={account}>{children}</AccountContextValue.Provider>;
}

export function useAccount() {
  const account = useContext(AccountContextValue);

  if (!account) {
    throw new Error("useAccount must be used inside AccountProvider");
  }

  return account;
}
