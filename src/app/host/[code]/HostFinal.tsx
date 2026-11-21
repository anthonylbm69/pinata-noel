"use client";
// Télé : finale « bouton de la mort » et choix des box.
import { Avatar, Button, Kicker, PlayerChip, formatPoints } from "@/components/ui";
import type { GameState } from "@/lib/types";
import type { Act } from "./HostScreen";

function usePlayers(state: GameState) {
  return new Map(state.players.map((p) => [p.id, p]));
}

export function FinalView({ state, act }: { state: GameState; act: Act }) {
  const f = state.final;
  const byId = usePlayers(state);
  if (!f) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-xgrey text-3xl">Préparation de la finale…</p>
      </main>
    );
  }
  const turn = f.turn ? byId.get(f.turn) : null;
  const winners = f.order.filter((o) => o.place === 1).map((o) => byId.get(o.id)).filter(Boolean);
  const outs = f.order.filter((o) => o.out).sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const second = f.finished ? outs[0] : undefined;

  return (
    <main className="flex min-h-dvh gap-10 p-10">
      <section className="flex flex-1 flex-col items-center gap-6">
        <Kicker>Finale · le bouton de la mort 💣</Kicker>
        {f.finished ? (
          <div className="animate-pop flex flex-col items-center gap-3 text-center">
            <h1 className="text-6xl font-bold">
              🏆 {winners.map((w) => w!.name).join(" & ")} {winners.length > 1 ? "survivent" : "survit"} !
            </h1>
            <p className="text-xgold text-3xl font-semibold">
              +{formatPoints(f.winPoints)} pts
              {second && byId.get(second.id) ? ` · ${byId.get(second.id)!.name} 2e : +${formatPoints(f.secondPoints)} pts` : ""}
            </p>
          </div>
        ) : (
          <h1 className="flex items-center gap-4 text-6xl font-bold">
            {turn && <Avatar color={turn.color} size={64} />}
            {turn ? `Au tour de ${turn.name}` : "…"}
          </h1>
        )}
        <p className="text-xgrey text-2xl">
          {f.bombsLeft} bombe{f.bombsLeft > 1 ? "s" : ""} encore cachée{f.bombsLeft > 1 ? "s" : ""} · le dernier survivant gagne
        </p>
        <div className="grid grid-cols-5 gap-4">
          {f.buttons.map((b) => {
            const who = b.by ? byId.get(b.by) : null;
            return (
              <button
                key={b.idx}
                disabled={b.pressed || f.finished}
                onClick={() => void act("final-press", { idx: b.idx })}
                title="Appuyer à la place du joueur (plan B)"
                className={`flex h-28 w-36 flex-col items-center justify-center rounded-3xl text-4xl font-bold transition ${
                  !b.pressed
                    ? "bg-xred shadow-[0_8px_0_rgba(0,0,0,0.35)] hover:brightness-110"
                    : b.bomb
                      ? "animate-pop bg-black/60 ring-xred ring-4"
                      : "animate-pop bg-white/10"
                }`}
              >
                {!b.pressed ? b.idx + 1 : b.bomb ? "💥" : "✓"}
                {who && <span className="mt-1 text-sm font-semibold" style={{ color: who.color }}>{who.name}</span>}
              </button>
            );
          })}
        </div>
        {f.finished && <Button onClick={() => void act("next")}>Choisir les box 🎁 →</Button>}
      </section>
      <aside className="flex w-[360px] flex-col gap-3 rounded-[28px] bg-white/5 p-7">
        <h2 className="text-3xl font-bold">Ordre de passage</h2>
        {f.order.map((o) => {
          const p = byId.get(o.id);
          if (!p) return null;
          return (
            <div key={o.id} className="flex items-center justify-between gap-3">
              <PlayerChip name={p.name} color={p.color} dim={o.out} highlight={o.id === f.turn} />
              <span className="text-xl">{o.out ? "💥" : o.place === 1 ? "🏆" : ""}</span>
            </div>
          );
        })}
      </aside>
    </main>
  );
}

export function BoxesView({ state, act }: { state: GameState; act: Act }) {
  const b = state.boxes;
  const byId = usePlayers(state);
  if (!b) return null;
  const owner = new Map(b.picks.map((p) => [p.box, p.playerId]));
  const current = b.current ? byId.get(b.current) : null;
  const done = !b.current;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 p-10 text-center">
      <Kicker>Le classement donne l&apos;ordre de choix</Kicker>
      {done ? (
        <h1 className="animate-pop text-7xl font-bold">Tout le monde a sa box ! 🎉</h1>
      ) : (
        <h1 className="flex items-center gap-5 text-7xl font-bold">
          {current && <Avatar color={current.color} size={72} />}
          {current?.name} choisit sa box
        </h1>
      )}
      <div className="flex flex-wrap justify-center gap-6">
        {Array.from({ length: b.count }, (_, i) => i + 1).map((n) => {
          const who = owner.get(n) ? byId.get(owner.get(n)!) : null;
          return (
            <button
              key={n}
              disabled={!!owner.get(n) || done}
              onClick={() => b.current && void act("pick-box", { playerId: b.current, box: n })}
              title="Choisir à la place du joueur (plan B)"
              className={`flex h-48 w-40 flex-col items-center justify-center gap-2 rounded-3xl text-7xl font-bold transition ${
                who ? "animate-pop opacity-60" : "bg-xred shadow-[0_10px_0_rgba(0,0,0,0.35)] hover:brightness-110"
              }`}
              style={who ? { background: who.color } : undefined}
            >
              {who ? `🎁 ${n}` : n}
              {who && <span className="text-lg font-semibold">{who.name}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {b.order.map((id, i) => {
          const p = byId.get(id);
          if (!p) return null;
          const hasBox = b.picks.some((x) => x.playerId === id);
          return (
            <PlayerChip key={id} name={`${i + 1}. ${p.name}`} color={p.color} dim={hasBox} highlight={id === b.current} />
          );
        })}
      </div>
      {done && <Button onClick={() => void act("next")}>Terminer 🎄</Button>}
    </main>
  );
}
