// npm run db:functions — met à jour UNIQUEMENT les fonctions SQL de
// supabase/schema.sql (create or replace function …), sans toucher aux tables
// ni aux parties en cours. Sans danger, même avec des parties en base.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquante dans .env.local.");
  process.exit(1);
}
const sql = readFileSync(fileURLToPath(new URL("../supabase/schema.sql", import.meta.url)), "utf8");
const fns = sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  for (const fn of fns) await client.query(fn);
  console.log(`✓ ${fns.length} fonction(s) mise(s) à jour :`, fns.map((f) => f.match(/function\s+(\w+)/i)[1]).join(", "));
} catch (err) {
  console.error("✗ Échec :", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
