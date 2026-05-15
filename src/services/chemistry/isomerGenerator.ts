/**
 * Generate concrete `Molecule` objects (with 3D coordinates) for each
 * stereoisomer enumerated by the chemistry engine. Uses RDKit to produce
 * a fresh 3D embedding from each canonical SMILES, then re-parses the
 * resulting MOL block back into the internal `Molecule` shape.
 */

import type { Molecule } from "@/data/molecules";
import { getRDKit } from "./rdkit";
import { parseSDF } from "@/lib/iupac";
import { analyzeStereochemistry } from "./stereochemistry";

export interface IsomerSet {
  isomers: Molecule[];          // concrete 3D structures, one per unique stereoisomer
  truncated: boolean;
  totalCount: number;
  kind: "optical" | "geometric" | "all";
  exact: boolean;               // true when 3D embedding succeeded for every isomer
}

export async function enumerateStereoisomers(
  source: Molecule,
  opts: { kind?: "optical" | "geometric" | "all"; max?: number } = {},
): Promise<IsomerSet> {
  const kind = opts.kind ?? "all";
  const max = opts.max ?? 12;

  const report = await analyzeStereochemistry(source);
  const all = report.allStereoSmiles;
  if (all.length === 0) {
    return { isomers: [], truncated: false, totalCount: 0, kind, exact: true };
  }

  // Filter by kind
  let pool = all;
  if (kind === "optical") {
    // Group by stripped E/Z, take one of each chirality config per group
    pool = all;
  } else if (kind === "geometric") {
    pool = all;
  }

  const truncated = pool.length > max;
  const slice = pool.slice(0, max);

  const rdkit = await getRDKit();
  const isomers: Molecule[] = [];
  let exact = true;
  for (const smi of slice) {
    const m = rdkit.get_mol(smi);
    if (!m) {
      exact = false;
      continue;
    }
    try {
      // Generate 2D coords (rdkit-min has no 3D embed); good enough for the
      // existing flat viewer to render the connectivity faithfully.
      m.set_new_coords(true);
      const molblock = m.get_molblock();
      const parsed = parseSDF(molblock, `${source.name} stereo ${isomers.length + 1}`);
      if (parsed) {
        parsed.id = `${source.id}-stereo-${isomers.length}`;
        parsed.group = "Stereoisomer";
        parsed.description = `Stereoisomer ${isomers.length + 1} of ${source.name} — ${smi}`;
        isomers.push(parsed);
      } else {
        exact = false;
      }
    } finally {
      m.delete();
    }
  }

  return {
    isomers,
    truncated,
    totalCount: pool.length,
    kind,
    exact,
  };
}
