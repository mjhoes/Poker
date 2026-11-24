import { useEffect, useState } from "react";
import type { Session } from "@perfect-draw/shared";
import { engineClient } from "../worker/client";
import type { TableSummary } from "../worker/engine-api";
import { errorMessage } from "./useActionRunner";

/**
 * Return, variance and hit frequency for the session's table at the bet being played. Built-in tables at max bet read
 * the small summary file; anything else is computed exactly once on this device and saved. Loads only when requested.
 */
export function useTableAnalysis(session: Session | undefined, inRoom: boolean, coins: number | undefined) {
  const [analysis, setAnalysis] = useState<TableSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const paytableId = session?.machineSnapshot.paytableId;

  useEffect(() => { setAnalysis(null); setError(""); setLoading(false); }, [inRoom, session?.id, paytableId, coins]);
  useEffect(() => { setRequested(false); }, [inRoom, session?.id, paytableId]);

  useEffect(() => {
    if (!inRoom || !session || !requested || !paytableId || !coins) return;
    let cancelled = false;
    setError(""); setLoading(true);
    Promise.resolve().then(() => engineClient().tableSummary(paytableId, coins))
      .then(result => { if (!cancelled) setAnalysis(result); })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // The session object changes on every play action; only its identity, table and bet matter here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, session?.id, paytableId, coins, requested, attempt]);

  return { analysis, error, loading, request: () => { setRequested(true); setAttempt(value => value + 1); } };
}
