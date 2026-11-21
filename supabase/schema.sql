-- =====================================================================
-- La Pinata de Noël — schéma Supabase (V1)
-- À coller dans Supabase > SQL Editor > New query, puis "Run".
-- Le script est ré-exécutable : il supprime et recrée tout (les parties
-- existantes sont perdues).
-- =====================================================================

create extension if not exists pgcrypto;

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
  quiz_id               text not null default 'quiz-tonton',
  phase                 text not null default 'lobby'
                        check (phase in ('lobby', 'question', 'results', 'leaderboard', 'end')),
  question_index        int  not null default -1,
  question_opened_at    timestamptz,
  question_time_limit_ms int not null default 20000,
  status                text not null default 'active' check (status in ('active', 'finished', 'archived')),
  is_test               boolean not null default false,
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

-- ---------------------------------------------------------------------
-- Sécurité (RLS) : tout est fermé, sauf la lecture de "games".
-- Le serveur Next.js utilise la clé service_role, qui contourne la RLS.
-- ---------------------------------------------------------------------
alter table games        enable row level security;
alter table game_secrets enable row level security;
alter table players      enable row level security;
alter table answers      enable row level security;
alter table adjustments  enable row level security;

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

-- Signale un changement aux clients.
create or replace function bump_game(p_game uuid)
returns void language sql as $$
  update games set version = version + 1, updated_at = now() where id = p_game;
$$;

-- Ouvre une question : l'heure d'ouverture vient de l'horloge de la base.
create or replace function open_question(p_game uuid, p_index int)
returns void language sql as $$
  update games
     set phase = 'question',
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
  select * into g from games where id = p_game;
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
