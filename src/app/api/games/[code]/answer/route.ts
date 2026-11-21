// POST /api/games/:code/answer — un joueur répond à la question en cours.
// La justesse est vérifiée ici (le téléphone ne connaît jamais la bonne réponse),
// le chrono et les points sont calculés par la base (submit_answer).
// Juste prix : « choice » est le prix proposé (euros) ; les points sont
// distribués à la fermeture de la question (close_price_question).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertPlayer, getGame } from "@/lib/game-server";
import { getProgramme, isPrice } from "@/lib/content";
import { handle, ok, readJson, HttpError } from "@/lib/http";

const REASONS: Record<string, string> = {
  closed: "La question est fermée",
  late: "Trop tard !",
  duplicate: "Tu as déjà répondu",
  unknown_game: "Partie introuvable",
};

const MAX_PRICE = 1_000_000;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<{ playerId?: string; token?: string; questionIndex?: number; choice?: number }>(req);
  const game = await getGame(code);
  const player = await assertPlayer(game, body.playerId, body.token);

  const qi = Number(body.questionIndex);
  const src = getProgramme(game.quiz_id).flat[qi]?.q;
  const choice = Number(body.choice);
  if (!src || !Number.isInteger(choice) || choice < 0) throw new HttpError(400, "Réponse invalide");
  if (isPrice(src) ? choice > MAX_PRICE : choice >= src.choices.length) throw new HttpError(400, "Réponse invalide");

  const { data, error } = await supabaseAdmin().rpc("submit_answer", {
    p_game: game.id,
    p_player: player.id,
    p_index: qi,
    p_choice: choice,
    p_correct: isPrice(src) ? false : choice === src.correct,
  });
  if (error) throw error;
  const res = (data as { ok: boolean; reason: string; elapsed_ms: number }[])[0];
  if (!res?.ok) throw new HttpError(409, REASONS[res?.reason] ?? "Réponse refusée");
  return ok({ ok: true, elapsedMs: res.elapsed_ms });
});
