"use client";
// Télé (écran animateur) : lobby avec QR, question, résultats, classement, fin.
// Pilote la partie : c'est la télé qui ferme les questions et fait répondre les bots.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ANSWER_STYLES,
  Avatar,
  Button,
  Kicker,
  PlayerChip,
  Shape,
  formatPoints,
} from "@/components/ui";
import { hostStore } from "@/lib/storage";
import { postJson, useGameState, useRemaining, type Auth } from "@/hooks/useGameState";
import type { GameState } from "@/lib/types";
import HostPanel from "./HostPanel";

export default function HostScreen({ code }: { code: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  // Jeton animateur : depuis ?t= (lien de reprise) ou depuis ce navigateur.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("t");
    if (fromUrl) {
      hostStore.set(code, fromUrl);
      window.history.replaceState(null, "", `/host/${code}`);
      setToken(fromUrl);
    } else {
      setToken(hostStore.get(code));
    }
  }, [code]);

  const auth: Auth | null = useMemo(() => (token ? { role: "host", token } : null), [token]);
  const { state, error, live, refresh, serverNow } = useGameState(code, auth);
  const remaining = useRemaining(state, serverNow);

  const [actionError, setActionError] = useState<string | null>(null);
  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!token) return;
      try {
        await postJson(`/api/games/${code}/host`, { token, action, ...extra });
        if (action !== "bot-answer") setActionError(null);
      } catch (e) {
        if (action !== "bot-answer") setActionError((e as Error).message);
      } finally {
        void refresh();
      }
    },
    [code, token, refresh],
  );

  useAutoClose(state, remaining, act);
  useBots(state, act);

  if (token === null) {
    return (
      <Center>
        <div className="flex flex-col items-center gap-3">
          <p className="text-3xl font-bold">Jeton animateur manquant</p>
          <p>Ouvre le « lien animateur » de cette partie, ou crée une nouvelle partie depuis l&apos;accueil.</p>
        </div>
      </Center>
    );
  }
  if (!state) return <Center>{error?.message ?? "Chargement…"}</Center>;

  return (
    <div className="relative min-h-dvh">
      {state.game.isTest && (
        <span className="absolute top-3 left-3 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/60">
          TEST
        </span>
      )}
      <span
        title={live ? "Temps réel connecté" : "Temps réel déconnecté (rechargement auto)"}
        className={`absolute top-4 right-4 h-3 w-3 rounded-full ${live ? "bg-xgreen" : "bg-xred"}`}
      />
      {state.game.phase === "lobby" && <Lobby state={state} onStart={() => act("start")} />}
      {state.game.phase === "question" && <QuestionView state={state} remaining={remaining} />}
      {state.game.phase === "results" && <ResultsView state={state} act={act} />}
      {state.game.phase === "leaderboard" && <LeaderboardView state={state} act={act} />}
      {state.game.phase === "end" && <EndView state={state} />}
      <HostPanel state={state} act={act} code={code} token={token ?? ""} error={actionError ?? error?.message ?? null} />
    </div>
  );
}

// Ferme la question quand le chrono est fini ou que tout le monde a répondu.
function useAutoClose(
  state: GameState | null,
  remaining: number | null,
  act: (a: string, e?: Record<string, unknown>) => Promise<void>,
) {
  const closed = useRef<string>("");
  useEffect(() => {
    if (!state || state.game.phase !== "question") return;
    const key = `${state.game.questionIndex}-${state.game.openedAt}`;
    if (closed.current === key) return;
    const everyone = state.players.length > 0 && state.answeredCount >= state.players.length;
    if (remaining === 0 || everyone) {
      closed.current = key;
      // petit délai pour laisser arriver les réponses de la dernière seconde
      setTimeout(() => void act("close", { questionIndex: state.game.questionIndex }), everyone ? 600 : 1200);
    }
  }, [state, remaining, act]);
}

// Fait répondre les bots avec un délai aléatoire (tests sans téléphones).
function useBots(state: GameState | null, act: (a: string, e?: Record<string, unknown>) => Promise<void>) {
  const scheduled = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state || state.game.phase !== "question") return;
    const key = `${state.game.questionIndex}-${state.game.openedAt}`;
    for (const p of state.players) {
      if (!p.isBot || state.answeredPlayerIds.includes(p.id)) continue;
      const id = `${key}-${p.id}`;
      if (scheduled.current.has(id)) continue;
      scheduled.current.add(id);
      const delay = 1200 + Math.random() * state.game.timeLimitMs * 0.7;
      setTimeout(() => void act("bot-answer", { playerId: p.id }), delay);
    }
    // Les timers ne sont pas annulés au re-render (sinon les bots ne répondraient jamais).
  }, [state, act]);
}

