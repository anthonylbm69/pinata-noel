"use client";
// Téléphone pendant la partie : attente, répondre, réponse envoyée, résultat, classement.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ANSWER_STYLES, Avatar, Shape, formatPoints } from "@/components/ui";
import { playerStore, type PlayerAuth } from "@/lib/storage";
import { postJson, useGameState, useRemaining, type Auth } from "@/hooks/useGameState";

export default function PlayerGame({ code }: { code: string }) {
  const router = useRouter();
  const [auth, setAuth] = useState<PlayerAuth | null>(null);

  useEffect(() => {
    const a = playerStore.get(code);
    if (!a) router.replace(`/play?code=${code}`);
    else setAuth(a);
  }, [code, router]);

  const hookAuth: Auth | null = useMemo(
    () => (auth ? { role: "player", playerId: auth.playerId, token: auth.token } : null),
    [auth],
  );
  const { state, error, refresh, serverNow } = useGameState(code, hookAuth);
  const remaining = useRemaining(state, serverNow);

  // Joueur supprimé / partie introuvable → retour à l'inscription.
  useEffect(() => {
    if (error && (error.status === 401 || error.status === 404)) {
      playerStore.clear(code);
      router.replace(`/play?code=${code}`);
    }
  }, [error, code, router]);

  const [sending, setSending] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const qi = state?.question?.index ?? -1;
  useEffect(() => {
    setSending(null);
    setSendError(null);
  }, [qi, state?.game.phase]);

  async function answer(choice: number) {
    if (!auth || sending !== null) return;
    setSending(choice);
    setSendError(null);
    try {
      await postJson(`/api/games/${code}/answer`, {
        playerId: auth.playerId,
        token: auth.token,
        questionIndex: qi,
        choice,
      });
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      void refresh();
    }
  }

  if (!auth || !state) {
    return <Center>{error && error.status === 0 ? error.message : "Connexion…"}</Center>;
  }

  const { game, me } = state;
  const header = (
    <header className="flex items-center gap-3">
      <Avatar color={auth.color} />
      <span className="text-xl font-semibold">{auth.name}</span>
      <span className="flex-1" />
      {me && game.phase !== "lobby" && (
        <span className="text-xgold rounded-full bg-white/10 px-3 py-1 text-sm font-semibold">
          {formatPoints(me.total)} pts
        </span>
      )}
    </header>
  );

  // ---- Lobby ----
  if (game.phase === "lobby") {
    return (
      <Shell header={header}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="animate-pop border-xgold rounded-full border-[6px]" style={{ background: auth.color, width: 140, height: 140 }} />
          <h1 className="text-3xl font-bold">Tu es dans la partie !</h1>
          <p className="text-xgrey text-lg">Regarde la télé, ça va commencer…</p>
        </div>
        <p className="text-xgrey text-center">{state.players.length} joueurs connectés</p>
      </Shell>
    );
  }

  // ---- Question ----
  if (game.phase === "question" && state.question) {
    const mine = me?.current;
    if (mine || sending !== null) {
      const choice = mine?.choice ?? sending!;
      const style = ANSWER_STYLES[choice];
      return (
        <Shell header={header}>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className={`${style.bg} animate-pop flex h-32 w-32 items-center justify-center rounded-3xl`}>
              <Shape kind={style.shape} className="h-14 w-14" />
            </div>
            {sendError ? (
              <>
                <p className="text-xred text-2xl font-bold">{sendError}</p>
                {!mine && remaining !== 0 && (
                  <button onClick={() => { setSending(null); setSendError(null); }} className="rounded-full bg-white/15 px-6 py-3 text-lg font-semibold">
                    Réessayer
                  </button>
                )}
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold">{mine ? "Réponse envoyée !" : "Envoi…"}</h1>
                {mine && (
                  <p className="text-xgold text-2xl font-semibold">
                    en {(mine.elapsedMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s
                  </p>
                )}
                <p className="text-xgrey text-lg">Attends les autres joueurs…</p>
              </>
            )}
          </div>
        </Shell>
      );
    }
    const pct = remaining === null ? 1 : remaining / game.timeLimitMs;
    return (
      <Shell header={header}>
        <div className="flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/12">
            <div className="bg-xgold h-full rounded-full transition-[width] duration-100" style={{ width: `${pct * 100}%` }} />
          </div>
          <span className="text-xgold w-12 text-right text-lg font-bold">{Math.ceil((remaining ?? 0) / 1000)} s</span>
        </div>
        <p className="text-xgrey text-center">Question {qi + 1} · regarde la télé et réponds ici !</p>
        <div className="grid flex-1 grid-cols-2 gap-3">
          {state.question.choices.map((_, i) => {
            const s = ANSWER_STYLES[i];
            return (
              <button
                key={i}
                onClick={() => answer(i)}
                disabled={remaining === 0}
                aria-label={`Réponse ${"ABCD"[i]}`}
                className={`${s.bg} flex items-center justify-center rounded-3xl shadow-[0_6px_0_rgba(0,0,0,0.35)] transition active:translate-y-1 active:shadow-none disabled:opacity-40`}
              >
                <Shape kind={s.shape} className="h-16 w-16" />
              </button>
            );
          })}
        </div>
      </Shell>
    );
  }

  // ---- Résultat de la question ----
  if (game.phase === "results" && me) {
    const mine = me.current;
    const good = mine?.isCorrect;
    return (
      <Shell header={header} tone={good ? "good" : mine ? "bad" : "none"}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="animate-pop flex h-32 w-32 items-center justify-center rounded-full bg-white text-6xl font-bold">
            {good ? <span className="text-xgreen">✓</span> : <span className="text-xred">✕</span>}
          </div>
          <h1 className="text-4xl font-bold">
            {good ? "Bonne réponse !" : mine ? "Raté !" : "Pas de réponse…"}
          </h1>
          <p className="text-xgold rounded-full bg-black/30 px-6 py-3 text-4xl font-bold">
            +{formatPoints(mine?.points ?? 0)} pts
          </p>
          <p className="text-xl">
            Tu es <b>{me.rank === 1 ? "1er" : `${me.rank}e`}</b> · {formatPoints(me.total)} pts
          </p>
        </div>
      </Shell>
    );
  }

  // ---- Classement / fin ----
  if ((game.phase === "leaderboard" || game.phase === "end") && me) {
    return (
      <Shell header={header}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-xgold text-lg font-semibold">{game.phase === "end" ? "CLASSEMENT FINAL" : "CLASSEMENT"}</p>
          <p className="animate-pop text-8xl font-bold">{me.rank === 1 ? "1er" : `${me.rank}e`}</p>
          <p className="text-2xl">{formatPoints(me.total)} points</p>
          <p className="text-xgrey text-lg">
            {game.phase === "end" ? "Bravo ! Regarde la télé 🎁" : "Regarde la télé…"}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell header={header}>
      <Center>Regarde la télé…</Center>
    </Shell>
  );
}

function Shell({
  header,
  children,
  tone = "none",
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  tone?: "good" | "bad" | "none";
}) {
  const bg =
    tone === "good"
      ? "bg-gradient-to-b from-[#1a7362] to-[#0d332f]"
      : tone === "bad"
        ? "bg-gradient-to-b from-[#8c1f2a] to-[#2e0d14]"
        : "";
  return (
    <main className={`mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-5 pt-8 ${bg}`}>
      {header}
      {children}
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="text-xgrey flex min-h-dvh items-center justify-center p-6 text-center text-xl">{children}</div>;
}
