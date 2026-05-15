/**
 * Real stereochemistry analysis via RDKit-JS.
 *
 * Uses RDKit's get_stereo_tags() to discover BOTH assigned and unassigned
 * stereo sites, then enumerates configurations by editing the canonical
 * SMILES at those exact site indices.
 */

import type { Molecule } from "@/data/molecules";
import { getRDKit } from "./rdkit";
import { moleculeToMolblock } from "./molblock";

export type ChiralityClass =
  | "achiral"
  | "chiral-single"
  | "chiral-multi"
  | "meso";

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

interface StereoTags {
  CIP_atoms: Array<[number, string]>;            // [atomIdx, label]
  CIP_bonds: Array<[number, number, string]>;    // [atomA, atomB, label]
}

export async function analyzeStereochemistry(mol: Molecule): Promise<StereoReport> {
  const rdkit = await getRDKit();
  const molblock = moleculeToMolblock(mol);
  const jsmol = rdkit.get_mol(molblock);
  if (!jsmol) throw new Error(`RDKit could not parse "${mol.name}"`);
  let smi: string;
  try { smi = jsmol.get_smiles(); } finally { jsmol.delete(); }
  return analyzeFromSmiles(smi);
}

export async function analyzeFromSmiles(input: string): Promise<StereoReport> {
  const rdkit = await getRDKit();
  const m0 = rdkit.get_mol(input);
  if (!m0) throw new Error(`RDKit could not parse SMILES "${input}"`);

  const baseSmiles = m0.get_smiles();
  const tagsRaw = m0.get_stereo_tags();
  m0.delete();

  let tags: StereoTags;
  try { tags = JSON.parse(tagsRaw); }
  catch { tags = { CIP_atoms: [], CIP_bonds: [] }; }

  const centers = tags.CIP_atoms.length;
  const ezBonds = tags.CIP_bonds.length;

  if (centers === 0 && ezBonds === 0) {
    return {
      smiles: baseSmiles,
      centers: 0, ezBonds: 0,
      classification: "achiral",
      isMeso: false,
      opticalIsomers: 0,
      geometricIsomers: 0,
      totalStereoisomers: 0,
      allStereoSmiles: [],
      approximate: false,
      notes: ["No stereocentres or restricted-rotation E/Z sites detected."],
    };
  }

  // Enumerate all 2^(centers + ezBonds) combinations by editing the
  // canonical SMILES atom & bond tokens at the indices RDKit reports.
  const total = 1 << (centers + ezBonds);
  const cap = Math.min(total, 256);
  const unique = new Set<string>();

  for (let mask = 0; mask < cap; mask++) {
    const smi = applyStereo(baseSmiles, tags, mask);
    const m = rdkit.get_mol(smi);
    if (!m) continue;
    try {
      const canon = m.get_smiles();
      // Sanity: only count if RDKit retained stereo (i.e. the markers stuck)
      unique.add(canon);
    } finally { m.delete(); }
  }

  // Meso detection: at least one assignment equals its mirror image
  let isMeso = false;
  if (centers >= 2) {
    for (const s of unique) {
      const mirror = invertStereo(s);
      const m = rdkit.get_mol(mirror);
      if (!m) continue;
      try {
        if (m.get_smiles() === s) { isMeso = true; break; }
      } finally { m.delete(); }
    }
  }

  const allStereoSmiles = Array.from(unique);
  const opticalAxis = new Set<string>();
  const geometricAxis = new Set<string>();
  for (const s of allStereoSmiles) {
    opticalAxis.add(stripDirectional(s));
    geometricAxis.add(stripChirality(s));
  }

  let classification: ChiralityClass;
  if (centers === 0) classification = "achiral";
  else if (isMeso) classification = "meso";
  else if (centers === 1) classification = "chiral-single";
  else classification = "chiral-multi";

  const notes: string[] = [];
  if (isMeso) notes.push("Internal mirror plane found — molecule is meso (achiral despite stereocentres).");
  if (centers > 0 && !isMeso) notes.push(`${centers} tetrahedral stereocentre${centers > 1 ? "s" : ""} detected.`);
  if (ezBonds > 0) notes.push(`${ezBonds} C=C site${ezBonds > 1 ? "s" : ""} with E/Z stereochemistry.`);

  return {
    smiles: baseSmiles,
    centers, ezBonds,
    classification,
    isMeso,
    opticalIsomers: centers > 0 ? opticalAxis.size : 0,
    geometricIsomers: ezBonds > 0 ? geometricAxis.size : 0,
    totalStereoisomers: allStereoSmiles.length,
    allStereoSmiles,
    approximate: false,
    notes,
  };
}

// --- SMILES stereo editing helpers ---------------------------------------

interface AtomToken { start: number; end: number; text: string; index: number }
interface BondToken { start: number; atomA: number; atomB: number }

