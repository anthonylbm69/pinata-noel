"use client";
// Télé (écran animateur) : lobby avec QR, présentation des épreuves, questions,
// résultats, classement, finale, box, fin.
// Pilote la partie : c'est la télé qui ferme les questions et fait jouer les bots.
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
import { hostStore, soundStore } from "@/lib/storage";
import { gameAudio, type MusicMode } from "@/lib/game-audio";
import { postJson, useGameState, useRemaining, type Auth } from "@/hooks/useGameState";
import type { GameState } from "@/lib/types";
import HostPanel from "./HostPanel";
import { BoxesView, FinalView } from "./HostFinal";

export type Act = (a: string, e?: Record<string, unknown>) => Promise<void>;

const NAV_ACTIONS = new Set(["start", "begin-round", "show-leaderboard", "next", "skip-round"]);

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
  // Dernier état vu, pour dire au serveur « je clique depuis tel écran » :
  // un double clic (ou une télécommande qui répète) ne saute pas deux étapes.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const navBusy = useRef(false);
  const act: Act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!token) return;
      const quiet = action.startsWith("bot-") || action === "close";
      const nav = NAV_ACTIONS.has(action);
      if (nav && navBusy.current) return;
      if (nav) navBusy.current = true;
      const g = stateRef.current?.game;
      const at = nav && g ? `${g.phase}:${g.questionIndex}` : undefined;
      try {
        await postJson(`/api/games/${code}/host`, { token, action, at, ...extra });
        if (!quiet) setActionError(null);
      } catch (e) {
        if (!quiet) setActionError((e as Error).message);
      } finally {
        if (nav) navBusy.current = false;
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

  const phase = state.game.phase;
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
      <BlindTestAudio state={state} />
      <GameSound state={state} remaining={remaining} />
      {phase === "lobby" && <Lobby state={state} onStart={() => act("start")} />}
      {phase === "intro" && <IntroView state={state} remaining={remaining} act={act} />}
      {phase === "question" && <QuestionView state={state} remaining={remaining} />}
      {phase === "results" && state.results?.kind === "price" && <PriceResultsView state={state} act={act} />}
      {phase === "results" && state.results?.kind === "choice" && <ResultsView state={state} act={act} />}
      {phase === "leaderboard" && <LeaderboardView state={state} act={act} />}
      {phase === "final" && <FinalView state={state} act={act} />}
      {phase === "boxes" && <BoxesView state={state} act={act} />}
      {phase === "end" && <EndView state={state} />}
      <HostPanel state={state} act={act} code={code} token={token ?? ""} error={actionError ?? error?.message ?? null} />
    </div>
  );
}

// Ferme la question quand le chrono est fini ou que tout le monde a répondu.
// Si la fermeture échoue (réseau), on réessaie au bout de 3 s.
function useAutoClose(state: GameState | null, remaining: number | null, act: Act) {
  const closed = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  useEffect(() => {
    if (!state || state.game.phase !== "question") return;
    const key = `${state.game.questionIndex}-${state.game.openedAt}`;
    if (closed.current.key === key && Date.now() - closed.current.at < 3000) return;
    const everyone = state.players.length > 0 && state.answeredCount >= state.players.length;
    if (remaining === 0 || everyone) {
      closed.current = { key, at: Date.now() };
      // petit délai pour laisser arriver les réponses de la dernière seconde
      setTimeout(() => void act("close", { questionIndex: state.game.questionIndex }), everyone ? 600 : 1200);
    }
  }, [state, remaining, act]);
}

