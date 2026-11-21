// POST /api/games/:code/answer — un joueur répond à la question en cours.
// La justesse est vérifiée ici (le téléphone ne connaît jamais la bonne réponse),
// le chrono et les points sont calculés par la base (submit_answer).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertPlayer, getGame } from "@/lib/game-server";
import { getQuiz } from "@/lib/content";
import { handle, ok, readJson, HttpError } from "@/lib/http";

const REASONS: Record<string, string> = {
  closed: "La question est fermée",
  late: "Trop tard !",
  duplicate: "Tu as déjà répondu",
  unknown_game: "Partie introuvable",
};

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<{ playerId?: string; token?: string; questionIndex?: number; choice?: number }>(req);
  const game = await getGame(code);
  const player = await assertPlayer(game, body.playerId, body.token);

  const quiz = getQuiz(game.quiz_id);
  const qi = Number(body.questionIndex);
  const question = quiz.questions[qi];
  const choice = Number(body.choice);
  if (!question || !Number.isInteger(choice) || choice < 0 || choice >= question.choices.length) {
    throw new HttpError(400, "Réponse invalide");
  }

  const { data, error } = await supabaseAdmin().rpc("submit_answer", {
    p_game: game.id,
    p_player: player.id,
    p_index: qi,
    p_choice: choice,
    p_correct: choice === question.correct,
  });
  if (error) throw error;
  const res = (data as { ok: boolean; reason: string; elapsed_ms: number }[])[0];
  if (!res?.ok) throw new HttpError(409, REASONS[res?.reason] ?? "Réponse refusée");
  return ok({ ok: true, elapsedMs: res.elapsed_ms });
});
