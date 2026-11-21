"use client";
// Panneau animateur (bouton ⚙ en bas à droite) : tests et plan B.
//  - bots de test, relancer une question, points à la main, exclure un joueur,
//  - lien animateur (reprendre la partie sur un autre écran), remise à zéro.
import { useState } from "react";
import { Avatar, formatPoints } from "@/components/ui";
import type { GameState } from "@/lib/types";

type Act = (action: string, extra?: Record<string, unknown>) => Promise<void>;

export default function HostPanel({
  state,
  act,
  code,
  token,
  error,
}: {
  state: GameState;
  act: Act;
  code: string;
  token: string;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const phase = state.game.phase;

  async function copyHostLink() {
    const url = `${window.location.origin}/host/${code}?t=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Lien animateur (à garder secret) :", url);
    }
  }

  function confirmThen(msg: string, fn: () => void) {
    // Pas de confirm() natif (bloquant) : double clic de sécurité.
    if (pending === msg) {
      setPending(null);
      fn();
    } else {
      setPending(msg);
      setTimeout(() => setPending((p) => (p === msg ? null : p)), 3000);
    }
  }
  const [pending, setPending] = useState<string | null>(null);

  return (
    <>
      {error && (
        <div className="bg-xred fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full px-6 py-3 font-semibold shadow-lg">
          {error}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Panneau animateur"
        className="fixed right-5 bottom-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-2xl opacity-40 transition hover:opacity-100"
      >
        ⚙
      </button>
      {open && (
        <aside className="bg-card fixed top-0 right-0 z-40 flex h-dvh w-[400px] flex-col gap-5 overflow-y-auto border-l border-white/10 p-6 shadow-2xl">
          <div>
            <h2 className="text-2xl font-bold">Animateur</h2>
            <p className="text-xgrey text-sm">
              Partie {code} · phase « {phase} » · question {state.game.questionIndex + 1}/{state.game.totalQuestions}
            </p>
          </div>

          <Section title="Partie">
            <Small onClick={copyHostLink}>{copied ? "Lien copié ✓" : "Copier le lien animateur"}</Small>
            {(phase === "question" || phase === "results") && (
              <Small onClick={() => confirmThen("restart", () => void act("restart-question"))}>
                {pending === "restart" ? "Confirmer ?" : "Relancer la question"}
              </Small>
            )}
            {phase === "question" && (
              <Small onClick={() => void act("close", { questionIndex: state.game.questionIndex })}>
                Fermer la question
              </Small>
            )}
            {phase !== "end" && phase !== "lobby" && (
              <Small onClick={() => confirmThen("end", () => void act("end"))}>
                {pending === "end" ? "Confirmer ?" : "Terminer la partie"}
              </Small>
            )}
            <Small onClick={() => confirmThen("reset", () => void act("reset"))}>
              {pending === "reset" ? "Confirmer ? (efface les points)" : "Remettre à zéro"}
            </Small>
          </Section>

          <Section title="Tests">
            <Small onClick={() => void act("add-bots", { count: 6 })}>+ 6 bots</Small>
            <Small onClick={() => void act("remove-bots")}>Retirer les bots</Small>
          </Section>

          <Section title="Points à la main (plan B)">
            <div className="flex flex-col gap-2">
              {state.leaderboard.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Avatar color={p.color} size={24} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="text-xgold shrink-0 text-right text-sm">{formatPoints(p.total)}</span>
                  <Tiny onClick={() => void act("adjust", { playerId: p.id, points: -500 })}>−500</Tiny>
                  <Tiny onClick={() => void act("adjust", { playerId: p.id, points: 500 })}>+500</Tiny>
                  <Tiny onClick={() => void act("adjust", { playerId: p.id, points: 1000 })}>+1000</Tiny>
                  <Tiny
                    onClick={() => confirmThen(`kick-${p.id}`, () => void act("kick", { playerId: p.id }))}
                    danger
                  >
                    {pending === `kick-${p.id}` ? "?" : "✕"}
                  </Tiny>
                </div>
              ))}
              {state.leaderboard.length === 0 && <p className="text-xgrey text-sm">Aucun joueur.</p>}
            </div>
          </Section>
        </aside>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xgold text-sm font-semibold uppercase">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Small({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
      {children}
    </button>
  );
}

function Tiny({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2 py-1 text-xs font-semibold ${danger ? "bg-xred/40" : "bg-white/10"} hover:bg-white/20`}
    >
      {children}
    </button>
  );
}
