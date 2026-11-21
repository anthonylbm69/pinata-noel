// POST /api/games/:code/join — rejoindre une partie (ou se reconnecter).
// GET  /api/games/:code/join — mode de la partie (le formulaire demande F / H en mode adultes).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { bump, getGame } from "@/lib/game-server";
import { handle, ok, readJson, HttpError } from "@/lib/http";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TAKEN = "Ce prénom est déjà pris. Si c'est toi (téléphone changé…), demande à l'animateur de le libérer (⚙ → 🔓).";

/** Clé de comparaison des prénoms : sans accents, sans majuscules. */
function nameKey(name: string) {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const game = await getGame(code);
  return ok({ mode: game.mode, finished: game.status !== "active" });
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<{ name?: string; color?: string; gender?: string; playerId?: string; token?: string }>(req);
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
  const gender = body.gender === "F" || body.gender === "H" ? body.gender : null;

  // Prénom déjà pris (sans tenir compte des accents ni des majuscules :
  // « ines » = « Inès ») ? Si l'animateur l'a libéré, ce téléphone reprend le
  // joueur et ses points avec un nouveau jeton ; l'ancien téléphone est déconnecté.
  const { data: others, error: oErr } = await db.from("players").select("id, name, claimable").eq("game_id", game.id);
  if (oErr) throw oErr;
  const taken = (others ?? []).find((p) => nameKey(p.name) === nameKey(name));
  if (taken) {
    if (taken.claimable) {
      const { data: claimed, error: cErr } = await db
        .from("players")
        .update({ claimable: false, device_token: crypto.randomUUID() })
        .eq("id", taken.id)
        .eq("claimable", true)
        .select("id, name, color, device_token")
        .maybeSingle();
      if (cErr) throw cErr;
      if (claimed) {
        await bump(game.id);
        return ok({ playerId: claimed.id, token: claimed.device_token, name: claimed.name, color: claimed.color });
      }
    }
    throw new HttpError(409, TAKEN);
  }

  // Mode adultes : le camp (F / H) est obligatoire, il décide du classement.
  if (game.mode === "adultes" && !gender) throw new HttpError(400, "Choisis ton camp : Femmes ou Hommes");

  const { data, error } = await db
    .from("players")
    .insert({ game_id: game.id, name, color, ...(game.mode === "adultes" ? { gender } : {}) })
    .select("id, name, color, device_token")
    .single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, TAKEN);
    throw error;
  }
  await bump(game.id);
  return ok({ playerId: data.id, token: data.device_token, name: data.name, color: data.color }, 201);
});
