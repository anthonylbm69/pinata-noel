// npm run check:content — vérifie le contenu des épreuves avant le jour J :
// fichiers audio / photos manquants, bonne réponse hors des choix, prix invalides…
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "src", "content");
const problems = [];
const warn = (file, msg) => problems.push(`${file} : ${msg}`);

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
// Épreuves réellement jouées (présentes dans un programme) : les autres ne sont pas vérifiées.
const used = new Set(
  files.flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).rounds ?? []),
);
const rounds = {};
const unused = [];
for (const f of files) {
  const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (data.rounds) continue; // programme
  rounds[data.id] = data;
  if (!used.has(data.id)) {
    unused.push(data.id);
    continue;
  }
  (data.questions ?? []).forEach((q, i) => {
    const where = `question ${i + 1}`;
    if ("price" in q) {
      if (!Number.isInteger(q.price) || q.price < 0) warn(f, `${where} : prix invalide (${q.price})`);
    } else {
      if (q.choices?.length !== 4) warn(f, `${where} : il faut 4 choix`);
      if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= (q.choices?.length ?? 0)) {
        warn(f, `${where} : "correct" doit être entre 0 et ${(q.choices?.length ?? 4) - 1}`);
      }
    }
    for (const key of ["audio", "image"]) {
      if (q[key] && !existsSync(join(root, "public", q[key]))) warn(f, `${where} : fichier manquant public${q[key]}`);
    }
  });
  if (data.type === "memoire") {
    const sets = data.sets ?? [];
    if (!sets.length) warn(f, "la mémoire doit avoir au moins une série (\"sets\")");
    sets.forEach((s, i) => {
      if (s.objects?.length !== 10) warn(f, `série ${i + 1} : il faut 10 objets`);
      if (!(data.questions ?? []).some((q) => (q.set ?? 0) === i)) warn(f, `série ${i + 1} : aucune question`);
    });
    (data.questions ?? []).forEach((q, i) => {
      if ((q.set ?? 0) >= sets.length) warn(f, `question ${i + 1} : série ${q.set} inconnue`);
    });
  }
}

for (const f of files) {
  const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (!data.rounds) continue;
  for (const id of data.rounds) if (!rounds[id]) warn(f, `épreuve inconnue « ${id} »`);
}

if (unused.length) console.log(`(épreuves hors programme, non vérifiées : ${unused.join(", ")})`);
if (problems.length) {
  console.log(`✗ ${problems.length} problème(s) :\n- ${problems.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("✓ Contenu OK : tous les fichiers sont là.");
}
