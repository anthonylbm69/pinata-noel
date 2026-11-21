"use client";
// Synchronise l'état de la partie :
//  1. Realtime Supabase sur la ligne "games" → rechargement immédiat ;
//  2. filet de sécurité : rechargement toutes les 4 s, au retour au premier
//     plan (téléphone déverrouillé) et au retour du réseau.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { GameState } from "@/lib/types";

export type Auth =
  | { role: "host"; token: string }
  | { role: "player"; playerId: string; token: string };

export function useGameState(code: string, auth: Auth | null) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [live, setLive] = useState(false);
  const offsetRef = useRef(0); // serverNow - Date.now()
  const inflight = useRef(false);
  const queued = useRef(false);

  const authKey = auth ? JSON.stringify(auth) : "";

  const refresh = useCallback(async () => {
    if (!auth) return;
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    try {
      const params = new URLSearchParams(
        auth.role === "host" ? { host: auth.token } : { player: auth.playerId, token: auth.token },
      );
      const t0 = Date.now();
      const res = await fetchWithTimeout(`/api/games/${code}/state?${params}`, { cache: "no-store" }, 8000);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ status: res.status, message: body.error ?? "Erreur" });
        return;
      }
      const t1 = Date.now();
      offsetRef.current = body.serverNow - (t0 + t1) / 2;
      setError(null);
      setState((prev) => (prev && prev.game.version > body.game.version ? prev : body));
    } catch {
      setError({ status: 0, message: "Connexion perdue, on réessaie…" });
    } finally {
      inflight.current = false;
      if (queued.current) {
        queued.current = false;
        void refresh();
      }
    }
    // authKey résume auth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authKey]);

  useEffect(() => {
    if (!auth) return;
    void refresh();

    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = sb
      ?.channel(`game-${code}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `code=eq.${code}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void refresh(), 80);
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    const poll = setInterval(() => void refresh(), 4000);
    const onWake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      if (channel) void sb?.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authKey, refresh]);

  /** Heure actuelle du serveur (estimée), pour le chrono. */
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { state, error, live, refresh, serverNow };
}

/** Millisecondes restantes sur la question en cours, mis à jour ~10 fois/s. */
export function useRemaining(state: GameState | null, serverNow: () => number) {
  // On mémorise à quelle question appartient la valeur : sinon, au passage à la
  // question suivante, le « 0 » de la question précédente (finie au chrono)
  // ressortait une fraction de seconde et la télé refermait la nouvelle question.
  const [tick, setTick] = useState<{ key: string; ms: number } | null>(null);
  // Chrono des questions, et aussi de l'écran mémoire (intro avec durée d'affichage).
  const phase = state?.game.phase;
  const limit = state?.game.timeLimitMs ?? 0;
  const timed = phase === "question" || (phase === "intro" && limit > 0);
  const openedAt = timed ? (state?.game.openedAt ?? null) : null;
  const key = openedAt ? `${phase}|${openedAt}|${limit}` : null;
  useEffect(() => {
    if (!openedAt || !key) return;
    const end = new Date(openedAt).getTime() + limit;
    const update = () => setTick({ key, ms: Math.max(0, end - serverNow()) });
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [openedAt, limit, key, serverNow]);
  return key && tick?.key === key ? tick.ms : null;
}

/** fetch qui abandonne au bout de `ms` (4G capricieuse : on ne reste pas bloqué). */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      10000,
    );
  } catch {
    throw new Error("Connexion perdue, réessaie");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? (res.status >= 500 ? "Le serveur a un souci, réessaie" : "Erreur"));
  return data as T;
}
