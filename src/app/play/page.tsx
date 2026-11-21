"use client";
// Téléphone : rejoindre une partie (code + prénom + couleur).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Kicker, PLAYER_COLORS } from "@/components/ui";
import { playerStore } from "@/lib/storage";
import { postJson } from "@/hooks/useGameState";

type Gender = "F" | "H";

export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(PLAYER_COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [gender, setGender] = useState<Gender | null>(null);
  // mode de la partie (adultes → on demande le camp), lu dès que le code est tapé
  const [mode, setMode] = useState<{ code: string; adultes: boolean } | null>(null);
  const adultes = mode?.code === code && mode.adultes;
  const [error, setError] = useState<string | null>(null);

  // Code pré-rempli depuis le QR (?code=1234). Si déjà inscrit → reconnexion directe.
  // (Next garde l'état des pages quittées : en revenant ici, par exemple après
  // une exclusion, le bouton ne doit pas rester bloqué sur « Connexion… ».)
  useEffect(() => {
    setBusy(false);
    const c = new URLSearchParams(window.location.search).get("code")?.replace(/\D/g, "") ?? "";
    if (!c) return;
    setCode(c);
    if (playerStore.get(c)) router.replace(`/play/${c}`);
  }, [router]);

  useEffect(() => {
    if (code.length < 4) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/games/${code}/join`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { mode?: string } | null) => d && setMode({ code, adultes: d.mode === "adultes" }))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [code]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<{ playerId: string; token: string; name: string; color: string }>(
        `/api/games/${code}/join`,
        { name, color, gender: adultes ? gender : undefined },
      );
      playerStore.set(code, res);
      router.push(`/play/${code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 p-6 pt-12">
      <div className="text-center">
        <Kicker>La Pinata de Noël</Kicker>
        <h1 className="mt-2 text-4xl font-bold">Rejoins la partie</h1>
        <p className="text-xgrey mt-1">Le code est affiché sur la télé</p>
      </div>

      <form onSubmit={join} className="flex flex-1 flex-col gap-4">
        <label className="text-xgrey text-sm font-medium">
          Code de la partie
          <input
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1 w-full rounded-2xl border-2 border-white/20 bg-white/8 px-5 py-4 text-2xl font-semibold text-white outline-none focus:border-xgold"
            placeholder="4821"
          />
        </label>
        <label className="text-xgrey text-sm font-medium">
          Ton prénom
          <input
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-white/20 bg-white/8 px-5 py-4 text-2xl font-semibold text-white outline-none focus:border-xgold"
            placeholder="Inès"
          />
        </label>
        <div>
          <p className="text-xgrey mb-2 text-sm font-medium">Ta couleur</p>
          <div className="flex flex-wrap gap-3">
            {PLAYER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                onClick={() => setColor(c)}
                className={`h-11 w-11 rounded-full ${color === c ? "ring-4 ring-white" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        {adultes && (
          <div>
            <p className="text-xgrey mb-2 text-sm font-medium">Ton camp (un classement par camp)</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["F", "👩 Femmes"],
                  ["H", "👨 Hommes"],
                ] as const
              ).map(([g, label]) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`rounded-2xl border-2 px-4 py-4 text-xl font-bold ${
                    gender === g ? "border-xgold bg-white/15" : "border-white/20 bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-xred text-center font-semibold">{error}</p>}
        <div className="flex-1" />
        <Button type="submit" disabled={busy || code.length < 4 || !name.trim() || (adultes && !gender)} className="w-full">
          {busy ? "Connexion…" : "C'est parti !"}
        </Button>
      </form>
    </main>
  );
}
