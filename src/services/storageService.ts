/**
 * Storage abstraction layer for the compound library.
 *
 * The app talks to `libraryStorage` only — never directly to localStorage.
 * This keeps the door open for swapping to Capacitor Preferences / SQLite
 * (or a remote backend) when the project is converted to a mobile app.
 *
 * To migrate later:
 *   1. Implement the `KeyValueStore` interface against the new backend.
 *   2. Pass it to `createLibraryStorage(store)`.
 *   3. Replace the exported `libraryStorage` instance.
 */

import type {
  SavedCompound,
  SaveCompoundInput,
  SaveResult,
} from "@/types/library";

const STORAGE_KEY = "atom-forge:library:v1";

export interface KeyValueStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/** Browser localStorage adapter (SSR-safe). */
const browserStore: KeyValueStore = {
  getItem(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* quota / privacy mode — fail silently */
    }
  },
  removeItem(key) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Fingerprint used for duplicate detection: name + formula. */
function fingerprint(name: string, formula: string): string {
  return `${normalize(name)}|${normalize(formula)}`;
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export interface LibraryStorage {
  getAllCompounds(): Promise<SavedCompound[]>;
  saveCompound(input: SaveCompoundInput): Promise<SaveResult>;
  deleteCompound(id: string): Promise<boolean>;
  updateCompound(
    id: string,
    patch: Partial<Omit<SavedCompound, "id">>,
  ): Promise<SavedCompound | null>;
  isCompoundSaved(name: string, formula: string): Promise<boolean>;
  toggleFavorite(id: string): Promise<SavedCompound | null>;
  clearAllCompounds(): Promise<void>;
}

export function createLibraryStorage(store: KeyValueStore): LibraryStorage {
  async function readAll(): Promise<SavedCompound[]> {
    const raw = await store.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (c): c is SavedCompound =>
          c &&
          typeof c.id === "string" &&
          typeof c.moleculeName === "string" &&
          typeof c.formula === "string" &&
          c.structureData,
      );
    } catch {
      return [];
    }
  }

  async function writeAll(list: SavedCompound[]): Promise<void> {
    await store.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  return {
    async getAllCompounds() {
      return readAll();
    },

    async saveCompound(input) {
      try {
        const list = await readAll();
        const fp = fingerprint(input.moleculeName, input.formula);
        const existing = list.find(
          (c) => fingerprint(c.moleculeName, c.formula) === fp,
        );
        if (existing) {
          return { ok: false, reason: "duplicate", existing };
        }
        const compound: SavedCompound = {
          id: genId(),
          moleculeName: input.moleculeName,
          formula: input.formula,
          structureData: input.structureData,
          smiles: input.smiles,
          metadata: input.metadata,
          timestamp: new Date().toISOString(),
          favorite: false,
        };
        await writeAll([compound, ...list]);
        return { ok: true, compound };
      } catch (e) {
        return {
          ok: false,
          reason: "error",
          message: e instanceof Error ? e.message : "Unknown error",
        };
      }
    },

    async deleteCompound(id) {
      const list = await readAll();
      const next = list.filter((c) => c.id !== id);
      if (next.length === list.length) return false;
      await writeAll(next);
      return true;
    },

    async updateCompound(id, patch) {
      const list = await readAll();
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      const updated: SavedCompound = { ...list[idx], ...patch, id: list[idx].id };
      list[idx] = updated;
      await writeAll(list);
      return updated;
    },

    async isCompoundSaved(name, formula) {
      const list = await readAll();
      const fp = fingerprint(name, formula);
      return list.some((c) => fingerprint(c.moleculeName, c.formula) === fp);
    },

    async toggleFavorite(id) {
      const list = await readAll();
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], favorite: !list[idx].favorite };
      await writeAll(list);
      return list[idx];
    },

    async clearAllCompounds() {
      await store.removeItem(STORAGE_KEY);
    },
  };
}

/** Default app-wide instance backed by browser localStorage. */
export const libraryStorage: LibraryStorage = createLibraryStorage(browserStore);

/** Internal — exposed for tests / debug only. */
export const __internal = { STORAGE_KEY, fingerprint };
