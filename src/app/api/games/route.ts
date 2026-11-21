// POST /api/games — crée une nouvelle partie (session) et renvoie le jeton animateur.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { DEFAULT_PROGRAMME_ID, getProgramme } from "@/lib/content";
import { handle, ok, readJson, HttpError } from "@/lib/http";

function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export const POST = handle(async (req: Request) => {
  const body = await readJson<{ isTest?: boolean; mode?: string }>(req);
  const mode = body.mode === "adultes" ? "adultes" : "enfants";
  const prog = getProgramme(DEFAULT_PROGRAMME_ID);
  const db = supabaseAdmin();

  // Code à 4 chiffres, on réessaie en cas de collision.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const { data: game, error } = await db
      .from("games")
      .insert({
        code,
        mode,
        quiz_id: prog.id,
        question_time_limit_ms: prog.flat[0].timeLimitMs,
        box_count: prog.boxes,
        is_test: !!body.isTest,
      })
      .select("id, code")
      .single();
    if (error) {
      if (error.code === "23505") continue; // code déjà pris
      throw error;
    }
    const { data: secret, error: sErr } = await db
      .from("game_secrets")
      .insert({ game_id: game.id })
      .select("host_token")
      .single();
    if (sErr) throw sErr;
    return ok({ code: game.code, hostToken: secret.host_token }, 201);
  }
  throw new HttpError(503, "Impossible de générer un code de partie, réessaie");
});