// Fait jouer les bots (tests sans téléphones) : questions, finale, box.
function useBots(state: GameState | null, act: Act) {
  const scheduled = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state) return;
    const once = (id: string, delay: number, fn: () => void) => {
      if (scheduled.current.has(id)) return;
      scheduled.current.add(id);
      setTimeout(fn, delay);
    };
    const bots = new Set(state.players.filter((p) => p.isBot).map((p) => p.id));

    if (state.game.phase === "question") {
      const key = `${state.game.questionIndex}-${state.game.openedAt}`;
      for (const id of bots) {
        if (state.answeredPlayerIds.includes(id)) continue;
        const delay = 1200 + Math.random() * state.game.timeLimitMs * 0.7;
        once(`${key}-${id}`, delay, () => void act("bot-answer", { playerId: id }));
      }
    }
    // Finale : le bot dont c'est le tour appuie au hasard.
    const f = state.final;
    if (state.game.phase === "final" && f && f.turn && bots.has(f.turn)) {
      const pressed = f.buttons.filter((b) => b.pressed).length;
      once(`final-${pressed}-${f.turn}`, 1800, () => void act("bot-final-press"));
    }
    // Box : le bot dont c'est le tour choisit au hasard.
    const b = state.boxes;
    if (state.game.phase === "boxes" && b?.current && bots.has(b.current)) {
      const current = b.current;
      once(`box-${b.picks.length}-${current}`, 1500, () => void act("bot-pick-box", { playerId: current }));
    }
    // Les timers ne sont pas annulés au re-render (sinon les bots ne joueraient jamais).
  }, [state, act]);
}

// Musique de fond + tic-tac du chrono (synthétisés, voir src/lib/game-audio.ts).
// Pas de musique pendant le blind test (l'extrait joue déjà), mais le tic-tac oui.
// Bouton 🔊/🔇 en haut à droite ; le choix est gardé dans ce navigateur.
function GameSound({ state, remaining }: { state: GameState; remaining: number | null }) {
  const [on, setOn] = useState(true);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setOn(soundStore.get());
    // les navigateurs bloquent le son tant qu'on n'a pas cliqué / appuyé sur une touche
    const unlock = () => {
      gameAudio().unlock();
      setTimeout(() => setLocked(gameAudio().locked), 300);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    const id = setInterval(() => setLocked(gameAudio().locked), 1000);
    gameAudio().unlock(); // marche déjà si la page a été ouverte par un clic
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    gameAudio().setEnabled(on);
  }, [on]);

  const phase = state.game.phase;
  const blind = !!state.question?.audio && (phase === "question" || phase === "results");
  const mode: MusicMode = blind ? "off" : phase === "question" ? "play" : "calm";
  useEffect(() => {
    gameAudio().setMusic(mode);
  }, [mode]);

  // tic-tac : pendant une question (sauf si tout le monde a déjà répondu) et
  // pendant l'affichage chronométré de la mémoire
  const everyone = state.players.length > 0 && state.answeredCount >= state.players.length;
  const counting = (phase === "question" && !everyone) || phase === "intro";
  const cdKey = counting && remaining !== null ? `${phase}|${state.game.questionIndex}|${state.game.openedAt}` : null;
  useEffect(() => {
    gameAudio().setCountdown(cdKey ? remaining : null, cdKey);
  }, [cdKey, remaining]);

  // en quittant la télé, on coupe tout
  useEffect(() => () => gameAudio().setMusic("off"), []);

  return (
    <button
      onClick={() => {
        const next = locked ? true : !on;
        soundStore.set(next);
        setOn(next);
      }}
      title={on ? "Couper la musique" : "Remettre la musique"}
      className="absolute top-2 right-10 z-20 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/70 hover:bg-white/20"
    >
      {on && locked ? "🔈 Cliquer pour la musique" : on ? "🔊" : "🔇"}
    </button>
  );
}

