// Types partagés entre le serveur (API) et les clients (télé / téléphone).

export type Phase = "lobby" | "question" | "results" | "leaderboard" | "end";
export type Mode = "enfants" | "adultes";

export interface QuizQuestion {
  text: string;
  choices: string[];
  correct: number;
}

export interface Quiz {
  id: string;
  title: string;
  timeLimitMs: number;
  questions: QuizQuestion[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
}

export interface LeaderboardEntry extends PublicPlayer {
  total: number;
  rank: number;
}

export interface ResultLine extends PublicPlayer {
  answered: boolean;
  choice: number | null;
  isCorrect: boolean;
  points: number;
  elapsedMs: number | null;
}

export interface GameState {
  game: {
    code: string;
    mode: Mode;
    phase: Phase;
    quizTitle: string;
    questionIndex: number;
    totalQuestions: number;
    timeLimitMs: number;
    /** ISO, heure d'ouverture de la question (horloge de la base) */
    openedAt: string | null;
    isTest: boolean;
    version: number;
  };
  /** Date.now() du serveur au moment de la réponse, pour caler le chrono */
  serverNow: number;
  players: PublicPlayer[];
  /** Question en cours (phases question / results / leaderboard) */
  question: { index: number; text: string; choices: string[] } | null;
  answeredCount: number;
  answeredPlayerIds: string[];
  /** Uniquement en phase "results" */
  results: {
    correct: number;
    distribution: number[];
    lines: ResultLine[];
  } | null;
  leaderboard: LeaderboardEntry[];
  /** Uniquement pour un joueur */
  me: {
    id: string;
    name: string;
    color: string;
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
