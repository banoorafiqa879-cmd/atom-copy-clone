/**
 * Real stereochemistry analysis via RDKit-JS.
 *
 * We treat the internal `Molecule` (atoms+bonds+3D coords) as the source of
 * truth, hand it to RDKit as a V2000 MOL block, and let RDKit perceive
 * stereochemistry from the 3D coordinates. Counts and classification are
 * derived from RDKit output — no naive 2^n.
 */

import type { Molecule } from "@/data/molecules";
import { getRDKit } from "./rdkit";
import { moleculeToMolblock } from "./molblock";
import {
  enumerateStereoisomerSmiles,
  invertStereo,
  stripStereo,
} from "./smilesEnum";

export type ChiralityClass =
  | "achiral"
  | "chiral-single"
  | "chiral-multi"
  | "meso";

export interface StereoReport {
  smiles: string;            // canonical SMILES (with assigned stereo)
  centers: number;           // tetrahedral stereocenters detected by RDKit
  ezBonds: number;           // E/Z double bonds detected by RDKit
  classification: ChiralityClass;
  isMeso: boolean;
  opticalIsomers: number;    // unique stereoisomers ignoring E/Z (post-meso)
  geometricIsomers: number;  // unique stereoisomers from E/Z only
  totalStereoisomers: number;// unique total isomers (post-meso)
  allStereoSmiles: string[]; // canonical SMILES of every enumerated isomer
  approximate: false;        // engine output is exact
  notes: string[];
}

export async function analyzeStereochemistry(mol: Molecule): Promise<StereoReport> {
  const rdkit = await getRDKit();
  const molblock = moleculeToMolblock(mol);
  const jsmol = rdkit.get_mol(molblock);
  if (!jsmol) {
    throw new Error(`RDKit could not parse "${mol.name}"`);
  }
  let assigned: string;
  try {
    assigned = jsmol.get_smiles();
  } finally {
    jsmol.delete();
  }
  return analyzeFromSmiles(assigned);
}

/** Analyze a molecule directly from a SMILES string (preserves all stereo markers). */
export async function analyzeFromSmiles(smiles: string): Promise<StereoReport> {
  const rdkit = await getRDKit();
  const jsmol = rdkit.get_mol(smiles);
  if (!jsmol) throw new Error(`RDKit could not parse SMILES "${smiles}"`);
  let assigned: string;
  try {
    assigned = jsmol.get_smiles();
  } finally {
    jsmol.delete();
  }

  // Enumerate over RDKit-perceived stereo sites
  const enumerated = await enumerateStereoisomerSmiles(assigned);
  const { centers, bonds: ezBonds, smiles: allStereoSmiles } = enumerated;

  // Meso = at least one configuration is its own mirror image
  let isMeso = false;
  if (centers >= 2) {
    for (const s of allStereoSmiles) {
      const mirror = invertStereo(s);
      const m2 = rdkit.get_mol(mirror);
      if (!m2) continue;
      try {
        if (m2.get_smiles() === s) {
          isMeso = true;
          break;
        }
      } finally {
        m2.delete();
      }
    }
  }

  // Decompose totals into "optical only" vs "geometric only" axes by
  // collapsing variants that differ only in E/Z (or only in chirality).
  const opticalAxis = new Set<string>();
  const geometricAxis = new Set<string>();
  for (const s of allStereoSmiles) {
    opticalAxis.add(stripDirectional(s));
    geometricAxis.add(stripChirality(s));
  }
  const opticalIsomers = centers > 0 ? opticalAxis.size : 0;
  const geometricIsomers = ezBonds > 0 ? geometricAxis.size : 0;
  const totalStereoisomers = allStereoSmiles.length;

  let classification: ChiralityClass;
  if (centers === 0) classification = "achiral";
  else if (isMeso) classification = "meso";
  else if (centers === 1) classification = "chiral-single";
  else classification = "chiral-multi";

  const notes: string[] = [];
  if (isMeso) {
    notes.push("Internal mirror plane found — molecule is meso (achiral despite stereocentres).");
  }
  if (centers > 0 && !isMeso) {
    notes.push(`${centers} independent tetrahedral stereocentre${centers > 1 ? "s" : ""}.`);
  }
  if (ezBonds > 0) {
    notes.push(`${ezBonds} C=C site${ezBonds > 1 ? "s" : ""} with E/Z stereochemistry.`);
  }
  if (centers === 0 && ezBonds === 0) {
    notes.push("No stereocentres or restricted-rotation E/Z sites detected.");
  }

  return {
    smiles: assigned,
    centers,
    ezBonds,
    classification,
    isMeso,
    opticalIsomers,
    geometricIsomers,
    totalStereoisomers,
    allStereoSmiles,
    approximate: false,
    notes,
  };
}

function stripDirectional(s: string) {
  return s.replace(/[/\\]/g, "");
}
function stripChirality(s: string) {
  return s.replace(/\[([^\]]*)\]/g, (_m, inner: string) =>
    `[${(inner as string).replace(/@+/g, "")}]`,
  );
}

export function classificationLabel(c: ChiralityClass): string {
  switch (c) {
    case "achiral": return "Achiral";
    case "chiral-single": return "Chiral (single stereocentre)";
    case "chiral-multi": return "Chiral (multiple stereocentres)";
    case "meso": return "Meso compound";
  }
}

export { stripStereo };