// Blind test : la musique est jouée UNIQUEMENT par la télé (pendant la question
// et les résultats). Si le navigateur bloque le son, un gros bouton apparaît.
function BlindTestAudio({ state }: { state: GameState }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const q = state.question;
  // les noms de fichiers peuvent contenir espaces, accents, crochets… : on encode l'URL
  const src = q?.audio ? encodeURI(q.audio) : null;
  const playing = !!src && (state.game.phase === "question" || state.game.phase === "results");
  const key = playing ? `${q!.index}-${state.game.openedAt}` : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!key || !src) {
      el.pause();
      return;
    }
    setMissing(null);
    if (!el.src.endsWith(src)) el.src = src;
    const start = () => {
      try {
        el.currentTime = q?.start ?? 0;
      } catch {
        /* métadonnées pas encore chargées */
      }
      el.play().then(
        () => setBlocked(false),
        () => setBlocked(true),
      );
    };
    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });
    // on ne relance que quand la question change, pas aux résultats
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <>
      <audio ref={ref} preload="auto" onError={() => q?.audio && setMissing(q.audio)} />
      {playing && blocked && (
        <button
          onClick={() => ref.current?.play().then(() => setBlocked(false), () => setBlocked(true))}
          className="bg-xred fixed top-20 left-1/2 z-30 -translate-x-1/2 rounded-full px-10 py-5 text-3xl font-bold shadow-2xl"
        >
          🔊 Activer le son
        </button>
      )}
      {playing && missing && (
        <p className="bg-xred fixed top-20 left-1/2 z-30 -translate-x-1/2 rounded-2xl px-6 py-3 text-xl font-semibold">
          Fichier audio introuvable : {missing} — joue l&apos;extrait depuis un téléphone (plan B)
        </p>
      )}
    </>
  );
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

  const n = state.players.length;
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
        <Kicker>{state.game.title}</Kicker>
        <h1 className="text-6xl font-bold">En attente des joueurs…</h1>
        <p className="text-xgrey text-2xl">
          {n} joueur{n > 1 ? "s" : ""} connecté{n > 1 ? "s" : ""}
          {state.game.mode === "adultes" && (
            <>
              {" "}· 👩 {state.players.filter((p) => p.gender === "F").length} femme
              {state.players.filter((p) => p.gender === "F").length > 1 ? "s" : ""} · 👨{" "}
              {state.players.filter((p) => p.gender === "H").length} homme
              {state.players.filter((p) => p.gender === "H").length > 1 ? "s" : ""}
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          {state.players.map((p) => (
            <span key={p.id} className="animate-pop">
              <PlayerChip name={p.name} color={p.color} />
            </span>
          ))}
        </div>
        {!state.game.isTest && state.players.some((p) => p.isBot) && (
          <p className="text-xred text-xl font-semibold">
            ⚠ Il reste des bots : retire-les (⚙ → Retirer les bots) avant de jouer pour de vrai
            {state.game.hasBoxes ? ", sinon ils prendront des box." : "."}
          </p>
        )}
        <div>
          <Button onClick={onStart} disabled={n === 0}>
            Démarrer ({n})
          </Button>
        </div>
      </div>
    </main>
  );
}

const ROUND_ICONS: Record<string, string> = {
  quiz: "🧠",
  blindtest: "🎵",
  memoire: "👀",
  justeprix: "💶",
  quiestce: "🕵️",
};

// Présentation d'une épreuve. Pour la mémoire : les 10 objets, puis ils disparaissent.
function IntroView({ state, remaining, act }: { state: GameState; remaining: number | null; act: Act }) {
  const r = state.round!;
  const objects = r.objects;
  const showing = !!objects && remaining !== 0;
  const secs = Math.ceil((remaining ?? state.game.timeLimitMs) / 1000);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-12 text-center">
      <Kicker>
        Épreuve {r.index + 1}/{r.total}
      </Kicker>
      <h1 className="animate-pop text-8xl font-bold">
        {ROUND_ICONS[r.type]} {r.title}
      </h1>
      {objects ? (
        showing ? (
          <>
            <div className="grid grid-cols-5 gap-5">
              {objects.map((o, i) => (
                <div
                  key={i}
                  className="animate-pop flex w-40 flex-col items-center gap-2 rounded-3xl bg-white/8 p-5"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="text-7xl">{o.emoji}</span>
                  <span className="text-xl font-semibold">{o.label}</span>
                </div>
              ))}
            </div>
            <p className={`text-6xl font-bold ${secs <= 5 ? "text-xred" : "text-xgold"}`}>{secs}</p>
          </>
        ) : (
          <>
            <p className="text-4xl font-semibold">Les objets ont disparu ! 🙈</p>
            <Button onClick={() => void act("begin-round")}>Aux questions →</Button>
          </>
        )
      ) : (
        <>
          <p className="max-w-4xl text-3xl leading-snug">{r.rules}</p>
          <p className="text-xgrey text-2xl">
            {r.questionCount} question{r.questionCount > 1 ? "s" : ""}
          </p>
          <Button onClick={() => void act("begin-round")}>C&apos;est parti !</Button>
        </>
      )}
      {objects && showing && (
        <button onClick={() => void act("begin-round")} className="text-xgrey text-lg underline">
          passer
        </button>
      )}
    </main>
  );
}

