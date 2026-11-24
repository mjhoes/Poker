import { useEffect, useState } from "react";
import type { Session } from "@perfect-draw/shared";
import { engineClient } from "../worker/client";
import type { AnalysisSummary } from "../worker/engine-api";
import { errorMessage } from "./useActionRunner";

/** Optional pay-table analysis for the session room. Loads only when requested, and resets when the table changes. */
export function useTableAnalysis(session: Session | undefined, inRoom: boolean) {
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const paytableId = session?.machineSnapshot.paytableId;

  useEffect(() => {
    setAnalysis(null); setError(""); setLoading(false); setRequested(false);
  }, [inRoom, session?.id, paytableId]);

  useEffect(() => {
    if (!inRoom || !session || session.status === "closed" || !requested || !paytableId) return;
    let cancelled = false;
    setError(""); setLoading(true);
    Promise.resolve().then(() => engineClient().loadAnalysis(paytableId))
      .then(result => { if (!cancelled) setAnalysis(result); })
      .catch(reason => { if (!cancelled) setError(errorMessage(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // The session object changes on every play action; only its identity, status and table matter here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, session?.id, paytableId, requested, attempt]);

  return { analysis, error, loading, request: () => { setRequested(true); setAttempt(value => value + 1); } };
}
