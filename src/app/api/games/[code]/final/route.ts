// POST /api/games/:code/final — un joueur appuie sur un bouton de la finale.
// Tout (tour, bouton déjà pris, bombe, élimination, points) est vérifié par la base.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertPlayer, getGame } from "@/lib/game-server";
import { getProgramme } from "@/lib/content";
import { handle, ok, readJson, HttpError } from "@/lib/http";

const REASONS: Record<string, string> = {
  not_final: "La finale n'est pas en cours",
  not_your_turn: "Ce n'est pas ton tour",
  bad_button: "Bouton inconnu",
  already_pressed: "Ce bouton est déjà pris",
};

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<{ playerId?: string; token?: string; idx?: number }>(req);
  const game = await getGame(code);
  const player = await assertPlayer(game, body.playerId, body.token);
  const final = getProgramme(game.quiz_id).final;
  const idx = Number(body.idx);
  if (!final || !Number.isInteger(idx)) throw new HttpError(400, "Bouton invalide");

  const { data, error } = await supabaseAdmin().rpc("press_button", {
    p_game: game.id,
    p_player: player.id,
    p_idx: idx,
    p_win: final.winPoints,
    p_second: final.secondPoints,
  });
  if (error) throw error;
  const res = (data as { ok: boolean; reason: string; bomb: boolean; finished: boolean }[])[0];
  if (!res?.ok) throw new HttpError(409, REASONS[res?.reason] ?? "Bouton refusé");
  return ok({ ok: true, bomb: res.bomb, finished: res.finished });
});