function TimerRing({ remaining, limit, size = "h-56 w-56", text = "text-8xl" }: { remaining: number | null; limit: number; size?: string; text?: string }) {
  const secs = Math.ceil((remaining ?? limit) / 1000);
  const pct = remaining === null ? 1 : remaining / limit;
  return (
    <div className={`relative flex shrink-0 items-center justify-center ${size}`}>
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
      <span className={`font-bold ${text} ${secs <= 5 ? "text-xred" : "text-xgold"}`}>{secs}</span>
    </div>
  );
}

/** Photo du qui est-ce : très floue au début, nette à la fin du chrono. */
function RevealImage({ src, progress }: { src: string; progress: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex h-80 w-80 flex-col items-center justify-center gap-2 rounded-3xl bg-white/8 p-4 text-center">
        <span className="text-8xl">❓</span>
        <span className="text-xred text-sm">Photo introuvable : {src}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setBroken(true)}
      className="h-80 max-w-[520px] rounded-3xl object-cover transition-[filter] duration-200"
      style={{ filter: `blur(${Math.max(0, 28 * (1 - progress)).toFixed(1)}px)` }}
    />
  );
}

function QuestionView({ state, remaining }: { state: GameState; remaining: number | null }) {
  const q = state.question!;
  const r = state.round;
  const limit = state.game.timeLimitMs;
  const progress = remaining === null ? 0 : 1 - remaining / limit;
  return (
    <main className="flex min-h-dvh flex-col gap-8 p-12">
      <div className="flex items-center justify-between">
        <Kicker>
          {r ? `${ROUND_ICONS[r.type]} ${r.title} · question ${q.indexInRound + 1}/${r.questionCount}` : ""}
        </Kicker>
        <span className="rounded-full bg-white/10 px-5 py-2 text-xl font-semibold">
          {state.answeredCount} / {state.players.length} réponses
        </span>
      </div>
      <h1 className="text-center text-6xl leading-tight font-bold">{q.text}</h1>
      <div className="flex flex-1 items-center justify-center gap-14">
        {q.image && <RevealImage src={q.image} progress={progress} />}
        {q.kind === "price" && !q.image && <span className="animate-pop text-[10rem] leading-none">{q.emoji ?? "💶"}</span>}
        {q.audio && <span className="animate-pulse text-[9rem] leading-none">🎵</span>}
        <TimerRing remaining={remaining} limit={limit} />
      </div>
      {q.kind === "price" ? (
        <p className="text-center text-4xl font-semibold">
          Tape ton prix sur ton téléphone · <span className="text-xgold">sans dépasser !</span>
        </p>
      ) : (
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
      )}
    </main>
  );
}

function nextLabel(state: GameState) {
  if (state.game.lastQuestion) {
    return state.game.hasFinal ? "La finale 💣 →" : state.game.hasBoxes ? "Les box 🎁 →" : "Les gagnants 🏆 →";
  }
  if (state.game.lastInRound) return "Épreuve suivante →";
  return "Question suivante →";
}

