// Logique de partie côté serveur : chargement, authentification, état.
import { supabaseAdmin } from "./supabase-admin";
import { getProgramme, isPrice } from "./content";
import { HttpError } from "./http";
import type {
  BoxesState,
  FinalState,
  GameState,
  LeaderboardEntry,
  Mode,
  Phase,
  PublicPlayer,
  PublicQuestion,
  PublicRound,
  ResultLine,
} from "./types";

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
  final_turn: string | null;
  box_count: number;
}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  is_bot: boolean;
  claimable: boolean;
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
  return { id: p.id, name: p.name, color: p.color, isBot: p.is_bot, released: !!p.claimable };
}

type Q<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
const none = <T,>(): Q<T> => Promise.resolve({ data: [] as T[], error: null });

/** Classement cumulé = somme des points des réponses + ajustements manuels. */
export async function computeLeaderboard(game: GameRow): Promise<LeaderboardEntry[]> {
  const db = supabaseAdmin();
  const [pl, an, adj] = await Promise.all([
    db.from("players").select("*").eq("game_id", game.id),
    db.from("answers").select("player_id, question_index, points").eq("game_id", game.id),
    db.from("adjustments").select("player_id, points").eq("game_id", game.id),
  ]);
  for (const r of [pl, an, adj]) if (r.error) throw r.error;
  return rank(game, (pl.data ?? []) as PlayerRow[], (an.data ?? []) as AnswerRow[], adj.data ?? []);
}

function rank(
  game: GameRow,
  players: PlayerRow[],
  answers: Pick<AnswerRow, "player_id" | "question_index" | "points">[],
  adjustments: { player_id: string; points: number }[],
): LeaderboardEntry[] {
  const totals = new Map<string, number>(players.map((p) => [p.id, 0]));
  // Pendant une question, on n'y compte PAS ses points : sinon le total qui
  // bouge trahirait (sur le téléphone ou la télé) si la réponse est juste.
  for (const a of answers) {
    if (game.phase === "question" && a.question_index === game.question_index) continue;
    if (totals.has(a.player_id)) totals.set(a.player_id, totals.get(a.player_id)! + a.points);
  }
  for (const a of adjustments) {
    if (totals.has(a.player_id)) totals.set(a.player_id, totals.get(a.player_id)! + a.points);
  }
  const sorted = [...players].sort(
    (a, b) => totals.get(b.id)! - totals.get(a.id)! || a.name.localeCompare(b.name, "fr"),
  );
  const leaderboard: LeaderboardEntry[] = [];
  sorted.forEach((p, i) => {
    const total = totals.get(p.id)!;
    const prev = leaderboard[i - 1];
    leaderboard.push({ ...toPublic(p), total, rank: prev && prev.total === total ? prev.rank : i + 1 });
  });
  return leaderboard;
}

/** Ordre de choix des box : le classement, limité au nombre de box. */
export function boxOrder(game: GameRow, leaderboard: LeaderboardEntry[]) {
  return leaderboard.slice(0, game.box_count).map((p) => p.id);
}

/** Choix d'une box par le joueur dont c'est le tour (ou l'animateur à sa place). */
export async function pickBox(game: GameRow, playerId: string, box: number) {
  if (game.phase !== "boxes") throw new HttpError(409, "Ce n'est pas le moment de choisir une box");
  if (!Number.isInteger(box) || box < 1 || box > game.box_count) throw new HttpError(400, "Box invalide");
  const db = supabaseAdmin();
  const [lb, picksRes] = await Promise.all([
    computeLeaderboard(game),
    db.from("boxes").select("box_number, player_id").eq("game_id", game.id),
  ]);
  if (picksRes.error) throw picksRes.error;
  const picks = picksRes.data ?? [];
  const picked = new Set(picks.map((p) => p.player_id));
  const current = boxOrder(game, lb).find((id) => !picked.has(id));
  if (current !== playerId) throw new HttpError(409, "Ce n'est pas ton tour");
  if (picks.some((p) => p.box_number === box)) throw new HttpError(409, "Cette box est déjà prise");
  const { error } = await db.from("boxes").insert({ game_id: game.id, box_number: box, player_id: playerId });
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "Cette box vient d'être prise");
    throw error;
  }
  await bump(game.id);
}

