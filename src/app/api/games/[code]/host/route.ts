// POST /api/games/:code/host — actions de l'animateur (télé).
// Toutes les actions exigent le jeton animateur.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { assertHost, bump, computeLeaderboard, getGame, pickBox, type GameRow } from "@/lib/game-server";
import { PRICE_SCALE, getProgramme, isPrice, type LoadedProgramme } from "@/lib/content";
import { handle, ok, readJson, HttpError } from "@/lib/http";

type Body = {
  token?: string;
  action?: string;
  questionIndex?: number;
  playerId?: string;
  points?: number;
  count?: number;
  box?: number;
  idx?: number;
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

async function openQuestion(game: GameRow, prog: LoadedProgramme, index: number) {
  const { error } = await supabaseAdmin().rpc("open_question", {
    p_game: game.id,
    p_index: index,
    p_limit_ms: prog.flat[index].timeLimitMs,
  });
  if (error) throw error;
}

async function openIntro(game: GameRow, index: number) {
  const { error } = await supabaseAdmin().rpc("open_intro", { p_game: game.id, p_index: index });
  if (error) throw error;
}

/** Après une question : question suivante, nouvelle épreuve, ou finale. */
async function advance(game: GameRow, prog: LoadedProgramme) {
  const next = game.question_index + 1;
  if (next >= prog.flat.length) {
    if (prog.final) await startFinal(game, prog);
    else await startBoxes(game);
    return;
  }
  if (prog.flat[next].roundIndex !== prog.flat[game.question_index].roundIndex) await openIntro(game, next);
  else await openQuestion(game, prog, next);
}

/** Finale : ordre de passage = classement à l'envers (le dernier commence). */
async function startFinal(game: GameRow, prog: LoadedProgramme) {
  const lb = await computeLeaderboard(game);
  if (lb.length < 2) throw new HttpError(409, "Il faut au moins 2 joueurs pour la finale");
  const order = [...lb].reverse().map((p) => p.id);
  const { error } = await supabaseAdmin().rpc("start_final", {
    p_game: game.id,
    p_order: order,
    p_buttons: prog.final!.buttons,
    p_bombs: prog.final!.bombs,
  });
  if (error) throw error;
}

async function startBoxes(game: GameRow) {
  await supabaseAdmin().from("boxes").delete().eq("game_id", game.id);
  await setPhase(game, "boxes", { final_turn: null });
}

async function pressButton(game: GameRow, prog: LoadedProgramme, playerId: string, idx: number) {
  const { data, error } = await supabaseAdmin().rpc("press_button", {
    p_game: game.id,
    p_player: playerId,
    p_idx: idx,
    p_win: prog.final!.winPoints,
    p_second: prog.final!.secondPoints,
  });
  if (error) throw error;
  return (data as { ok: boolean; reason: string; bomb: boolean; finished: boolean }[])[0];
}

export const POST = handle(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const body = await readJson<Body>(req);
  const game = await getGame(code);
  await assertHost(game, body.token);
  const db = supabaseAdmin();
  const prog = getProgramme(game.quiz_id);

  switch (body.action) {
    // Lance la partie : présentation de la première épreuve.
    case "start": {
      if (game.phase !== "lobby") throw new HttpError(409, "La partie a déjà commencé");
      await openIntro(game, 0);
      break;
    }

    // Fin de la présentation d'une épreuve : première question.
    case "begin-round": {
      if (game.phase !== "intro") throw new HttpError(409, "Pas d'épreuve à lancer");
      await openQuestion(game, prog, game.question_index);
      break;
    }

    // Ferme la question (fin du chrono ou tout le monde a répondu). Idempotent.
    case "close": {
      const qi = Number(body.questionIndex ?? game.question_index);
      const src = prog.flat[qi]?.q;
      if (!src) throw new HttpError(400, "Question inconnue");
      const { error } = isPrice(src)
        ? await db.rpc("close_price_question", { p_game: game.id, p_index: qi, p_price: src.price, p_scale: PRICE_SCALE })
        : await db.rpc("close_question", { p_game: game.id, p_index: qi });
      if (error) throw error;
      break;
    }

    case "show-leaderboard": {
      if (game.phase !== "results") throw new HttpError(409, "Rien à classer pour l'instant");
      await setPhase(game, "leaderboard");
      break;
    }

    // Suite du déroulé selon la phase en cours.
    case "next": {
      if (game.phase === "results" || game.phase === "leaderboard") await advance(game, prog);
      else if (game.phase === "final") {
        if (game.final_turn !== null) throw new HttpError(409, "La finale n'est pas terminée");
        await startBoxes(game);
      } else if (game.phase === "boxes") await setPhase(game, "end", { status: "finished" });
      else throw new HttpError(409, "Ferme d'abord la question en cours");
      break;
    }

    // Saute le reste de l'épreuve en cours (plan B : son ou photos qui manquent…).
    case "skip-round": {
      const flat = prog.flat[game.question_index];
      if (!flat || !["intro", "question", "results", "leaderboard"].includes(game.phase)) {
        throw new HttpError(409, "Aucune épreuve en cours");
      }
      const nextRound = prog.firstOfRound[flat.roundIndex + 1];
      if (nextRound === undefined) {
        if (prog.final) await startFinal(game, prog);
        else await startBoxes(game);
      } else await openIntro(game, nextRound);
      break;
    }

    // Passe directement à la finale ou aux box (plan B).
    case "goto-final": {
      if (!prog.final) throw new HttpError(409, "Pas de finale dans ce programme");
      await startFinal(game, prog);
      break;
    }
    case "goto-boxes": {
      await startBoxes(game);
      break;
    }

    // Relance la question en cours (coupure, bug…) : efface ses réponses.
    case "restart-question": {
      if (game.question_index < 0 || !["question", "results", "leaderboard"].includes(game.phase)) {
        throw new HttpError(409, "Aucune question en cours");
      }
      const { error } = await db
        .from("answers")
        .delete()
        .eq("game_id", game.id)
        .eq("question_index", game.question_index);
      if (error) throw error;
      await openQuestion(game, prog, game.question_index);
      break;
    }

    // Finale : l'animateur appuie à la place du joueur (téléphone KO) ou fait jouer un bot.
    case "final-press":
    case "bot-final-press": {
      if (!game.final_turn) throw new HttpError(409, "Ce n'est pas le moment");
      const btns = await db.from("final_buttons").select("idx").eq("game_id", game.id).is("pressed_at", null);
      if (btns.error) throw btns.error;
      const free = (btns.data ?? []).map((b) => b.idx);
      const idx = Number.isInteger(body.idx) ? Number(body.idx) : free[Math.floor(Math.random() * free.length)];
      const res = await pressButton(game, prog, game.final_turn, idx);
      if (!res?.ok) throw new HttpError(409, "Bouton refusé");
      break;
    }

    // Box : l'animateur choisit à la place du joueur (ou d'un bot).
    case "pick-box":
    case "bot-pick-box": {
      if (!body.playerId) throw new HttpError(400, "Joueur manquant");
      let box = Number(body.box);
      if (!Number.isInteger(box)) {
        const taken = await db.from("boxes").select("box_number").eq("game_id", game.id);
        const used = new Set((taken.data ?? []).map((b) => b.box_number));
        const free = Array.from({ length: game.box_count }, (_, i) => i + 1).filter((n) => !used.has(n));
        box = free[Math.floor(Math.random() * free.length)];
      }
      await pickBox(game, body.playerId, box);
      break;
    }

    // Fin anticipée de la partie.
    case "end": {
      await setPhase(game, "end", { status: "finished" });
      break;
    }

    // Remet la partie à zéro (garde les joueurs).
    case "reset": {
      await Promise.all([
        db.from("answers").delete().eq("game_id", game.id),
        db.from("adjustments").delete().eq("game_id", game.id),
        db.from("final_buttons").delete().eq("game_id", game.id),
        db.from("final_players").delete().eq("game_id", game.id),
        db.from("boxes").delete().eq("game_id", game.id),
      ]);
      await setPhase(game, "lobby", {
        question_index: -1,
        question_opened_at: null,
        final_turn: null,
        status: "active",
      });
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

    // Un bot répond (déclenché par la télé avec un délai aléatoire).
    case "bot-answer": {
      const { data: bot } = await db
        .from("players")
        .select("id, is_bot")
        .eq("game_id", game.id)
        .eq("id", body.playerId ?? "")
        .maybeSingle();
      if (!bot?.is_bot) throw new HttpError(400, "Ce joueur n'est pas un bot");
      const src = prog.flat[game.question_index]?.q;
      if (!src || game.phase !== "question") return ok({ ok: false });
      let choice: number;
      let correct = false;
      if (isPrice(src)) {
        // Prix tiré entre 60 % et 115 % du vrai prix.
        choice = Math.max(0, Math.round(src.price * (0.6 + Math.random() * 0.55)));
      } else {
        // ~65 % de bonnes réponses.
        const others = src.choices.map((_, i) => i).filter((i) => i !== src.correct);
        choice = Math.random() < 0.65 ? src.correct : others[Math.floor(Math.random() * others.length)];
        correct = choice === src.correct;
      }
      const { error } = await db.rpc("submit_answer", {
        p_game: game.id,
        p_player: bot.id,
        p_index: game.question_index,
        p_choice: choice,
        p_correct: correct,
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
      // Finale : si c'était son tour, on passe au joueur suivant encore en jeu.
      if (game.phase === "final" && game.final_turn === body.playerId) {
        const { data } = await db
          .from("final_players")
          .select("player_id")
          .eq("game_id", game.id)
          .is("out_at", null)
          .order("turn_order");
        await setPhase(game, "final", { final_turn: data?.[0]?.player_id ?? null });
      } else await bump(game.id);
      break;
    }

    default:
      throw new HttpError(400, "Action inconnue");
  }

  return ok({ ok: true });
});
