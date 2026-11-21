// GET /api/games/:code/state?host=TOKEN            → état pour la télé
// GET /api/games/:code/state?player=ID&token=TOKEN → état pour un téléphone
import { assertHost, assertPlayer, buildState, getGame } from "@/lib/game-server";
import { handle, ok, HttpError } from "@/lib/http";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const url = new URL(req.url);
  const game = await getGame(code);

  const hostToken = url.searchParams.get("host");
  if (hostToken) {
    await assertHost(game, hostToken);
    return ok(await buildState(game, { role: "host" }));
  }

  const playerId = url.searchParams.get("player");
  const token = url.searchParams.get("token");
  if (playerId && token) {
    const p = await assertPlayer(game, playerId, token);
    return ok(await buildState(game, { role: "player", playerId: p.id }));
  }

  throw new HttpError(401, "Identification requise");
});
