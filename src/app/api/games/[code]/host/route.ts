// POST /api/games/:code/host — actions de l'animateur (télé).
// Toutes les actions exigent le jeton animateur.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertHost, bump, getGame, type GameRow } from "@/lib/game-server";
import { getQuiz } from "@/lib/content";
import { handle, ok, readJson, HttpError } from "@/lib/http";

type Body = {
  token?: string;
  action?: string;
  questionIndex?: number;
  playerId?: string;
  points?: number;
  count?: number;
};

const BOT_NAMES = ["Bot Rudolph", "Bot Lutin", "Bot Flocon", "Bot Sapin", "Bot Bûche", "Bot Grinch", "Bot Étoile", "Bot Cadeau"];
const BOT_COLORS = ["#e2333f", "#4d80f2", "#2a9e88", "#d99e1a", "#b373f2", "#33bfd9", "#99cc4d", "#f29933"];

async function setPhase(game: GameRow, phase: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin()
    .from("games")
    .update({ phase, ...extra })
    .eq("id", game.id);
  if (error) throw error;
  // Incrément atomique de "version" (jamais de retour en arrière) → Realtime.
  await bump(game.id);
}

async function openQuestion(game: GameRow, index: number) {
  const { error } = await supabaseAdmin().rpc("open_question", { p_game: game.id, p_index: index });
  if (error) throw error;
}

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<Body>(req);
  const game = await getGame(code);
  await assertHost(game, body.token);
  const db = supabaseAdmin();
  const quiz = getQuiz(game.quiz_id);
  const last = quiz.questions.length - 1;

  switch (body.action) {
    // Lance la partie : première question.
    case "start": {
      if (game.phase !== "lobby") throw new HttpError(409, "La partie a déjà commencé");
      await openQuestion(game, 0);
      break;
    }

    // Ferme la question (fin du chrono ou tout le monde a répondu). Idempotent.
    case "close": {
      const qi = Number(body.questionIndex ?? game.question_index);
      const { error } = await db.rpc("close_question", { p_game: game.id, p_index: qi });
      if (error) throw error;
      break;
    }

    case "show-leaderboard": {
      if (game.phase !== "results") throw new HttpError(409, "Rien à classer pour l'instant");
      await setPhase(game, "leaderboard");
      break;
    }

    // Question suivante, ou fin de partie après la dernière.
    case "next": {
      if (game.phase !== "results" && game.phase !== "leaderboard") {
        throw new HttpError(409, "Ferme d'abord la question en cours");
      }
      if (game.question_index >= last) {
        await setPhase(game, "end", { status: "finished" });
      } else {
        await openQuestion(game, game.question_index + 1);
      }
      break;
    }

    // Relance la question en cours (coupure, bug…) : efface ses réponses.
    case "restart-question": {
      if (game.question_index < 0) throw new HttpError(409, "Aucune question en cours");
      const { error } = await db
        .from("answers")
        .delete()
        .eq("game_id", game.id)
        .eq("question_index", game.question_index);
      if (error) throw error;
      await openQuestion(game, game.question_index);
      break;
    }

    // Fin anticipée de la partie.
    case "end": {
      await setPhase(game, "end", { status: "finished" });
      break;
    }

    // Remet la partie à zéro (garde les joueurs).
    case "reset": {
      await db.from("answers").delete().eq("game_id", game.id);
      await db.from("adjustments").delete().eq("game_id", game.id);
      await setPhase(game, "lobby", { question_index: -1, question_opened_at: null, status: "active" });
      break;
    }

    // ---- Tests ----
    case "add-bots": {
      const count = Math.min(Math.max(Number(body.count ?? 6), 1), BOT_NAMES.length);
      const { data: existing } = await db.from("players").select("name").eq("game_id", game.id);
      const taken = new Set((existing ?? []).map((p) => p.name.toLowerCase()));
      const rows = BOT_NAMES.map((name, i) => ({ name, color: BOT_COLORS[i] }))
        .filter((b) => !taken.has(b.name.toLowerCase()))
        .slice(0, count)
        .map((b) => ({ game_id: game.id, name: b.name, color: b.color, is_bot: true }));
      if (rows.length) {
        const { error } = await db.from("players").insert(rows);
        if (error) throw error;
      }
      await bump(game.id);
      break;
    }

    case "remove-bots": {
      const { error } = await db.from("players").delete().eq("game_id", game.id).eq("is_bot", true);
      if (error) throw error;
      await bump(game.id);
      break;
    }

    // Un bot répond (déclenché par la télé avec un délai aléatoire) : ~65 % de bonnes réponses.
    case "bot-answer": {
      const { data: bot } = await db
        .from("players")
        .select("id, is_bot")
        .eq("game_id", game.id)
        .eq("id", body.playerId ?? "")
        .maybeSingle();
      if (!bot?.is_bot) throw new HttpError(400, "Ce joueur n'est pas un bot");
      const q = quiz.questions[game.question_index];
      if (!q || game.phase !== "question") return ok({ ok: false });
      const others = q.choices.map((_, i) => i).filter((i) => i !== q.correct);
      const choice = Math.random() < 0.65 ? q.correct : others[Math.floor(Math.random() * others.length)];
      const { error } = await db.rpc("submit_answer", {
        p_game: game.id,
        p_player: bot.id,
        p_index: game.question_index,
        p_choice: choice,
        p_correct: choice === q.correct,
      });
      if (error) throw error;
      break;
    }

    // ---- Plan B : points à la main ----
    case "adjust": {
      const points = Math.round(Number(body.points));
      if (!body.playerId || !Number.isFinite(points) || points === 0) throw new HttpError(400, "Points invalides");
      const { error } = await db
        .from("adjustments")
        .insert({ game_id: game.id, player_id: body.playerId, points, reason: "manuel" });
      if (error) throw error;
      await bump(game.id);
      break;
    }

    case "kick": {
      if (!body.playerId) throw new HttpError(400, "Joueur manquant");
      const { error } = await db.from("players").delete().eq("game_id", game.id).eq("id", body.playerId);
      if (error) throw error;
      await bump(game.id);
      break;
    }

    default:
      throw new HttpError(400, "Action inconnue");
  }

  return ok({ ok: true });
});