function ResultsView({ state, act }: { state: GameState; act: Act }) {
  const q = state.question!;
  const r = state.results!;
  const max = Math.max(1, ...r.distribution);
  return (
    <main className="flex min-h-dvh gap-10 p-12">
      <section className="flex flex-1 flex-col gap-6">
        <Kicker>
          {state.round?.title} · question {q.indexInRound + 1}/{state.round?.questionCount} · bonne réponse
        </Kicker>
        <h1 className="animate-pop flex items-center gap-5 text-7xl font-bold">
          <span className={`${ANSWER_STYLES[r.correct].bg} inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl`}>
            <Shape kind={ANSWER_STYLES[r.correct].shape} className="h-10 w-10" />
          </span>
          {q.choices[r.correct]}
        </h1>
        {q.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.image} alt="" className="h-48 self-start rounded-3xl object-cover" />
        )}
        <div className="flex flex-1 items-end justify-center gap-10 pb-4">
          {r.distribution.map((n, i) => {
            const s = ANSWER_STYLES[i];
            const ok = i === r.correct;
            return (
              <div key={i} className="flex w-32 flex-col items-center gap-3">
                <span className={`text-4xl font-bold ${ok ? "" : "text-xgrey"}`}>{n}</span>
                <div
                  className={`${s.bg} flex w-full items-end justify-center rounded-2xl pb-3 transition-all duration-700 ${ok ? "ring-4 ring-white" : "opacity-35"}`}
                  style={{ height: 40 + (n / max) * 220 }}
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
            {nextLabel(state)}
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

// Juste prix : le vrai prix, puis chaque proposition (les dépassements en rouge).
function PriceResultsView({ state, act }: { state: GameState; act: Act }) {
  const q = state.question!;
  const r = state.results!;
  const price = r.price ?? 0;
  return (
    <main className="flex min-h-dvh gap-10 p-12">
      <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <Kicker>
          {state.round?.title} · question {q.indexInRound + 1}/{state.round?.questionCount}
        </Kicker>
        <p className="text-3xl">{q.text}</p>
        <span className="text-9xl leading-none">{q.emoji ?? "💶"}</span>
        <p className="animate-pop text-xgold text-[9rem] leading-none font-bold">{formatPoints(price)} €</p>
        <div className="mt-4 flex gap-4">
          <Button color="bg-xgreen" onClick={() => void act("show-leaderboard")}>
            Classement
          </Button>
          <Button color="bg-white/15" onClick={() => void act("next")}>
            {nextLabel(state)}
          </Button>
        </div>
      </section>
      <aside className="flex w-[480px] flex-col gap-3 rounded-[28px] bg-white/5 p-7">
        <h2 className="text-3xl font-bold">Les propositions</h2>
        {r.lines.map((l, i) => {
          const over = l.answered && (l.choice ?? 0) > price;
          return (
            <div key={l.id} className="animate-rise flex items-center justify-between gap-3" style={{ animationDelay: `${i * 60}ms` }}>
              <PlayerChip name={l.name} color={l.color} highlight={l.isCorrect} />
              <div className="text-right">
                <p className={`text-2xl font-bold ${over ? "text-xred line-through" : ""}`}>
                  {l.answered ? `${formatPoints(l.choice ?? 0)} €` : "—"}
                </p>
                <p className={`text-sm ${l.points ? "text-xgold font-semibold" : "text-xgrey"}`}>
                  {!l.answered ? "pas répondu" : over ? "dépassé !" : `+${formatPoints(l.points)} pts`}
                </p>
              </div>
            </div>
          );
        })}
      </aside>
    </main>
  );
}

export const CAMPS = [
  { gender: "F", label: "Femmes", icon: "👩", winner: "Gagnante" },
  { gender: "H", label: "Hommes", icon: "👨", winner: "Gagnant" },
] as const;

export function Leaderboard({ state, limit = 10 }: { state: GameState; limit?: number }) {
  // Mode adultes : un classement par camp, côte à côte.
  if (state.game.mode === "adultes") {
    return (
      <div className="grid w-full max-w-6xl grid-cols-2 gap-8">
        {CAMPS.map((c) => (
          <div key={c.gender} className="flex flex-col gap-3">
            <h2 className="text-center text-3xl font-bold">
              {c.icon} {c.label}
            </h2>
            <LeaderboardList
              entries={state.leaderboard.filter((p) => p.gender === c.gender)}
              limit={limit}
            />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      <LeaderboardList entries={state.leaderboard} limit={limit} />
    </div>
  );
}

function LeaderboardList({ entries, limit }: { entries: GameState["leaderboard"]; limit: number }) {
  if (!entries.length) return <p className="text-xgrey text-center">Personne</p>;
  return (
    <div className="flex flex-col gap-2">
      {entries.slice(0, limit).map((p, i) => (
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

// Fin du mode adultes : la gagnante et le gagnant, puis les deux classements.
function EndAdultsView({ state }: { state: GameState }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 p-10">
      <Kicker>Classement final</Kicker>
      <h1 className="text-7xl font-bold">Joyeux Noël ! 🎄</h1>
      <div className="flex items-end gap-16">
        {CAMPS.map((c, k) => {
          const camp = state.leaderboard.filter((p) => p.gender === c.gender);
          const winners = camp.filter((p) => p.rank === 1 && p.total > 0);
          return (
            <div
              key={c.gender}
              className="animate-pop flex w-80 flex-col items-center gap-3"
              style={{ animationDelay: `${k * 500}ms` }}
            >
              <p className="text-xgold text-2xl font-semibold">
                🏆 {c.winner}
                {winners.length > 1 ? "s ex aequo" : ""} · {c.label}
              </p>
              {winners.length ? (
                winners.map((w) => (
                  <div key={w.id} className="flex flex-col items-center gap-2">
                    <Avatar color={w.color} size={110} />
                    <p className="text-5xl font-bold">{w.name}</p>
                    <p className="text-xgrey text-xl">{formatPoints(w.total)} pts</p>
                  </div>
                ))
              ) : (
                <p className="text-xgrey text-xl">Personne</p>
              )}
            </div>
          );
        })}
      </div>
      <Leaderboard state={state} limit={20} />
    </main>
  );
}

function LeaderboardView({ state, act }: { state: GameState; act: Act }) {
  const q = state.question;
  const r = state.round;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-10">
      <Kicker>
        {r && q
          ? state.game.lastInRound
            ? `Fin de l'épreuve ${r.title}`
            : `${r.title} · après ${q.indexInRound + 1} question${q.indexInRound ? "s" : ""}`
          : ""}
      </Kicker>
      <h1 className="text-6xl font-bold">Classement</h1>
      <Leaderboard state={state} />
      <Button onClick={() => void act("next")}>{nextLabel(state)}</Button>
    </main>
  );
}

function EndView({ state }: { state: GameState }) {
  if (state.game.mode === "adultes") return <EndAdultsView state={state} />;
  const podium = state.leaderboard.slice(0, 3);
  const boxOf = new Map(state.boxes?.picks.map((p) => [p.playerId, p.box]) ?? []);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-10">
      <Kicker>Classement final</Kicker>
      <h1 className="text-7xl font-bold">Joyeux Noël ! 🎄</h1>
      <div className="flex items-end gap-6">
        {[1, 0, 2].map((i) => {
          const p = podium[i];
          if (!p) return <div key={i} className="w-48" />;
          const h = i === 0 ? 200 : i === 1 ? 150 : 110;
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
      <div className="flex w-full max-w-3xl flex-col gap-2">
        {state.leaderboard.map((p) => (
          <div key={p.id} className="flex items-center gap-4 rounded-2xl bg-white/5 px-5 py-2">
            <span className="text-xgrey w-8 text-2xl font-bold">{p.rank}</span>
            <PlayerChip name={p.name} color={p.color} />
            <span className="flex-1" />
            {boxOf.has(p.id) && <span className="text-xl font-semibold">🎁 box {boxOf.get(p.id)}</span>}
            <span className="w-36 text-right text-xl font-bold">{formatPoints(p.total)} pts</span>
          </div>
        ))}
      </div>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="text-xgrey flex min-h-dvh items-center justify-center p-6 text-center text-2xl">{children}</div>;
}
