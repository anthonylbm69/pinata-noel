import type { FlatQuestion, PriceQuestion, Programme, Round } from "./types";
import quizTonton from "@/content/quiz-tonton.json";
import blindtest from "@/content/blindtest.json";
import blindtestAdultes from "@/content/blindtest-adultes.json";
import memoire from "@/content/memoire.json";
import justeprix from "@/content/justeprix.json";
import quiestce from "@/content/quiestce.json";
import quizNoel from "@/content/quiz-noel.json";
import bebeMystere from "@/content/bebe-mystere.json";
import programmeEnfants from "@/content/programme-enfants.json";
import programmeAdultes from "@/content/programme-adultes.json";

// Le contenu des épreuves vit dans src/content/*.json (séparé du code).
// Pour ajouter une épreuve : créer le JSON, l'enregistrer ici, puis l'ajouter
// à la liste "rounds" d'un programme.
const ROUNDS: Record<string, Round> = Object.fromEntries(
  ([quizTonton, blindtest, blindtestAdultes, memoire, justeprix, quiestce, quizNoel, bebeMystere] as Round[]).map((r) => [r.id, r]),
);

const PROGRAMMES: Record<string, Programme> = {
  [programmeEnfants.id]: programmeEnfants as Programme,
  [programmeAdultes.id]: programmeAdultes as Programme,
};

export const DEFAULT_PROGRAMME_ID = programmeEnfants.id;
/** Programme joué selon le mode choisi à la création de la partie. */
export const programmeIdFor = (mode: "enfants" | "adultes") =>
  mode === "adultes" ? programmeAdultes.id : programmeEnfants.id;

export interface LoadedProgramme extends Programme {
  roundList: Round[];
  flat: FlatQuestion[];
  /** index global de la première question de chaque épreuve */
  firstOfRound: number[];
}

const cache = new Map<string, LoadedProgramme>();

export function getProgramme(id: string): LoadedProgramme {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = PROGRAMMES[id];
  if (!p) throw new Error(`Programme inconnu : ${id}`);
  const roundList = p.rounds.map((rid) => {
    const r = ROUNDS[rid];
    if (!r) throw new Error(`Épreuve inconnue : ${rid}`);
    return r;
  });
  const flat: FlatQuestion[] = [];
  const firstOfRound: number[] = [];
  roundList.forEach((r, roundIndex) => {
    firstOfRound.push(flat.length);
    r.questions.forEach((q, indexInRound) =>
      flat.push({
        roundIndex,
        indexInRound,
        kind: r.type === "justeprix" ? "price" : "choice",
        timeLimitMs: r.timeLimitMs,
        q,
      }),
    );
  });
  const loaded = { ...p, roundList, flat, firstOfRound };
  cache.set(id, loaded);
  return loaded;
}

export function isPrice(q: FlatQuestion["q"]): q is PriceQuestion {
  return "price" in q;
}

/** Barème du juste prix : rang parmi ceux qui n'ont pas dépassé. */
export const PRICE_SCALE = [1000, 700, 500, 350, 250, 150, 100];
