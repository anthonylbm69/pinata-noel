import type { Quiz } from "./types";
import quizTonton from "@/content/quiz-tonton.json";

// Le contenu des épreuves vit dans src/content/*.json (séparé du code).
// Pour ajouter un quiz : créer le JSON puis l'enregistrer ici.
const QUIZZES: Record<string, Quiz> = {
  [quizTonton.id]: quizTonton as Quiz,
};

export function getQuiz(id: string): Quiz {
  const quiz = QUIZZES[id];
  if (!quiz) throw new Error(`Quiz inconnu : ${id}`);
  return quiz;
}

export const DEFAULT_QUIZ_ID = quizTonton.id;
