import { useCallback, useEffect, useMemo, useState } from "react";
import { libraryStorage } from "@/services/storageService";
import type {
  SavedCompound,
  SaveCompoundInput,
  SaveResult,
} from "@/types/library";

/**
 * In-memory event bus so multiple `useLibrary` consumers stay in sync
 * without needing a global store. localStorage events handle cross-tab.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => l());
}

export interface UseLibrary {
  compounds: SavedCompound[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (input: SaveCompoundInput) => Promise<SaveResult>;
  remove: (id: string) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<SavedCompound | null>;
  isSaved: (name: string, formula: string) => boolean;
  clearAll: () => Promise<void>;
}

export function useLibrary(): UseLibrary {
  const [compounds, setCompounds] = useState<SavedCompound[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await libraryStorage.getAllCompounds();
      setCompounds(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener: Listener = () => {
      void refresh();
    };
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("atom-forge:library")) void refresh();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }
    return () => {
      listeners.delete(listener);
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, [refresh]);

  const save = useCallback(async (input: SaveCompoundInput) => {
    const result = await libraryStorage.saveCompound(input);
    if (result.ok) notify();
    return result;
  }, []);

  const remove = useCallback(async (id: string) => {
    const ok = await libraryStorage.deleteCompound(id);
    if (ok) notify();
    return ok;
  }, []);

  const toggleFavorite = useCallback(async (id: string) => {
    const updated = await libraryStorage.toggleFavorite(id);
    if (updated) notify();
    return updated;
  }, []);

  const clearAll = useCallback(async () => {
    await libraryStorage.clearAllCompounds();
    notify();
  }, []);

  const savedIndex = useMemo(() => {
    const set = new Set<string>();
    compounds.forEach((c) =>
      set.add(
        `${c.moleculeName.trim().toLowerCase()}|${c.formula.trim().toLowerCase()}`,
      ),
    );
    return set;
  }, [compounds]);

  const isSaved = useCallback(
    (name: string, formula: string) =>
      savedIndex.has(
        `${name.trim().toLowerCase()}|${formula.trim().toLowerCase()}`,
      ),
    [savedIndex],
  );

  return { compounds, loading, error, refresh, save, remove, toggleFavorite, isSaved, clearAll };
}
