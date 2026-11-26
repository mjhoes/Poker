import { useCallback, useEffect, useRef, useState } from "react";
import { clearToasts } from "../components/Toasts";

export const ROUTES = ["/", "/wallets", "/settings", "/session", "/analyze", "/stats", "/cruise", "/train", "/heuristics"] as const;
export type Route = typeof ROUTES[number];

/** `#/analyze?hand=…` → route "/analyze" and search "hand=…". Unknown routes go home. */
export function parseHash(hash: string): { route: Route; search: string } {
  const [path, ...rest] = (hash.slice(1) || "/").split("?");
  const route = (ROUTES as readonly string[]).includes(path) ? path as Route : "/";
  return { route, search: route === "/" && path !== "/" ? "" : rest.join("?") };
}

/** Hash routing. Leaving a page clears its error toasts, which no longer apply; a change of search alone does not. */
export function useRoute() {
  const [location, setLocation] = useState(() => parseHash(window.location.hash));
  // Cleared after the route changes, never inside the state update: React runs updaters while rendering, and the
  // toast list would then change during App's render.
  const shown = useRef(location.route);
  useEffect(() => {
    if (shown.current !== location.route) clearToasts("error");
    shown.current = location.route;
  }, [location.route]);
  useEffect(() => {
    const sync = () => {
      const next = parseHash(window.location.hash);
      setLocation(previous => next.route === previous.route && next.search === previous.search ? previous : next);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = useCallback((next: Route, search?: string) => { window.location.hash = search ? `${next}?${search}` : next; }, []);
  /** Updates the address without adding a history entry (for state such as the analyzer's current hand). */
  const replaceSearch = useCallback((search: string) => {
    const { route } = parseHash(window.location.hash);
    const hash = search ? `#${route}?${search}` : `#${route}`;
    if (window.location.hash === hash) return;
    history.replaceState(history.state, "", hash);
    setLocation({ route, search });
  }, []);
  return { route: location.route, search: location.search, navigate, replaceSearch };
}
