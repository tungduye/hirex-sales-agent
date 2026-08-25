import { AlertTriangle } from "lucide-react";

export function AccountSetupRequired() {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><AlertTriangle className="size-7" /></div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600">Account setup required</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Your account configuration is incomplete</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">Your authentication is valid, but the linked profile or workspace could not be loaded. Ask a workspace administrator to complete the account setup.</p>
      </div>
    </div>
  );
}
