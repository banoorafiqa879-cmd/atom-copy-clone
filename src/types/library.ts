import type { Molecule } from "@/data/molecules";

/**
 * A compound that has been saved to the user's local library.
 * `structureData` is the full Molecule payload required to reopen the
 * 3D viewer later without re-fetching/regenerating.
 */
export interface SavedCompound {
  id: string;
  moleculeName: string;
  formula: string;
  structureData: Molecule;
  smiles?: string;
  timestamp: string; // ISO date
  favorite: boolean;
  metadata?: Record<string, unknown>;
}

export interface SaveCompoundInput {
  moleculeName: string;
  formula: string;
  structureData: Molecule;
  smiles?: string;
  metadata?: Record<string, unknown>;
}

export type SaveResult =
  | { ok: true; compound: SavedCompound }
  | { ok: false; reason: "duplicate"; existing: SavedCompound }
  | { ok: false; reason: "error"; message: string };
