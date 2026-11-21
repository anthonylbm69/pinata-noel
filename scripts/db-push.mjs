// npm run db:push — applique supabase/schema.sql sur la base Supabase,
// sans passer par le SQL Editor. Lit DATABASE_URL dans .env.local.
//
// ⚠️ schema.sql SUPPRIME et recrée toutes les tables. Par sécurité, le
// script refuse de tourner s'il existe déjà des parties en base, sauf avec
// --force (à ne jamais faire le soir du réveillon).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL manquante dans .env.local.\n" +
      "Supabase → bouton « Connect » → « Session pooler » → copie l'URI et remplace [YOUR-PASSWORD].",
  );
  process.exit(1);
}

const force = process.argv.includes("--force");
const schemaPath = fileURLToPath(new URL("../supabase/schema.sql", import.meta.url));
const sql = readFileSync(schemaPath, "utf8");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  const { rows } = await client.query(
    "select to_regclass('public.games') is not null as exists",
  );
  if (rows[0].exists) {
    const { rows: n } = await client.query("select count(*)::int as n from games");
    if (n[0].n > 0 && !force) {
      console.error(
        `Refusé : ${n[0].n} partie(s) déjà en base, elles seraient effacées.\n` +
          "Relance avec « npm run db:push -- --force » si c'est vraiment voulu.",
      );
      process.exit(1);
    }
  }

  await client.query(sql);
  const { rows: tables } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  console.log("✓ Schéma appliqué. Tables :", tables.map((t) => t.table_name).join(", "));
} catch (err) {
  console.error("✗ Échec :", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