// ----------------------------------------------------------------------------

function Lobby({ state, onStart }: { state: GameState; onStart: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  useEffect(() => {
    const url = `${window.location.origin}/play?code=${state.game.code}`;
    setJoinUrl(url);
    QRCode.toDataURL(url, { margin: 1, width: 640, color: { dark: "#141a33", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [state.game.code]);

  const humans = state.players.length;
  return (
    <main className="flex min-h-dvh items-center justify-center gap-16 p-12">
      <div className="flex flex-col items-center gap-5">
        <div className="rounded-3xl bg-white p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code pour rejoindre" className="h-80 w-80" />
          ) : (
            <div className="h-80 w-80" />
          )}
        </div>
        <p className="text-3xl font-bold">Scanne pour jouer</p>
        <div className="flex items-center gap-3 rounded-2xl bg-white/8 px-5 py-3">
          <span className="text-xgrey">{joinUrl.replace(/^https?:\/\//, "").replace(/\?.*$/, "")} · code</span>
          <span className="text-xgold text-4xl font-bold tracking-widest">{state.game.code}</span>
        </div>
      </div>
      <div className="flex max-w-xl flex-col gap-5">
        <Kicker>La Pinata de Noël · {state.game.quizTitle}</Kicker>
        <h1 className="text-6xl font-bold">En attente des joueurs…</h1>
        <p className="text-xgrey text-2xl">
          {humans} joueur{humans > 1 ? "s" : ""} connecté{humans > 1 ? "s" : ""}
        </p>
        <div className="flex flex-wrap gap-3">
          {state.players.map((p) => (
            <span key={p.id} className="animate-pop">
              <PlayerChip name={p.name} color={p.color} />
            </span>
          ))}
        </div>
        <div>
          <Button onClick={onStart} disabled={humans === 0}>
            Démarrer ({humans})
          </Button>
        </div>
      </div>
    </main>
  );
}

function QuestionView({ state, remaining }: { state: GameState; remaining: number | null }) {
  const q = state.question!;
  const secs = Math.ceil((remaining ?? state.game.timeLimitMs) / 1000);
  const pct = remaining === null ? 1 : remaining / state.game.timeLimitMs;
  return (
    <main className="flex min-h-dvh flex-col gap-8 p-12">
      <div className="flex items-center justify-between">
        <Kicker>
          {state.game.quizTitle} · Question {q.index + 1}/{state.game.totalQuestions}
        </Kicker>
        <span className="rounded-full bg-white/10 px-5 py-2 text-xl font-semibold">
          {state.answeredCount} / {state.players.length} réponses
        </span>
      </div>
      <h1 className="text-center text-6xl leading-tight font-bold">{q.text}</h1>
      <div className="flex flex-1 items-center justify-center">
        <div className="relative flex h-56 w-56 items-center justify-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
            <circle cx="50" cy="50" r="45" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="var(--color-xgold)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${pct * 283} 283`}
            />
          </svg>
          <span className={`text-8xl font-bold ${secs <= 5 ? "text-xred" : "text-xgold"}`}>{secs}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        {q.choices.map((c, i) => {
          const s = ANSWER_STYLES[i];
          return (
            <div key={i} className={`${s.bg} flex items-center gap-5 rounded-3xl px-8 py-7`}>
              <Shape kind={s.shape} className="h-10 w-10 shrink-0" />
              <span className="text-4xl font-semibold">{c}</span>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function ResultsView({ state, act }: { state: GameState; act: (a: string) => Promise<void> }) {
  const q = state.question!;
  const r = state.results!;
  const max = Math.max(1, ...r.distribution);
  const isLast = q.index >= state.game.totalQuestions - 1;
  return (
    <main className="flex min-h-dvh gap-10 p-12">
      <section className="flex flex-1 flex-col gap-6">
        <Kicker>
          Question {q.index + 1}/{state.game.totalQuestions} · bonne réponse
        </Kicker>
        <h1 className="animate-pop flex items-center gap-5 text-7xl font-bold">
          <span className={`${ANSWER_STYLES[r.correct].bg} inline-flex h-20 w-20 items-center justify-center rounded-2xl`}>
            <Shape kind={ANSWER_STYLES[r.correct].shape} className="h-10 w-10" />
          </span>
          {q.choices[r.correct]}
        </h1>
        <div className="flex flex-1 items-end justify-center gap-10 pb-4">
          {r.distribution.map((n, i) => {
            const s = ANSWER_STYLES[i];
            const ok = i === r.correct;
            return (
              <div key={i} className="flex w-32 flex-col items-center gap-3">
                <span className={`text-4xl font-bold ${ok ? "" : "text-xgrey"}`}>{n}</span>
                <div
                  className={`${s.bg} flex w-full items-end justify-center rounded-2xl pb-3 transition-all duration-700 ${ok ? "ring-4 ring-white" : "opacity-35"}`}
                  style={{ height: 40 + (n / max) * 260 }}
                >
                  <Shape kind={s.shape} className="h-8 w-8" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4">
          <Button color="bg-xgreen" onClick={() => void act("show-leaderboard")}>
            Classement
          </Button>
          <Button color="bg-white/15" onClick={() => void act("next")}>
            {isLast ? "Terminer" : "Question suivante →"}
          </Button>
        </div>
      </section>
      <aside className="flex w-[420px] flex-col gap-3 rounded-[28px] bg-white/5 p-7">
        <h2 className="text-3xl font-bold">Les plus rapides</h2>
        {r.lines.map((l, i) => (
          <div key={l.id} className="animate-rise flex items-center justify-between gap-3" style={{ animationDelay: `${i * 60}ms` }}>
            <PlayerChip name={l.name} color={l.color} />
            <div className="text-right">
              <p className={`text-xl font-bold ${l.points ? "text-xgold" : "text-xgrey"}`}>
                {l.points ? `+${formatPoints(l.points)}` : "0"}
              </p>
              <p className="text-xgrey text-sm">
                {!l.answered
                  ? "pas répondu"
                  : l.isCorrect
                    ? `${((l.elapsedMs ?? 0) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`
                    : "faux"}
              </p>
            </div>
          </div>
        ))}
      </aside>
    </main>
  );
}

function Leaderboard({ state, limit = 10 }: { state: GameState; limit?: number }) {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      {state.leaderboard.slice(0, limit).map((p, i) => (
        <div
          key={p.id}
          className={`animate-rise flex items-center gap-4 rounded-2xl px-5 py-2 ${p.rank === 1 ? "bg-xgold/20" : "bg-white/5"}`}
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <span className={`w-8 text-3xl font-bold ${p.rank === 1 ? "text-xgold" : "text-xgrey"}`}>{p.rank}</span>
          <PlayerChip name={p.name} color={p.color} />
          <span className="flex-1" />
          <span className={`text-2xl font-bold ${p.rank === 1 ? "text-xgold" : ""}`}>{formatPoints(p.total)} pts</span>
        </div>
      ))}
    </div>
  );
}

function LeaderboardView({ state, act }: { state: GameState; act: (a: string) => Promise<void> }) {
  const isLast = state.game.questionIndex >= state.game.totalQuestions - 1;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-10">
      <Kicker>
        Après {state.game.questionIndex + 1} question{state.game.questionIndex ? "s" : ""}
      </Kicker>
      <h1 className="text-6xl font-bold">Classement</h1>
      <Leaderboard state={state} />
      <Button onClick={() => void act("next")}>{isLast ? "Voir le classement final" : "Question suivante →"}</Button>
    </main>
  );
}

function EndView({ state }: { state: GameState }) {
  const podium = state.leaderboard.slice(0, 3);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-10">
      <Kicker>Classement final · l&apos;ordre de choix des box</Kicker>
      <h1 className="text-7xl font-bold">Bravo à tous ! 🎉</h1>
      <div className="flex items-end gap-6">
        {[1, 0, 2].map((i) => {
          const p = podium[i];
          if (!p) return <div key={i} className="w-48" />;
          const h = i === 0 ? 220 : i === 1 ? 160 : 120;
          return (
            <div key={p.id} className="animate-pop flex w-48 flex-col items-center gap-3" style={{ animationDelay: `${(2 - i) * 300}ms` }}>
              <Avatar color={p.color} size={i === 0 ? 96 : 72} />
              <p className="text-2xl font-bold">{p.name}</p>
              <p className="text-xgrey">{formatPoints(p.total)} pts</p>
              <div
                className={`flex w-full items-start justify-center rounded-t-2xl pt-4 text-5xl font-bold ${i === 0 ? "bg-xgold text-ink" : "bg-white/15"}`}
                style={{ height: h }}
              >
                {p.rank}
              </div>
            </div>
          );
        })}
      </div>
      <Leaderboard state={state} limit={20} />
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="text-xgrey flex min-h-dvh items-center justify-center p-6 text-center text-2xl">{children}</div>;
}
