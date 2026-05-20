// Unified stereochemistry summary — single source of truth used by both the
// Stereo Lab and the Isomerism Lab. Built on top of the chem-analysis
// primitives so every panel reports identical numbers.
//
// Why not RDKit-JS here? `get_stereo_tags()` only reports stereo for atoms /
// bonds whose configuration has been explicitly assigned in the source MOL
// or SMILES. Molecules generated from 3D coordinates (e.g. CACTUS SDF, the
// in-app builder) have no bond directional marks, so RDKit returns zero
// E/Z sites for clearly stereogenic alkenes like 2-butene. The heuristic
// engine below detects *potential* stereo from connectivity, which is what
// the chemistry textbook count is asking for.

import type { Molecule } from "@/data/molecules";
import {
  analyzeStereochemistry,
  type ChiralityClass,
} from "@/lib/stereochemistryEngine";

export interface StereoSummary {
  centres: number[];          // atom indices of detected stereocentres
  geomSites: number;          // eligible C=C sites for E/Z
  hasInternalMirror: boolean; // any σ plane detected on full molecule
  isMeso: boolean;            // ≥2 centres AND internal symmetry that pairs them
  isChiral: boolean;          // centres>0 and not meso
  classification: ChiralityClass;

  opticalIsomers: number;     // distinct optical isomers (with meso reduction)
  geometricIsomers: number;   // 2^geomSites
  totalStereoisomers: number; // optical × geometric (or single axis fallback)

  approximate: boolean;
  notes: string[];
}

/**
 * @param mol            Molecule under analysis
 * @param planeCount     # of σ planes detected on the *whole* molecule by
 *                       the geometric symmetry detector. Used as a second
 *                       signal for meso classification.
 */
export function stereochemSummary(mol: Molecule, planeCount: number): StereoSummary {
  const analysis = analyzeStereochemistry(mol);
  const hasInternalMirror = analysis.hasInternalMirror || planeCount > 0;

  return {
    centres: analysis.stereocentres,
    geomSites: analysis.geomSites,
    hasInternalMirror,
    isMeso: analysis.isMeso,
    isChiral: analysis.isChiral,
    classification: analysis.classification,
    opticalIsomers: analysis.opticalIsomerCount,
    geometricIsomers: analysis.geometricalIsomerCount,
    totalStereoisomers: analysis.totalStereoisomers,
    approximate: false,
    notes: analysis.notes,
  };
}

export function classificationLabel(c: ChiralityClass): string {
  switch (c) {
    case "achiral": return "Achiral";
    case "chiral-single": return "Chiral (single stereocentre)";
    case "chiral-multi": return "Chiral (multiple stereocentres)";
    case "meso": return "Meso compound";
  }
}

/**
 * Async variant kept for API compatibility. The unified engine is fully
 * synchronous now; we wrap it in a resolved promise so existing callers
 * (Viewer) keep working without changes.
 */
export async function stereochemSummaryAsync(
  mol: Molecule,
  planeCount = 0,
): Promise<StereoSummary> {
  return stereochemSummary(mol, planeCount);
}
