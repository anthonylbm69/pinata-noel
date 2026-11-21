// POST /api/games/:code/join — rejoindre une partie (ou se reconnecter).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { bump, getGame } from "@/lib/game-server";
import { handle, ok, readJson, HttpError } from "@/lib/http";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<{ name?: string; color?: string; playerId?: string; token?: string }>(req);
  const game = await getGame(code);
  const db = supabaseAdmin();

  // Reconnexion : le téléphone a gardé son identifiant en local.
  if (body.playerId && body.token) {
    const { data } = await db
      .from("players")
      .select("id, name, color, device_token")
      .eq("game_id", game.id)
      .eq("id", body.playerId)
      .maybeSingle();
    if (data && data.device_token === body.token) {
      return ok({ playerId: data.id, token: data.device_token, name: data.name, color: data.color });
    }
  }

  if (game.status !== "active") throw new HttpError(410, "Cette partie est terminée");

  const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
  if (!name) throw new HttpError(400, "Choisis un prénom");
  const color = COLOR_RE.test(String(body.color)) ? String(body.color) : "#2a9d88";

  const { data, error } = await db
    .from("players")
    .insert({ game_id: game.id, name, color })
    .select("id, name, color, device_token")
    .single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "Ce prénom est déjà pris dans la partie");
    throw error;
  }
  await bump(game.id);
  return ok({ playerId: data.id, token: data.device_token, name: data.name, color: data.color }, 201);
});
