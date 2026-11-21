// POST /api/games/:code/box — le joueur dont c'est le tour choisit une box.
import { assertPlayer, getGame, pickBox } from "@/lib/game-server";
import { handle, ok, readJson } from "@/lib/http";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<{ playerId?: string; token?: string; box?: number }>(req);
  const game = await getGame(code);
  const player = await assertPlayer(game, body.playerId, body.token);
  await pickBox(game, player.id, Number(body.box));
  return ok({ ok: true });
});
