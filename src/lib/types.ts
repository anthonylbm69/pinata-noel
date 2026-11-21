// Types partagés entre le serveur (API) et les clients (télé / téléphone).

export type Phase = "lobby" | "intro" | "question" | "results" | "leaderboard" | "final" | "boxes" | "end";
export type Mode = "enfants" | "adultes";
/** Camp en mode adultes (choisi à l'inscription) : 2 classements séparés. */
export type Gender = "F" | "H";

// ---------------------------------------------------------------------------
// Contenu des épreuves (src/content/*.json)
// ---------------------------------------------------------------------------

export type RoundType = "quiz" | "blindtest" | "memoire" | "quiestce" | "justeprix";

/** Question à 4 choix (quiz, blind test, mémoire, qui est-ce). */
export interface ChoiceQuestion {
  text: string;
  choices: string[];
  correct: number;
  /** Blind test : fichier dans public/ (ex. "/audio/blindtest/01.mp3") */
  audio?: string;
  /** Blind test : seconde de départ de l'extrait */
  start?: number;
  /** Qui est-ce : photo dans public/ (ex. "/photos/quiestce/01.jpg") */
  image?: string;
}

/** Juste prix : les joueurs tapent un prix en euros. */
export interface PriceQuestion {
  text: string;
  /** emoji affiché en grand si pas de photo */
  emoji?: string;
  image?: string;
  /** prix exact, en euros entiers */
  price: number;
}

export interface Round {
  id: string;
  type: RoundType;
  title: string;
  /** phrase d'explication affichée sur l'écran de présentation */
  rules: string;
  timeLimitMs: number;
  /** Mémoire : objets à mémoriser (emoji + nom) et durée d'affichage */
  objects?: { emoji: string; label: string }[];
  displayMs?: number;
  questions: (ChoiceQuestion | PriceQuestion)[];
}

export interface Programme {
  id: string;
  title: string;
  rounds: string[];
  final: { buttons: number; bombs: number; winPoints: number; secondPoints: number } | null;
  boxes: number;
}

/** Une question « à plat » dans le déroulé complet de la partie. */
export interface FlatQuestion {
  roundIndex: number;
  /** position dans l'épreuve (0…) */
  indexInRound: number;
  kind: "choice" | "price";
  timeLimitMs: number;
  q: ChoiceQuestion | PriceQuestion;
}

// ---------------------------------------------------------------------------
// État envoyé aux écrans
// ---------------------------------------------------------------------------

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  /** prénom libéré par l'animateur : un nouveau téléphone peut le reprendre */
  released: boolean;
  /** camp (mode adultes), null chez les enfants */
  gender: Gender | null;
}

export interface LeaderboardEntry extends PublicPlayer {
  total: number;
  /** rang dans la partie (enfants) ou dans son camp F / H (adultes) */
  rank: number;
}

export interface ResultLine extends PublicPlayer {
  answered: boolean;
  choice: number | null;
  isCorrect: boolean;
  points: number;
  elapsedMs: number | null;
}

export interface PublicRound {
  index: number;
  total: number;
  type: RoundType;
  title: string;
  rules: string;
  questionCount: number;
  /** Mémoire, phase intro uniquement */
  objects?: { emoji: string; label: string }[];
  displayMs?: number;
}

export interface PublicQuestion {
  /** index global dans la partie */
  index: number;
  indexInRound: number;
  kind: "choice" | "price";
  text: string;
  choices: string[];
  /** télé uniquement */
  audio?: string;
  start?: number;
  image?: string;
  emoji?: string;
}

export interface FinalState {
  buttons: { idx: number; pressed: boolean; bomb: boolean | null; by: string | null }[];
  order: { id: string; out: boolean; place: number | null }[];
  turn: string | null;
  finished: boolean;
  bombsLeft: number;
  winPoints: number;
  secondPoints: number;
}

export interface BoxesState {
  count: number;
  picks: { box: number; playerId: string }[];
  /** ordre de choix = classement */
  order: string[];
  current: string | null;
}

export interface GameState {
  game: {
    code: string;
    mode: Mode;
    phase: Phase;
    title: string;
    questionIndex: number;
    totalQuestions: number;
    timeLimitMs: number;
    /** ISO, heure d'ouverture de la question / de l'intro (horloge de la base) */
    openedAt: string | null;
    isTest: boolean;
    version: number;
    hasFinal: boolean;
    /** faux en mode adultes : pas de box, la partie se termine sur les classements */
    hasBoxes: boolean;
    /** vrai si la question en cours est la dernière de son épreuve */
    lastInRound: boolean;
    /** vrai si c'est la toute dernière question */
    lastQuestion: boolean;
  };
  /** heure de la base au moment de la réponse, pour caler le chrono */
  serverNow: number;
  players: PublicPlayer[];
  round: PublicRound | null;
  /** Question en cours (phases question / results / leaderboard) */
  question: PublicQuestion | null;
  answeredCount: number;
  answeredPlayerIds: string[];
  /** Uniquement en phase "results" */
  results: {
    kind: "choice" | "price";
    correct: number;
    /** juste prix : le prix exact */
    price: number | null;
    distribution: number[];
    lines: ResultLine[];
  } | null;
  leaderboard: LeaderboardEntry[];
  final: FinalState | null;
  boxes: BoxesState | null;
  /** Uniquement pour un joueur */
  me: {
    id: string;
    name: string;
    color: string;
    gender: Gender | null;
    total: number;
    rank: number;
    current: {
      choice: number;
      elapsedMs: number;
      /** connus seulement une fois la question fermée */
      isCorrect: boolean | null;
      points: number | null;
    } | null;
  } | null;
}
