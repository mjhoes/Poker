import { useEffect, useState } from "react";
import type { WalletLedger } from "@perfect-draw/shared";
import { walletService } from "../services/wallets";
import { toast } from "../components/Toasts";
import { errorMessage } from "./useActionRunner";

/** Ledger rows for the selected wallet, refreshed whenever balances or decisions change. */
export function useWalletLedger(walletId: string, refreshKeys: readonly unknown[]) {
  const [ledger, setLedger] = useState<WalletLedger[]>([]);
  useEffect(() => {
    if (!walletId) { setLedger([]); return; }
    let cancelled = false;
    walletService.ledger(walletId)
      .then(rows => { if (!cancelled) setLedger(rows); })
      .catch(reason => { if (!cancelled) toast.error(errorMessage(reason)); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId, ...refreshKeys]);
  return ledger;
}
