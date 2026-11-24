import { useCallback, useEffect, useState } from "react";
import { clearToasts } from "../components/Toasts";

export const ROUTES = ["/", "/wallets", "/settings", "/session", "/stats"] as const;
export type Route = typeof ROUTES[number];

const parse = (hash: string): Route => {
  const next = hash.slice(1) || "/";
  return (ROUTES as readonly string[]).includes(next) ? next as Route : "/";
};

/** Hash routing. Leaving a page clears its error toasts, which no longer apply. */
export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const sync = () => { setRoute(parse(window.location.hash)); clearToasts("error"); };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = useCallback((next: Route) => { window.location.hash = next; }, []);
  return { route, navigate };
}
