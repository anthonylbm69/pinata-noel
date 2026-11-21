// Logique de partie côté serveur : chargement, authentification, état.
import { supabaseAdmin } from "./supabase-admin";
import { getQuiz } from "./content";
import { HttpError } from "./http";
import type { GameState, LeaderboardEntry, Mode, Phase, PublicPlayer, ResultLine } from "./types";

export interface GameRow {
  id: string;
  code: string;
  mode: Mode;
  quiz_id: string;
  phase: Phase;
  question_index: number;
  question_opened_at: string | null;
  question_time_limit_ms: number;
  status: string;
  is_test: boolean;
  version: number;
}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  is_bot: boolean;
  device_token: string;
  created_at: string;
}

interface AnswerRow {
  player_id: string;
  question_index: number;
  choice: number;
  is_correct: boolean;
  elapsed_ms: number;
  points: number;
}

export function normalizeCode(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 6);
}

export async function getGame(code: string): Promise<GameRow> {
  const { data, error } = await supabaseAdmin()
    .from("games")
    .select("*")
    .eq("code", normalizeCode(code))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Partie introuvable");
  return data as GameRow;
}

export async function assertHost(game: GameRow, token: unknown) {
  if (typeof token !== "string" || !token) throw new HttpError(401, "Jeton animateur manquant");
  const { data, error } = await supabaseAdmin()
    .from("game_secrets")
    .select("host_token")
    .eq("game_id", game.id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.host_token !== token) throw new HttpError(401, "Jeton animateur invalide");
}

export async function assertPlayer(game: GameRow, playerId: unknown, token: unknown): Promise<PlayerRow> {
  if (typeof playerId !== "string" || typeof token !== "string") {
    throw new HttpError(401, "Joueur non identifié");
  }
  const { data, error } = await supabaseAdmin()
    .from("players")
    .select("*")
    .eq("game_id", game.id)
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.device_token !== token) throw new HttpError(401, "Joueur introuvable");
  return data as PlayerRow;
}

export async function bump(gameId: string) {
  const { error } = await supabaseAdmin().rpc("bump_game", { p_game: gameId });
  if (error) throw error;
}

function toPublic(p: PlayerRow): PublicPlayer {
  return { id: p.id, name: p.name, color: p.color, isBot: p.is_bot };
}

/** Construit l'état envoyé à la télé (role host) ou à un joueur. */
export async function buildState(
  game: GameRow,
  viewer: { role: "host" } | { role: "player"; playerId: string },
): Promise<GameState> {
  const db = supabaseAdmin();
  const quiz = getQuiz(game.quiz_id);

  const [playersRes, answersRes, adjRes] = await Promise.all([
    db.from("players").select("*").eq("game_id", game.id).order("created_at"),
    db
      .from("answers")
      .select("player_id, question_index, choice, is_correct, elapsed_ms, points")
      .eq("game_id", game.id),
    db.from("adjustments").select("player_id, points").eq("game_id", game.id),
  ]);
  if (playersRes.error) throw playersRes.error;
  if (answersRes.error) throw answersRes.error;
  if (adjRes.error) throw adjRes.error;

  const players = (playersRes.data ?? []) as PlayerRow[];
  const answers = (answersRes.data ?? []) as AnswerRow[];
  const adjustments = (adjRes.data ?? []) as { player_id: string; points: number }[];

  // Classement cumulé = somme des points des réponses + ajustements manuels.
  const totals = new Map<string, number>(players.map((p) => [p.id, 0]));
  for (const a of answers) totals.set(a.player_id, (totals.get(a.player_id) ?? 0) + a.points);
  for (const a of adjustments) totals.set(a.player_id, (totals.get(a.player_id) ?? 0) + a.points);

  const sorted = [...players].sort(
    (a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || a.name.localeCompare(b.name, "fr"),
  );
  const leaderboard: LeaderboardEntry[] = [];
  sorted.forEach((p, i) => {
    const total = totals.get(p.id) ?? 0;
    const prev = leaderboard[i - 1];
    const rank = prev && prev.total === total ? prev.rank : i + 1;
    leaderboard.push({ ...toPublic(p), total, rank });
  });

  const qi = game.question_index;
  const q = qi >= 0 ? quiz.questions[qi] : undefined;
  const showQuestion = !!q && (game.phase === "question" || game.phase === "results" || game.phase === "leaderboard");
  const current = answers.filter((a) => a.question_index === qi);

  let results: GameState["results"] = null;
  if (q && game.phase === "results") {
    const distribution = q.choices.map((_, i) => current.filter((a) => a.choice === i).length);
    const lines: ResultLine[] = players.map((p) => {
      const a = current.find((x) => x.player_id === p.id);
      return {
        ...toPublic(p),
        answered: !!a,
        choice: a?.choice ?? null,
        isCorrect: a?.is_correct ?? false,
        points: a?.points ?? 0,
        elapsedMs: a?.elapsed_ms ?? null,
      };
    });
    lines.sort(
      (a, b) =>
        b.points - a.points ||
        Number(b.answered) - Number(a.answered) ||
        (a.elapsedMs ?? 1e9) - (b.elapsedMs ?? 1e9),
    );
    results = { correct: q.correct, distribution, lines };
  }

  let me: GameState["me"] = null;
  if (viewer.role === "player") {
    const p = players.find((x) => x.id === viewer.playerId);
    if (!p) throw new HttpError(401, "Joueur introuvable");
    const mine = current.find((a) => a.player_id === p.id);
    const revealed = game.phase !== "question";
    const lb = leaderboard.find((x) => x.id === p.id)!;
    me = {
      id: p.id,
      name: p.name,
      color: p.color,
      total: lb.total,
      rank: lb.rank,
      current: mine
        ? {
            choice: mine.choice,
            elapsedMs: mine.elapsed_ms,
            isCorrect: revealed ? mine.is_correct : null,
            points: revealed ? mine.points : null,
          }
        : null,
    };
  }

  return {
    game: {
      code: game.code,
      mode: game.mode,
      phase: game.phase,
      quizTitle: quiz.title,
      questionIndex: qi,
      totalQuestions: quiz.questions.length,
      timeLimitMs: game.question_time_limit_ms,
      openedAt: game.question_opened_at,
      isTest: game.is_test,
      version: game.version,
    },
    serverNow: Date.now(),
    players: players.map(toPublic),
    question: showQuestion && q ? { index: qi, text: q.text, choices: q.choices } : null,
    answeredCount: current.length,
    answeredPlayerIds: current.map((a) => a.player_id),
    results,
    leaderboard,
    me,
  };
}
