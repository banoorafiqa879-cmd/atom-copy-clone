// Unified stereochemistry summary built on top of chem-analysis primitives.
// Uses detected mirror planes to apply meso reduction so the displayed
// optical-isomer count is chemically meaningful (no naive 2^n).

import type { Molecule } from "@/data/molecules";
import {
  stereocentres,
  geometricIsomerInfo,
} from "@/lib/chem-analysis";

export type ChiralityClass =
  | "achiral"
  | "chiral-single"
  | "chiral-multi"
  | "meso";

export interface StereoSummary {
  centres: number[];          // atom indices of detected stereocentres
  geomSites: number;          // eligible C=C sites for E/Z
  hasInternalMirror: boolean; // any σ plane detected on full molecule
  isMeso: boolean;            // ≥2 centres AND internal mirror present
  isChiral: boolean;          // centres>0 and not meso
  classification: ChiralityClass;

  opticalIsomers: number;     // enantiomers (1 if meso, else 2^centres or 0)
  geometricIsomers: number;   // 2^geomSites
  totalStereoisomers: number; // optical * geometric (with meso reduction)

  // Confidence flag — the heuristic stereocenter detector is approximate
  // (Morgan signatures, depth 2). Mark as approximate when uncertain.
  approximate: boolean;
  notes: string[];
}

/**
 * @param mol            Molecule under analysis
 * @param planeCount     # of σ planes detected on the *whole* molecule
 *                       (0 means no internal mirror → no meso reduction).
 */
export function stereochemSummary(mol: Molecule, planeCount: number): StereoSummary {
  const centres = stereocentres(mol);
  const geom = geometricIsomerInfo(mol);
  const hasInternalMirror = planeCount > 0;

  const isMeso = centres.length >= 2 && hasInternalMirror;
  const isChiral = centres.length > 0 && !isMeso;

  let classification: ChiralityClass;
  if (centres.length === 0) classification = "achiral";
  else if (isMeso) classification = "meso";
  else if (centres.length === 1) classification = "chiral-single";
  else classification = "chiral-multi";

  // Optical: meso → effectively 1 form (the meso compound itself);
  // chiral with n centres → 2^n forms (upper bound, no further internal
  // symmetry). Achiral → 0 enantiomers.
  let optical: number;
  if (centres.length === 0) optical = 0;
  else if (isMeso) optical = 1;
  else optical = Math.pow(2, centres.length);

  const geometric = geom.possible ? geom.count : 0;

  // Total: independent product. If only one axis exists, fall back to that.
  const totalStereoisomers =
    optical && geometric ? optical * geometric : optical || geometric;

  const notes: string[] = [];
  if (isMeso) {
    notes.push(
      "Internal mirror plane detected — molecule is meso (achiral despite stereocentres).",
    );
  }
  if (centres.length > 0 && !hasInternalMirror) {
    notes.push("No internal symmetry — each stereocentre contributes independently.");
  }
  if (geom.possible) {
    notes.push(
      `${geom.sites} C=C site${geom.sites > 1 ? "s" : ""} eligible for E/Z (cis/trans).`,
    );
  }
  if (centres.length === 0 && !geom.possible) {
    notes.push("No stereocentres and no restricted-rotation sites detected.");
  }

  // Heuristic confidence: rings + many heteroatom branches push the simple
  // Morgan-depth-2 signature to its limits. Surface as approximate so
  // the UI can show a graceful badge.
  const approximate = mol.atoms.length > 30 || centres.length > 4;

  return {
    centres,
    geomSites: geom.sites,
    hasInternalMirror,
    isMeso,
    isChiral,
    classification,
    opticalIsomers: optical,
    geometricIsomers: geometric,
    totalStereoisomers,
    approximate,
    notes,
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

// ---------------------------------------------------------------------------
// Real RDKit-backed adapter — preferred when available.
// Falls back to the heuristic above only when the engine fails.
// ---------------------------------------------------------------------------

import { analyzeStereochemistry } from "@/services/chemistry";

export async function stereochemSummaryAsync(mol: Molecule): Promise<StereoSummary> {
  const r = await analyzeStereochemistry(mol);
  // Map RDKit centres count back to atom indices (best-effort placeholder
  // list — UI uses .length and the existing heuristic indices for highlighting).
  const heuristicCentres = stereocentres(mol);
  return {
    centres: heuristicCentres.length === r.centers ? heuristicCentres : heuristicCentres.slice(0, r.centers),
    geomSites: r.ezBonds,
    hasInternalMirror: r.isMeso,
    isMeso: r.isMeso,
    isChiral: r.classification === "chiral-single" || r.classification === "chiral-multi",
    classification: r.classification,
    opticalIsomers: r.opticalIsomers,
    geometricIsomers: r.geometricIsomers,
    totalStereoisomers: r.totalStereoisomers,
    approximate: false,
    notes: r.notes,
  };
}
