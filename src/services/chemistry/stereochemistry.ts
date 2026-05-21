import type { Molecule } from "@/data/molecules";
import { getRDKit } from "./rdkit";
import { parseSDF } from "@/lib/iupac";
import { moleculeToMolblock } from "./molblock";
import {
  analyzeStereochemistry as analyzeCanonicalStereochemistry,
  type ChiralityClass,
} from "@/lib/stereochemistryEngine";

export type { ChiralityClass };

export interface StereoReport {
  smiles: string;
  centers: number;
  ezBonds: number;
  classification: ChiralityClass;
  isMeso: boolean;
  opticalIsomers: number;
  geometricIsomers: number;
  totalStereoisomers: number;
  allStereoSmiles: string[];
  approximate: false;
  notes: string[];
}

function toReport(mol: Molecule, smiles = ""): StereoReport {
  const a = analyzeCanonicalStereochemistry(mol);
  const generated = [
    ...a.enantiomerPairs.flat(),
    ...a.mesoStructures,
    ...a.geometricalPairs.flat(),
  ];
  return {
    smiles,
    centers: a.stereocentres.length,
    ezBonds: a.geomSites,
    classification: a.classification,
    isMeso: a.isMeso,
    opticalIsomers: a.opticalIsomerCount,
    geometricIsomers: a.geometricalIsomerCount,
    totalStereoisomers: a.totalStereoisomers,
    allStereoSmiles: generated,
    approximate: false,
    notes: a.notes,
  };
}

export async function analyzeStereochemistry(mol: Molecule): Promise<StereoReport> {
  let smiles = "";
  try {
    const rdkit = await getRDKit();
    const jsmol = rdkit.get_mol(moleculeToMolblock(mol));
    if (jsmol) {
      try { smiles = jsmol.get_smiles(); } finally { jsmol.delete(); }
    }
  } catch {
    // The canonical graph engine remains authoritative if RDKit is unavailable.
  }
  return toReport(mol, smiles);
}

export async function analyzeFromSmiles(input: string): Promise<StereoReport> {
  const rdkit = await getRDKit();
  const m = rdkit.get_mol(input);
  if (!m) throw new Error(`RDKit could not parse SMILES "${input}"`);
  try {
    m.set_new_coords(true);
    const mol = parseSDF(m.get_molblock(), input);
    if (!mol) throw new Error(`Could not parse RDKit molecule for "${input}"`);
    return toReport(mol, m.get_smiles());
  } finally {
    m.delete();
  }
}

export function classificationLabel(c: ChiralityClass): string {
  switch (c) {
    case "achiral": return "Achiral";
    case "chiral-single": return "Chiral (single stereocentre)";
    case "chiral-multi": return "Chiral (multiple stereocentres)";
    case "meso": return "Meso compound";
  }
}
