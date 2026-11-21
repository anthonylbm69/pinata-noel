"use client";
// Téléphone pendant la partie : attente, présentation d'épreuve, répondre
// (4 boutons ou prix), résultat, classement, finale, box, fin.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ANSWER_STYLES, Avatar, Shape, formatPoints } from "@/components/ui";
import { playerStore, type PlayerAuth } from "@/lib/storage";
import { postJson, useGameState, useRemaining, type Auth } from "@/hooks/useGameState";
import type { GameState } from "@/lib/types";

const ROUND_ICONS: Record<string, string> = {
  quiz: "🧠",
  blindtest: "🎵",
  memoire: "👀",
  justeprix: "💶",
  quiestce: "🕵️",
};

const rankLabel = (r: number) => (r === 1 ? "1er" : `${r}e`);

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
  const phase = state?.game.phase;
  const step = `${phase}-${qi}-${state?.final?.buttons.filter((b) => b.pressed).length ?? 0}-${state?.boxes?.picks.length ?? 0}`;
  useEffect(() => {
    setSending(null);
    setSendError(null);
  }, [step]);

  async function send(url: string, payload: Record<string, unknown>, marker: number) {
    if (!auth || sending !== null) return;
    setSending(marker);
    setSendError(null);
    try {
      await postJson(url, { playerId: auth.playerId, token: auth.token, ...payload });
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      void refresh();
    }
  }
  const answer = (choice: number) => send(`/api/games/${code}/answer`, { questionIndex: qi, choice }, choice);
  const press = (idx: number) => send(`/api/games/${code}/final`, { idx }, idx);
  const pick = (box: number) => send(`/api/games/${code}/box`, { box }, box);
  const retry = () => {
    setSending(null);
    setSendError(null);
  };

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
    const n = state.players.length;
    return (
      <Shell header={header}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="animate-pop border-xgold rounded-full border-[6px]" style={{ background: auth.color, width: 140, height: 140 }} />
          <h1 className="text-3xl font-bold">Tu es dans la partie !</h1>
          <p className="text-xgrey text-lg">Regarde la télé, ça va commencer…</p>
        </div>
        <p className="text-xgrey text-center">
          {n} joueur{n > 1 ? "s" : ""} connecté{n > 1 ? "s" : ""}
        </p>
      </Shell>
    );
  }

  // ---- Présentation d'une épreuve ----
  if (game.phase === "intro" && state.round) {
    const r = state.round;
    return (
      <Shell header={header}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-xgold font-semibold">
            ÉPREUVE {r.index + 1}/{r.total}
          </p>
          <span className="animate-pop text-8xl">{ROUND_ICONS[r.type]}</span>
          <h1 className="text-4xl font-bold">{r.title}</h1>
          <p className="text-lg">{r.type === "memoire" ? "Regarde bien la télé, mémorise tout ! 👀" : r.rules}</p>
        </div>
      </Shell>
    );
  }

  // ---- Question ----
  if (game.phase === "question" && state.question) {
    const q = state.question;
    const mine = me?.current;
    const isPrice = q.kind === "price";
    if (mine || sending !== null) {
      const value = mine?.choice ?? sending!;
      const style = ANSWER_STYLES[value] ?? ANSWER_STYLES[0];
      return (
        <Shell header={header}>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            {isPrice ? (
              <p className="animate-pop text-6xl font-bold">{formatPoints(value)} €</p>
            ) : (
              <div className={`${style.bg} animate-pop flex h-32 w-32 items-center justify-center rounded-3xl`}>
                <Shape kind={style.shape} className="h-14 w-14" />
              </div>
            )}
            {sendError ? (
              <>
                <p className="text-xred text-2xl font-bold">{sendError}</p>
                {!mine && remaining !== 0 && (
                  <button onClick={retry} className="rounded-full bg-white/15 px-6 py-3 text-lg font-semibold">
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
        {isPrice ? (
          <PriceInput question={q.text} emoji={q.emoji} disabled={remaining === 0} onSubmit={answer} />
        ) : (
          <>
            <p className="text-xgrey text-center">
              {state.round?.title} · question {q.indexInRound + 1} · regarde la télé et réponds ici !
            </p>
            <div className="grid flex-1 grid-cols-2 gap-3">
              {q.choices.map((_, i) => {
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
          </>
        )}
      </Shell>
    );
  }

  // ---- Résultat de la question ----
  if (game.phase === "results" && me) {
    const mine = me.current;
    const price = state.results?.price ?? null;
    const good = price !== null ? (mine?.points ?? 0) > 0 : mine?.isCorrect;
    const over = price !== null && mine && mine.choice > price;
    return (
      <Shell header={header} tone={good ? "good" : mine ? "bad" : "none"}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="animate-pop flex h-32 w-32 items-center justify-center rounded-full bg-white text-6xl font-bold">
            {good ? <span className="text-xgreen">{mine?.isCorrect ? "🏆" : "✓"}</span> : <span className="text-xred">✕</span>}
          </div>
          <h1 className="text-4xl font-bold">
            {price !== null
              ? !mine
                ? "Pas de réponse…"
                : over
                  ? "Dépassé !"
                  : mine.isCorrect
                    ? "Le plus proche !"
                    : "Pas mal !"
              : good
                ? "Bonne réponse !"
                : mine
                  ? "Raté !"
                  : "Pas de réponse…"}
          </h1>
          {price !== null && (
            <p className="text-lg">
              Prix : <b>{formatPoints(price)} €</b>
              {mine && <> · toi : {formatPoints(mine.choice)} €</>}
            </p>
          )}
          <p className="text-xgold rounded-full bg-black/30 px-6 py-3 text-4xl font-bold">
            +{formatPoints(mine?.points ?? 0)} pts
          </p>
          <p className="text-xl">
            Tu es <b>{rankLabel(me.rank)}</b> · {formatPoints(me.total)} pts
          </p>
        </div>
      </Shell>
    );
  }

  // ---- Finale ----
  if (game.phase === "final" && me) {
    return (
      <Shell header={header}>
        <FinalPhone state={state} meId={me.id} sending={sending} error={sendError} onPress={press} onRetry={retry} />
      </Shell>
    );
  }

  // ---- Box ----
  if (game.phase === "boxes" && me && state.boxes) {
    const b = state.boxes;
    const myBox = b.picks.find((p) => p.playerId === me.id)?.box;
    const myTurn = b.current === me.id;
    const position = b.order.indexOf(me.id);
    const currentName = state.players.find((p) => p.id === b.current)?.name;
    const taken = new Set(b.picks.map((p) => p.box));
    return (
      <Shell header={header}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          {myBox ? (
            <>
              <span className="animate-pop text-8xl">🎁</span>
              <h1 className="text-3xl font-bold">Ta box : n° {myBox}</h1>
              <p className="text-xgrey text-lg">Va chercher ton paquet et ouvre-le devant tout le monde !</p>
            </>
          ) : myTurn ? (
            <>
              <h1 className="text-4xl font-bold">À toi de choisir !</h1>
              <div className="grid w-full grid-cols-3 gap-3">
                {Array.from({ length: b.count }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    disabled={taken.has(n) || sending !== null}
                    onClick={() => pick(n)}
                    className="bg-xred flex aspect-square items-center justify-center rounded-3xl text-5xl font-bold shadow-[0_6px_0_rgba(0,0,0,0.35)] active:translate-y-1 disabled:opacity-25"
                  >
                    {taken.has(n) ? "🎁" : n}
                  </button>
                ))}
              </div>
              {sendError && <p className="text-xred text-xl font-semibold">{sendError}</p>}
            </>
          ) : position >= 0 ? (
            <>
              <span className="text-7xl">⏳</span>
              <h1 className="text-3xl font-bold">{currentName} choisit…</h1>
              <p className="text-xgrey text-lg">Tu choisiras en {rankLabel(position + 1)}</p>
            </>
          ) : (
            <p className="text-xgrey text-xl">Regarde la télé 🎁</p>
          )}
        </div>
      </Shell>
    );
  }

  // ---- Classement / fin ----
  if ((game.phase === "leaderboard" || game.phase === "end") && me) {
    const myBox = state.boxes?.picks.find((p) => p.playerId === me.id)?.box;
    return (
      <Shell header={header}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-xgold text-lg font-semibold">{game.phase === "end" ? "CLASSEMENT FINAL" : "CLASSEMENT"}</p>
          <p className="animate-pop text-8xl font-bold">{rankLabel(me.rank)}</p>
          <p className="text-2xl">{formatPoints(me.total)} points</p>
          <p className="text-xgrey text-lg">
            {game.phase === "end" ? (myBox ? `Joyeux Noël ! Ta box : n° ${myBox} 🎁` : "Joyeux Noël ! 🎄") : "Regarde la télé…"}
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

// Juste prix : saisie d'un prix en euros entiers.
function PriceInput({
  question,
  emoji,
  disabled,
  onSubmit,
}: {
  question: string;
  emoji?: string;
  disabled: boolean;
  onSubmit: (value: number) => void;
}) {
  const [value, setValue] = useState("");
  const n = Number(value);
  const valid = value !== "" && Number.isInteger(n) && n >= 0;
  return (
    <form
      className="flex flex-1 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !disabled) onSubmit(n);
      }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-6xl">{emoji ?? "💶"}</span>
        <p className="text-xl font-semibold">{question}</p>
        <p className="text-xgrey">Le plus proche sans dépasser gagne !</p>
      </div>
      <label className="flex items-center gap-3 rounded-3xl bg-white/10 px-5 py-4">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 7))}
          placeholder="0"
          aria-label="Ton prix en euros"
          className="w-full bg-transparent text-right text-6xl font-bold outline-none placeholder:text-white/20"
        />
        <span className="text-5xl font-bold">€</span>
      </label>
      <span className="flex-1" />
      <button
        type="submit"
        disabled={!valid || disabled}
        className="bg-xgreen rounded-full py-5 text-2xl font-bold shadow-[0_6px_0_rgba(0,0,0,0.35)] active:translate-y-1 disabled:opacity-40"
      >
        Valider
      </button>
    </form>
  );
}

function FinalPhone({
  state,
  meId,
  sending,
  error,
  onPress,
  onRetry,
}: {
  state: GameState;
  meId: string;
  sending: number | null;
  error: string | null;
  onPress: (idx: number) => void;
  onRetry: () => void;
}) {
  const f = state.final;
  if (!f) return <Center>Préparation de la finale…</Center>;
  const mine = f.order.find((o) => o.id === meId);
  const turnName = state.players.find((p) => p.id === f.turn)?.name;
  const myTurn = f.turn === meId;

  if (f.finished) {
    const won = mine?.place === 1;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <span className="animate-pop text-8xl">{won ? "🏆" : mine?.out ? "💥" : "🎄"}</span>
        <h1 className="text-4xl font-bold">{won ? "Tu as survécu !" : "Finale terminée"}</h1>
        {won && <p className="text-xgold text-3xl font-bold">+{formatPoints(f.winPoints)} pts</p>}
        <p className="text-xgrey text-lg">Regarde la télé…</p>
      </div>
    );
  }
  if (mine?.out) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <span className="animate-pop text-8xl">💥</span>
        <h1 className="text-4xl font-bold">Boum ! Éliminé</h1>
        <p className="text-xgrey text-lg">Au tour de {turnName}…</p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="text-center">
        <h1 className={`text-3xl font-bold ${myTurn ? "text-xgold" : ""}`}>
          {myTurn ? "À toi ! Choisis un bouton 😬" : `Au tour de ${turnName}…`}
        </h1>
        <p className="text-xgrey">
          {f.bombsLeft} bombe{f.bombsLeft > 1 ? "s" : ""} cachée{f.bombsLeft > 1 ? "s" : ""}
        </p>
      </div>
      <div className="grid flex-1 grid-cols-4 gap-2">
        {f.buttons.map((b) => (
          <button
            key={b.idx}
            disabled={!myTurn || b.pressed || sending !== null}
            onClick={() => onPress(b.idx)}
            className={`flex items-center justify-center rounded-2xl text-2xl font-bold transition ${
              b.pressed ? (b.bomb ? "bg-black/60" : "bg-white/10") : myTurn ? "bg-xred shadow-[0_4px_0_rgba(0,0,0,0.35)] active:translate-y-1" : "bg-xred/40"
            }`}
          >
            {b.pressed ? (b.bomb ? "💥" : "✓") : b.idx + 1}
          </button>
        ))}
      </div>
      {error && (
        <button onClick={onRetry} className="text-xred text-center text-lg font-semibold">
          {error} (toucher pour réessayer)
        </button>
      )}
    </div>
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