/** Construit l'état envoyé à la télé (role host) ou à un joueur. */
export async function buildState(
  game: GameRow,
  viewer: { role: "host" } | { role: "player"; playerId: string },
): Promise<GameState> {
  const db = supabaseAdmin();
  const prog = getProgramme(game.quiz_id);
  const inFinal = game.phase === "final" || game.phase === "boxes" || game.phase === "end";
  const inBoxes = game.phase === "boxes" || game.phase === "end";

  type Btn = { idx: number; is_bomb: boolean; pressed_by: string | null; pressed_at: string | null };
  type Fp = { player_id: string; turn_order: number; out_at: string | null; place: number | null };
  type Box = { box_number: number; player_id: string };

  const [playersRes, answersRes, adjRes, nowRes, btnRes, fpRes, boxRes] = await Promise.all([
    db.from("players").select("*").eq("game_id", game.id).order("created_at"),
    db
      .from("answers")
      .select("player_id, question_index, choice, is_correct, elapsed_ms, points")
      .eq("game_id", game.id),
    db.from("adjustments").select("player_id, points").eq("game_id", game.id),
    // Heure de la BASE : c'est elle qui date l'ouverture des questions et les
    // réponses, donc le chrono des écrans doit se caler dessus (et pas sur
    // l'horloge du serveur Next, qui peut avoir plusieurs secondes d'écart).
    db.rpc("server_now_ms"),
    inFinal
      ? (db.from("final_buttons").select("idx, is_bomb, pressed_by, pressed_at").eq("game_id", game.id).order("idx") as unknown as Q<Btn>)
      : none<Btn>(),
    inFinal
      ? (db.from("final_players").select("player_id, turn_order, out_at, place").eq("game_id", game.id).order("turn_order") as unknown as Q<Fp>)
      : none<Fp>(),
    inBoxes ? (db.from("boxes").select("box_number, player_id").eq("game_id", game.id) as unknown as Q<Box>) : none<Box>(),
  ]);
  for (const r of [playersRes, answersRes, adjRes, nowRes, btnRes, fpRes, boxRes]) {
    if (r.error) throw r.error;
  }

  const players = (playersRes.data ?? []) as PlayerRow[];
  const answers = (answersRes.data ?? []) as AnswerRow[];
  const leaderboard = rank(game, players, answers, adjRes.data ?? []);

  const qi = game.question_index;
  const flat = qi >= 0 ? prog.flat[qi] : undefined;
  const isHost = viewer.role === "host";
  const inRound =
    game.phase === "intro" || game.phase === "question" || game.phase === "results" || game.phase === "leaderboard";

  // ---- Épreuve en cours ----
  let round: PublicRound | null = null;
  if (flat && inRound) {
    const r = prog.roundList[flat.roundIndex];
    round = {
      index: flat.roundIndex,
      total: prog.roundList.length,
      type: r.type,
      title: r.title,
      rules: r.rules,
      questionCount: r.questions.length,
      // Les objets à mémoriser ne sont montrés que pendant l'écran de présentation.
      // (et seulement à la télé : un téléphone ne doit pas pouvoir les relire).
      ...(game.phase === "intro" && r.objects ? { displayMs: r.displayMs } : {}),
      ...(game.phase === "intro" && r.objects && isHost ? { objects: r.objects } : {}),
    };
  }

  // ---- Question en cours (sans la bonne réponse) ----
  const showQuestion = !!flat && (game.phase === "question" || game.phase === "results" || game.phase === "leaderboard");
  let question: PublicQuestion | null = null;
  if (showQuestion && flat) {
    const src = flat.q;
    question = {
      index: qi,
      indexInRound: flat.indexInRound,
      kind: flat.kind,
      text: src.text,
      choices: isPrice(src) ? [] : src.choices,
      emoji: isPrice(src) ? src.emoji : undefined,
    };
    if (isHost) {
      // Le son et la photo ne passent que par la télé.
      if (src.image) question.image = src.image;
      if (!isPrice(src) && src.audio) {
        question.audio = src.audio;
        question.start = src.start ?? 0;
      }
    }
  }

  const current = answers.filter((a) => a.question_index === qi);

  let results: GameState["results"] = null;
  if (flat && game.phase === "results") {
    const src = flat.q;
    const price = isPrice(src) ? src.price : null;
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
    const gap = (l: ResultLine) => (price === null || l.choice === null ? 0 : Math.abs(price - l.choice));
    lines.sort(
      (a, b) =>
        b.points - a.points ||
        Number(b.answered) - Number(a.answered) ||
        gap(a) - gap(b) ||
        (a.elapsedMs ?? 1e9) - (b.elapsedMs ?? 1e9),
    );
    results = {
      kind: flat.kind,
      correct: isPrice(src) ? -1 : src.correct,
      price,
      distribution: isPrice(src) ? [] : src.choices.map((_, i) => current.filter((a) => a.choice === i).length),
      lines,
    };
  }

  // ---- Finale ----
  let final: FinalState | null = null;
  const btns = (btnRes.data ?? []) as Btn[];
  if (inFinal && prog.final && btns.length) {
    const present = new Set(players.map((p) => p.id));
    final = {
      // is_bomb n'est révélé que pour les boutons déjà appuyés.
      buttons: btns.map((b) => ({
        idx: b.idx,
        pressed: !!b.pressed_at,
        bomb: b.pressed_at ? b.is_bomb : null,
        by: b.pressed_by,
      })),
      order: ((fpRes.data ?? []) as Fp[])
        .filter((f) => present.has(f.player_id))
        .map((f) => ({ id: f.player_id, out: !!f.out_at, place: f.place })),
      turn: game.final_turn,
      finished: game.final_turn === null,
      bombsLeft: prog.final.bombs - btns.filter((b) => b.pressed_at && b.is_bomb).length,
      winPoints: prog.final.winPoints,
      secondPoints: prog.final.secondPoints,
    };
  }

  // ---- Box ----
  let boxes: BoxesState | null = null;
  if (inBoxes) {
    const picks = ((boxRes.data ?? []) as Box[]).map((b) => ({ box: b.box_number, playerId: b.player_id }));
    const order = boxOrder(game, leaderboard);
    const picked = new Set(picks.map((p) => p.playerId));
    boxes = { count: game.box_count, picks, order, current: order.find((id) => !picked.has(id)) ?? null };
  }

  let me: GameState["me"] = null;
  if (viewer.role === "player") {
    const p = players.find((x) => x.id === viewer.playerId);
    if (!p) throw new HttpError(401, "Joueur introuvable");
    const mine = showQuestion ? current.find((a) => a.player_id === p.id) : undefined;
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

  const lastInRound = !!flat && flat.indexInRound === prog.roundList[flat.roundIndex].questions.length - 1;

  return {
    game: {
      code: game.code,
      mode: game.mode,
      phase: game.phase,
      title: prog.title,
      questionIndex: qi,
      totalQuestions: prog.flat.length,
      // En intro, le « chrono » est la durée d'affichage des objets (mémoire).
      timeLimitMs: game.phase === "intro" ? (round?.displayMs ?? 0) : game.question_time_limit_ms,
      openedAt: game.question_opened_at,
      isTest: game.is_test,
      version: game.version,
      hasFinal: !!prog.final,
      lastInRound,
      lastQuestion: qi >= prog.flat.length - 1,
    },
    serverNow: Number(nowRes.data),
    players: players.map(toPublic),
    round,
    question,
    answeredCount: game.phase === "question" || game.phase === "results" ? current.length : 0,
    answeredPlayerIds: game.phase === "question" ? current.map((a) => a.player_id) : [],
    results,
    leaderboard,
    final,
    boxes,
    me,
  };
}
