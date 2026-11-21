"use client";
// Client Supabase côté navigateur : sert UNIQUEMENT à écouter les
// changements de la table "games" (Realtime). Toutes les lectures et
// écritures passent par les routes /api.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase appelle maintenant cette clé « publishable » : on accepte les deux noms.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.warn("Realtime désactivé : NEXT_PUBLIC_SUPABASE_URL ou la clé publique manque (rechargement toutes les 4 s seulement).");
    return null;
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
