-- =====================================================================
-- La Pinata de Noël — schéma Supabase (V1)
-- À coller dans Supabase > SQL Editor > New query, puis "Run".
-- Le script est ré-exécutable : il supprime et recrée tout (les parties
-- existantes sont perdues).
-- =====================================================================

create extension if not exists pgcrypto;

drop table if exists boxes cascade;
drop table if exists final_players cascade;
drop table if exists final_buttons cascade;
drop table if exists adjustments cascade;
drop table if exists answers cascade;
drop table if exists players cascade;
drop table if exists game_secrets cascade;
drop table if exists games cascade;

-- ---------------------------------------------------------------------
-- games : une ligne = une partie (session). C'est la seule table lisible
-- par les navigateurs (Realtime) : elle ne contient rien de secret.
-- Chaque changement incrémente "version" → les clients rechargent l'état.
-- ---------------------------------------------------------------------
create table games (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  mode                  text not null default 'enfants' check (mode in ('enfants', 'adultes')),
  -- identifiant du programme d'épreuves (src/content/programme-*.json)
  quiz_id               text not null default 'programme-enfants',
  phase                 text not null default 'lobby'
                        check (phase in ('lobby', 'intro', 'question', 'results', 'leaderboard',
                                         'final', 'boxes', 'end')),
  question_index        int  not null default -1,
  question_opened_at    timestamptz,
  question_time_limit_ms int not null default 20000,
  status                text not null default 'active' check (status in ('active', 'finished', 'archived')),
  is_test               boolean not null default false,
  -- Finale : joueur dont c'est le tour (null = finale pas commencée ou finie)
  final_turn            uuid,
  -- Nombre de box à choisir à la fin
  box_count             int not null default 7,
  version               bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Secrets de la partie (jeton animateur) : jamais lisibles par les clients.
create table game_secrets (
  game_id    uuid primary key references games(id) on delete cascade,
  host_token uuid not null default gen_random_uuid()
);

create table players (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 20),
  color        text not null default '#2a9d88',
  gender       text check (gender in ('F', 'H')),
  device_token uuid not null default gen_random_uuid(),
  is_bot       boolean not null default false,
  -- L'animateur a « libéré » ce prénom : le prochain téléphone qui s'inscrit
  -- avec reprend ce joueur et ses points (téléphone changé, historique effacé…).
  claimable    boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index players_unique_name on players (game_id, lower(name));

-- Réponses : l'heure de réception est posée par la base (même horloge pour tous)
-- et la contrainte unique bloque les doubles réponses.
create table answers (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references games(id) on delete cascade,
  player_id      uuid not null references players(id) on delete cascade,
  question_index int  not null,
  choice         int  not null,
  is_correct     boolean not null,
  elapsed_ms     int  not null,
  points         int  not null,
  created_at     timestamptz not null default now(),
  unique (game_id, player_id, question_index)
);

-- Points donnés / retirés à la main par l'animateur (plan B).
create table adjustments (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  points     int  not null,
  reason     text,
  created_at timestamptz not null default now()
);

-- Finale « bouton de la mort » : 20 boutons dont 6 bombes, tirées par la base.
-- is_bomb n'est JAMAIS envoyé aux clients tant que le bouton n'est pas appuyé.
create table final_buttons (
  game_id    uuid not null references games(id) on delete cascade,
  idx        int  not null,
  is_bomb    boolean not null,
  pressed_by uuid references players(id) on delete set null,
  pressed_at timestamptz,
  primary key (game_id, idx)
);

-- Ordre de passage de la finale et éliminations.
create table final_players (
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  turn_order int  not null,
  out_at     timestamptz,
  place      int,
  primary key (game_id, player_id)
);

-- Box choisies à la fin : seulement des numéros, jamais leur contenu.
create table boxes (
  game_id    uuid not null references games(id) on delete cascade,
  box_number int  not null,
  player_id  uuid not null references players(id) on delete cascade,
  picked_at  timestamptz not null default now(),
  primary key (game_id, box_number),
  unique (game_id, player_id)
);

-- ---------------------------------------------------------------------
-- Sécurité (RLS) : tout est fermé, sauf la lecture de "games".
-- Le serveur Next.js utilise la clé service_role, qui contourne la RLS.
-- ---------------------------------------------------------------------
alter table games        enable row level security;
alter table game_secrets enable row level security;
alter table players      enable row level security;
alter table answers      enable row level security;
alter table adjustments  enable row level security;
alter table final_buttons enable row level security;
alter table final_players enable row level security;
alter table boxes        enable row level security;

create policy "games lisibles par tous" on games for select using (true);

-- Realtime : les clients écoutent les UPDATE sur "games".
do $$
begin
  alter publication supabase_realtime add table games;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- Fonctions (appelées par le serveur Next.js)
-- ---------------------------------------------------------------------

-- Heure de la base en millisecondes : sert à caler le chrono des écrans.
create or replace function server_now_ms() returns bigint
language sql stable as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint
$$;

-- Signale un changement aux clients.
create or replace function bump_game(p_game uuid)
returns void language sql as $$
  update games set version = version + 1, updated_at = now() where id = p_game;
$$;

-- Ouvre une question : l'heure d'ouverture vient de l'horloge de la base.
-- La durée dépend de l'épreuve (p_limit_ms).
drop function if exists open_question(uuid, int);
create or replace function open_question(p_game uuid, p_index int, p_limit_ms int)
returns void language sql as $$
  update games
     set phase = 'question',
         question_index = p_index,
         question_opened_at = now(),
         question_time_limit_ms = p_limit_ms,
         version = version + 1,
         updated_at = now()
   where id = p_game;
$$;

-- Écran de présentation d'une épreuve (p_index = sa première question).
-- question_opened_at sert de départ au chrono d'affichage (épreuve mémoire).
create or replace function open_intro(p_game uuid, p_index int)
returns void language sql as $$
  update games
     set phase = 'intro',
         question_index = p_index,
         question_opened_at = now(),
         version = version + 1,
         updated_at = now()
   where id = p_game;
$$;

-- Ferme la question en cours (idempotent : ne fait rien si déjà fermée).
create or replace function close_question(p_game uuid, p_index int)
returns boolean language plpgsql as $$
begin
  update games
     set phase = 'results', version = version + 1, updated_at = now()
   where id = p_game and phase = 'question' and question_index = p_index;
  return found;
end $$;

-- Enregistre une réponse et calcule les points façon Kahoot :
--   juste → round(1000 × (1 − (t / T) ÷ 2)) ; faux → 0.
-- Refuse si la question n'est plus ouverte, si c'est trop tard, ou en double.
create or replace function submit_answer(
  p_game uuid, p_player uuid, p_index int, p_choice int, p_correct boolean
)
returns table (ok boolean, reason text, elapsed_ms int, points int)
language plpgsql as $$
declare
  g        games%rowtype;
  v_elapsed int;
  v_points  int;
begin
  -- Verrou : une réponse ne peut pas se glisser pendant la fermeture de la question.
  select * into g from games where id = p_game for update;
  if g.id is null then
    return query select false, 'unknown_game', 0, 0; return;
  end if;
  if g.phase <> 'question' or g.question_index <> p_index then
    return query select false, 'closed', 0, 0; return;
  end if;

  v_elapsed := greatest(0, floor(extract(epoch from (now() - g.question_opened_at)) * 1000))::int;
  -- 1,5 s de tolérance pour la latence réseau
  if v_elapsed > g.question_time_limit_ms + 1500 then
    return query select false, 'late', v_elapsed, 0; return;
  end if;

  if p_correct then
    v_points := round(1000 * (1 - (least(v_elapsed, g.question_time_limit_ms)::numeric
                                   / g.question_time_limit_ms) / 2));
  else
    v_points := 0;
  end if;

  insert into answers (game_id, player_id, question_index, choice, is_correct, elapsed_ms, points)
  values (p_game, p_player, p_index, p_choice, p_correct, v_elapsed, v_points)
  on conflict (game_id, player_id, question_index) do nothing;

  if not found then
    return query select false, 'duplicate', v_elapsed, 0; return;
  end if;

  perform bump_game(p_game);
  return query select true, 'ok', v_elapsed, v_points;
end $$;

-- Juste prix : ferme la question ET distribue les points d'un coup.
-- Le plus proche SANS DÉPASSER gagne ; à égalité, le plus rapide.
-- Barème par rang (parmi ceux qui n'ont pas dépassé) : p_scale[1], p_scale[2]…
create or replace function close_price_question(p_game uuid, p_index int, p_price int, p_scale int[])
returns boolean language plpgsql as $$
begin
  update games
     set phase = 'results', updated_at = now()
   where id = p_game and phase = 'question' and question_index = p_index;
  if not found then return false; end if;

  with ranked as (
    select id,
           row_number() over (order by (p_price - choice) asc, elapsed_ms asc) as rk
      from answers
     where game_id = p_game and question_index = p_index and choice <= p_price
  )
  update answers a
     set points = coalesce(p_scale[r.rk], p_scale[array_length(p_scale, 1)]),
         is_correct = (r.rk = 1)
    from ranked r
   where a.id = r.id;

  perform bump_game(p_game);
  return true;
end $$;

-- Finale : tire les 6 bombes parmi 20 boutons et fixe l'ordre de passage.
create or replace function start_final(p_game uuid, p_order uuid[], p_buttons int, p_bombs int)
returns void language plpgsql as $$
begin
  delete from final_buttons where game_id = p_game;
  delete from final_players where game_id = p_game;

  insert into final_buttons (game_id, idx, is_bomb)
  select p_game, i, false from generate_series(0, p_buttons - 1) as i;
  update final_buttons set is_bomb = true
   where game_id = p_game
     and idx in (select idx from final_buttons where game_id = p_game order by random() limit p_bombs);

  insert into final_players (game_id, player_id, turn_order)
  select p_game, pid, ord from unnest(p_order) with ordinality as t(pid, ord);

  update games
     set phase = 'final', final_turn = p_order[1], version = version + 1, updated_at = now()
   where id = p_game;
end $$;

-- Finale : termine la partie de boutons. Le(s) survivant(s) gagnent +p_win,
-- le dernier éliminé +p_second. Appelée sous le verrou de la partie.
create or replace function finish_final(p_game uuid, p_win int, p_second int)
returns void language plpgsql as $$
begin
  update final_players set place = 1
   where game_id = p_game and out_at is null;
  insert into adjustments (game_id, player_id, points, reason)
  select p_game, fp.player_id, p_win, 'finale' from final_players fp
   where fp.game_id = p_game and fp.out_at is null;
  insert into adjustments (game_id, player_id, points, reason)
  select p_game, fp.player_id, p_second, 'finale' from final_players fp
   where fp.game_id = p_game and fp.out_at is not null
   order by fp.out_at desc limit 1;
  update games set final_turn = null, version = version + 1, updated_at = now() where id = p_game;
end $$;

-- Finale : un joueur appuie sur un bouton. Tout est vérifié et fait ici,
-- sous verrou, pour éviter les doubles appuis.
--   bombe → le joueur est éliminé ; s'il ne reste qu'un joueur, il gagne
--   +p_win et le dernier éliminé +p_second.
create or replace function press_button(
  p_game uuid, p_player uuid, p_idx int, p_win int, p_second int
)
returns table (ok boolean, reason text, bomb boolean, finished boolean)
language plpgsql as $$
declare
  g        games%rowtype;
  b        final_buttons%rowtype;
  v_alive  int;
  v_order  int;
  v_next   uuid;
  v_left   int;
begin
  select * into g from games where id = p_game for update;
  if g.phase <> 'final' or g.final_turn is null then
    return query select false, 'not_final', false, false; return;
  end if;
  if g.final_turn <> p_player then
    return query select false, 'not_your_turn', false, false; return;
  end if;

  select * into b from final_buttons where game_id = p_game and idx = p_idx;
  if b.game_id is null then
    return query select false, 'bad_button', false, false; return;
  end if;
  if b.pressed_at is not null then
    return query select false, 'already_pressed', false, false; return;
  end if;

  update final_buttons set pressed_by = p_player, pressed_at = now()
   where game_id = p_game and idx = p_idx;

  -- Joueurs encore en jeu (un joueur exclu de la partie disparaît d'ici).
  select count(*) into v_alive from final_players fp
   where fp.game_id = p_game and fp.out_at is null;

  if b.is_bomb then
    update final_players set out_at = now(), place = v_alive
     where game_id = p_game and player_id = p_player;
    v_alive := v_alive - 1;
  end if;

  select count(*) into v_left from final_buttons where game_id = p_game and pressed_at is null;

  if v_alive <= 1 or v_left = 0 then
    perform finish_final(p_game, p_win, p_second);
    return query select true, 'ok', b.is_bomb, true; return;
  end if;

  -- Tour suivant : prochain joueur encore en jeu dans l'ordre de passage.
  select turn_order into v_order from final_players where game_id = p_game and player_id = p_player;
  select fp.player_id into v_next from final_players fp
   where fp.game_id = p_game and fp.out_at is null
   order by (fp.turn_order <= v_order), fp.turn_order
   limit 1;

  update games set final_turn = v_next, version = version + 1, updated_at = now() where id = p_game;
  return query select true, 'ok', b.is_bomb, false;
end $$;

-- Finale : un joueur a été exclu de la partie (sa ligne final_players a
-- disparu avec lui). S'il ne reste qu'un survivant, la finale se termine ;
-- si c'était son tour, on passe au suivant dans l'ordre.
create or replace function final_after_kick(p_game uuid, p_turn_order int, p_win int, p_second int)
returns void language plpgsql as $$
declare
  g       games%rowtype;
  v_alive int;
  v_next  uuid;
begin
  select * into g from games where id = p_game for update;
  if g.phase <> 'final' or g.final_turn is null then return; end if;

  select count(*) into v_alive from final_players where game_id = p_game and out_at is null;
  if v_alive <= 1 then
    perform finish_final(p_game, p_win, p_second);
    return;
  end if;

  if not exists (select 1 from final_players
                  where game_id = p_game and player_id = g.final_turn and out_at is null) then
    select player_id into v_next from final_players
     where game_id = p_game and out_at is null
     order by (turn_order < p_turn_order), turn_order
     limit 1;
    update games set final_turn = v_next, version = version + 1, updated_at = now() where id = p_game;
  else
    perform bump_game(p_game);
  end if;
end $$;

-- Ces fonctions ne sont appelées que par le serveur (clé service_role) :
-- les navigateurs (clé publique) n'ont pas le droit de les lancer.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Demande à l'API Supabase (PostgREST) de relire les tables tout de suite.
notify pgrst, 'reload schema';
