"use client";
// Petits helpers autour de localStorage (peut être indisponible : try/catch).

export interface PlayerAuth {
  playerId: string;
  token: string;
  name: string;
  color: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : on fait sans */
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export const hostStore = {
  get: (code: string) => read<string>(`pinata:host:${code}`),
  set: (code: string, token: string) => {
    write(`pinata:host:${code}`, token);
    const list = read<string[]>("pinata:host-games") ?? [];
    write("pinata:host-games", [code, ...list.filter((c) => c !== code)].slice(0, 10));
  },
  list: () => read<string[]>("pinata:host-games") ?? [],
};

export const playerStore = {
  get: (code: string) => read<PlayerAuth>(`pinata:player:${code}`),
  set: (code: string, auth: PlayerAuth) => write(`pinata:player:${code}`, auth),
  clear: (code: string) => remove(`pinata:player:${code}`),
};