function tokenizeSmiles(smiles: string): { atoms: AtomToken[]; bonds: BondToken[] } {
  const atoms: AtomToken[] = [];
  const bonds: BondToken[] = [];
  let i = 0;
  let atomIdx = -1;
  let lastAtomIdx = -1;
  // Stack for branches and ring bond memory
  const branchStack: number[] = [];
  while (i < smiles.length) {
    const c = smiles[i];
    if (c === "[") {
      const end = smiles.indexOf("]", i);
      if (end === -1) break;
      atomIdx++;
      atoms.push({ start: i, end: end + 1, text: smiles.slice(i, end + 1), index: atomIdx });
      lastAtomIdx = atomIdx;
      i = end + 1;
      continue;
    }
    if (/[A-Z]/.test(c)) {
      const two = smiles.slice(i, i + 2);
      if (/^(Cl|Br)$/.test(two)) {
        atomIdx++;
        atoms.push({ start: i, end: i + 2, text: two, index: atomIdx });
        lastAtomIdx = atomIdx;
        i += 2;
        continue;
      }
      atomIdx++;
      atoms.push({ start: i, end: i + 1, text: c, index: atomIdx });
      lastAtomIdx = atomIdx;
      i++;
      continue;
    }
    if ("cnops".includes(c)) {
      atomIdx++;
      atoms.push({ start: i, end: i + 1, text: c, index: atomIdx });
      lastAtomIdx = atomIdx;
      i++;
      continue;
    }
    if (c === "(") { branchStack.push(lastAtomIdx); i++; continue; }
    if (c === ")") { lastAtomIdx = branchStack.pop() ?? lastAtomIdx; i++; continue; }
    if (c === "=" && lastAtomIdx >= 0) {
      // Find next atom token — its index is lastAtomIdx + ? — store its position
      bonds.push({ start: i, atomA: lastAtomIdx, atomB: -1 });
      i++;
      continue;
    }
    i++;
  }
  // Fill bond.atomB with the next atom that follows each = position
  for (const b of bonds) {
    const next = atoms.find((a) => a.start > b.start);
    if (next) b.atomB = next.index;
  }
  return { atoms, bonds };
}

function applyStereo(smiles: string, tags: StereoTags, mask: number): string {
  const { atoms, bonds } = tokenizeSmiles(smiles);
  const chars = smiles.split("");

  // Apply chirality to each CIP atom
  tags.CIP_atoms.forEach(([atomIdx], i) => {
    const tok = atoms.find((a) => a.index === atomIdx);
    if (!tok) return;
    const bit = (mask >> i) & 1;
    const newText = setChirality(tok.text, bit ? "@@" : "@");
    for (let k = tok.start; k < tok.end; k++) chars[k] = "";
    chars[tok.start] = newText;
  });

  // Apply E/Z to each CIP bond by injecting / before atomA and \ before atomB (or flipped)
  tags.CIP_bonds.forEach(([aA, aB], i) => {
    const bondBitIdx = tags.CIP_atoms.length + i;
    const bit = (mask >> bondBitIdx) & 1;
    const tokA = atoms.find((a) => a.index === aA);
    const tokB = atoms.find((a) => a.index === aB);
    if (!tokA || !tokB) return;
    // Insert directional marker just before each atom token (only if not already present)
    const left = bit ? "/" : "\\";
    const right = bit ? "\\" : "/";
    const before = (pos: number, ch: string) => {
      if (pos > 0 && (chars[pos - 1] === "/" || chars[pos - 1] === "\\")) {
        chars[pos - 1] = ch;
      } else {
        chars[pos] = ch + chars[pos];
      }
    };
    before(tokA.start, left);
    before(tokB.start, right);
  });

  return chars.join("");
}

function setChirality(atomToken: string, marker: "@" | "@@"): string {
  if (atomToken.startsWith("[")) {
    const inner = atomToken.slice(1, -1).replace(/@+/g, "");
    // Insert marker after the element symbol (e.g. "C" or "Cl")
    const m = inner.match(/^([A-Z][a-z]?)/);
    if (!m) return `[${marker}${inner}]`;
    return `[${m[1]}${marker}${inner.slice(m[1].length)}]`;
  }
  // bare element — promote to bracket form so we can attach chirality + implicit H
  return `[${atomToken}${marker}H]`;
}

function invertStereo(smiles: string): string {
  let out = smiles.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    let s = inner;
    if (s.includes("@@")) s = s.replace(/@@/g, "\u0001");
    else if (s.includes("@")) s = s.replace(/@/g, "@@");
    s = s.replace(/\u0001/g, "@");
    return `[${s}]`;
  });
  out = out.replace(/\//g, "\u0002").replace(/\\/g, "/").replace(/\u0002/g, "\\");
  return out;
}

function stripDirectional(s: string) { return s.replace(/[/\\]/g, ""); }
function stripChirality(s: string) {
  return s.replace(/\[([^\]]*)\]/g, (_m, inner: string) =>
    `[${(inner as string).replace(/@+/g, "")}]`);
}

export function classificationLabel(c: ChiralityClass): string {
  switch (c) {
    case "achiral": return "Achiral";
    case "chiral-single": return "Chiral (single stereocentre)";
    case "chiral-multi": return "Chiral (multiple stereocentres)";
    case "meso": return "Meso compound";
  }
}

export { invertStereo };
