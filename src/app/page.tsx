"use client";
// Accueil : créer une partie (télé) ou en reprendre une, ou rejoindre (téléphone).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Kicker } from "@/components/ui";
import { hostStore } from "@/lib/storage";
import { postJson } from "@/hooks/useGameState";

export default function Home() {
  const router = useRouter();
  const [isTest, setIsTest] = useState(true);
  const [mode, setMode] = useState<"enfants" | "adultes">("enfants");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => setRecent(hostStore.list()), []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { code, hostToken } = await postJson<{ code: string; hostToken: string }>("/api/games", { isTest, mode });
      hostStore.set(code, hostToken);
      router.push(`/host/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 p-6 text-center">
      <Kicker>Noël 2026</Kicker>
      <h1 className="text-5xl font-bold sm:text-7xl">La Pinata de Noël</h1>

      <div className="flex w-full flex-col gap-4 sm:flex-row">
        <section className="bg-card border-xred flex flex-1 flex-col gap-4 rounded-3xl border-4 p-6 text-left">
          <p className="text-xred text-sm font-semibold">SUR LA TÉLÉ</p>
          <h2 className="text-3xl font-bold">Animer une partie</h2>
          <div className="grid grid-cols-2 gap-2 rounded-full bg-white/8 p-1">
            {(
              [
                ["enfants", "🧒 Enfants"],
                ["adultes", "🍷 Adultes"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-2 font-semibold ${mode === m ? "bg-white text-ink" : "text-xgrey"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xgrey -mt-2 text-sm">
            {mode === "enfants"
              ? "Quiz, blind test, mémoire, juste prix, qui est-ce, finale et box."
              : "Blind test, quiz de Noël, bébé mystère · classements femmes / hommes."}
          </p>
          <label className="text-xgrey flex items-center gap-3">
            <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} className="h-5 w-5" />
            Partie de test
          </label>
          <Button onClick={create} disabled={busy}>
            {busy ? "Création…" : "Créer une partie"}
          </Button>
          {error && <p className="text-xred">{error}</p>}
          {recent.length > 0 && (
            <div className="text-xgrey">
              <p className="mb-2 text-sm">Reprendre une partie :</p>
              <div className="flex flex-wrap gap-2">
                {recent.map((c) => (
                  <Link key={c} href={`/host/${c}`} className="rounded-full bg-white/10 px-4 py-2 font-semibold text-white">
                    {c}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="bg-card border-xgreen flex flex-1 flex-col gap-4 rounded-3xl border-4 p-6 text-left">
          <p className="text-xgreen text-sm font-semibold">SUR TON TÉLÉPHONE</p>
          <h2 className="text-3xl font-bold">Rejoindre une partie</h2>
          <p className="text-xgrey">Scanne le QR code sur la télé, ou entre le code de la partie.</p>
          <Link href="/play" className="bg-xgreen rounded-full px-8 py-4 text-center text-xl font-bold">
            Rejoindre
          </Link>
        </section>
      </div>
    </main>
  );
}
