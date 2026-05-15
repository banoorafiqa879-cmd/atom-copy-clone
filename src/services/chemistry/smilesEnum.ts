/**
 * Lightweight SMILES stereo enumerator.
 *
 * RDKit's "minimal" JS build does NOT expose EnumerateStereoisomers, so we
 * enumerate by mutating SMILES atom/bond tokens and dedupe via RDKit's
 * canonical SMILES. This is exact for the chiral/E-Z cases we care about.
 */

import { getRDKit } from "./rdkit";

export interface StereoToken {
  kind: "atom" | "bond";
  start: number; // index into smiles
  end: number;   // exclusive
  text: string;
}

/** Parse a SMILES string into tokens we can target for stereo flipping. */
function tokenize(smiles: string): StereoToken[] {
  const out: StereoToken[] = [];
  let i = 0;
  while (i < smiles.length) {
    const c = smiles[i];
    if (c === "[") {
      const end = smiles.indexOf("]", i);
      if (end === -1) break;
      out.push({ kind: "atom", start: i, end: end + 1, text: smiles.slice(i, end + 1) });
      i = end + 1;
      continue;
    }
    // Two-letter atoms
    if (/[A-Z]/.test(c)) {
      const two = smiles.slice(i, i + 2);
      if (/^(Cl|Br)$/.test(two)) {
        out.push({ kind: "atom", start: i, end: i + 2, text: two });
        i += 2;
        continue;
      }
      out.push({ kind: "atom", start: i, end: i + 1, text: c });
      i++;
      continue;
    }
    if (c === "c" || c === "n" || c === "o" || c === "s" || c === "p") {
      out.push({ kind: "atom", start: i, end: i + 1, text: c });
      i++;
      continue;
    }
    if (c === "=") {
      out.push({ kind: "bond", start: i, end: i + 1, text: c });
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** Strip all stereo markers from a SMILES (chirality + directional bonds). */
export function stripStereo(smiles: string): string {
  // remove @ and @@ inside bracket atoms
  return smiles
    .replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
      const cleaned = inner.replace(/@+/g, "");
      return `[${cleaned}]`;
    })
    .replace(/\//g, "")
    .replace(/\\/g, "");
}

/**
 * Detect stereo-eligible sites in a SMILES that has been canonicalized
 * by RDKit with stereo perception ON. Returns indices of atoms that
 * already carry @ markers and bonds (= positions) flanked by directional
 * markers (/ or \) — these are the RDKit-detected real stereo sites.
 */
function detectAssignedSites(smiles: string): { atomIdx: number[]; bondIdx: number[] } {
  const tokens = tokenize(smiles);
  const atomIdx: number[] = [];
  const bondIdx: number[] = [];
  let atomCounter = -1;
  for (const t of tokens) {
    if (t.kind === "atom") {
      atomCounter++;
      if (t.text.includes("@")) atomIdx.push(atomCounter);
    } else {
      // bond: check neighboring chars in original smiles
      bondIdx.push(t.start);
    }
  }
  // Only keep = bonds that are flanked by / or \
  const realBonds = bondIdx.filter((pos) => {
    const before = smiles.slice(Math.max(0, pos - 4), pos);
    const after = smiles.slice(pos + 1, pos + 5);
    return /[/\\\\]/.test(before) && /[/\\\\]/.test(after);
  });
  return { atomIdx, bondIdx: realBonds };
}

/** Flip every chirality marker and every directional bond marker. */
export function invertStereo(smiles: string): string {
  // swap @ ↔ @@ inside brackets (do double first)
  let out = smiles.replace(/\[([^\]]*)\]/g, (_m, inner: string) => {
    let s = inner;
    if (s.includes("@@")) s = s.replace(/@@/g, "\u0001");
    else if (s.includes("@")) s = s.replace(/@/g, "@@");
    s = s.replace(/\u0001/g, "@");
    return `[${s}]`;
  });
  // swap / and \ globally (use placeholder)
  out = out.replace(/\//g, "\u0002").replace(/\\/g, "/").replace(/\u0002/g, "\\");
  return out;
}

/**
 * Enumerate all unique stereoisomer SMILES of a molecule, given a base
 * (already-canonicalized, fully-assigned) SMILES from RDKit. The base
 * must contain explicit @ / and \ markers for every stereo site RDKit
 * could perceive — that's what `get_smiles()` returns when 3D coords are
 * present.
 *
 * Returns:
 *   - smiles: array of unique canonical SMILES (one per stereoisomer)
 *   - centers: number of detected tetrahedral centers
 *   - bonds:   number of detected E/Z bonds
 */
export async function enumerateStereoisomerSmiles(
  baseAssignedSmiles: string,
): Promise<{ smiles: string[]; centers: number; bonds: number }> {
  const sites = detectAssignedSites(baseAssignedSmiles);
  const n = sites.atomIdx.length;
  const m = sites.bondIdx.length;

  if (n === 0 && m === 0) {
    return { smiles: [], centers: 0, bonds: 0 };
  }

  const rdkit = await getRDKit();
  const variants = new Set<string>();
  const total = 1 << (n + m);
  // Cap enumeration to keep the worst case bounded.
  const cap = Math.min(total, 256);

  const atomTokens = tokenize(baseAssignedSmiles).filter((t) => t.kind === "atom");
  const bondTokens = tokenize(baseAssignedSmiles).filter((t) => t.kind === "bond");
  const targetAtomTokens = sites.atomIdx.map((idx) => atomTokens[idx]);
  const targetBondTokens = bondTokens.filter((t) => sites.bondIdx.includes(t.start));

  for (let mask = 0; mask < cap; mask++) {
    // Build a copy of the SMILES with bits applied
    const chars = baseAssignedSmiles.split("");
    for (let i = 0; i < n; i++) {
      const tok = targetAtomTokens[i];
      const inner = tok.text.slice(1, -1);
      const flipped = (mask >> i) & 1 ? invertStereo(`[${inner}]`) : `[${inner}]`;
      // Replace in chars
      for (let k = tok.start; k < tok.end; k++) chars[k] = "";
      chars[tok.start] = flipped;
    }
    // E/Z bonds: for each, when bit set, swap the directional markers around the =
    for (let j = 0; j < m; j++) {
      const tok = targetBondTokens[j];
      if (((mask >> (n + j)) & 1) === 0) continue;
      // Swap nearest / and \ within ±3 chars on each side
      const swapAt = (idx: number) => {
        if (chars[idx] === "/") chars[idx] = "\\";
        else if (chars[idx] === "\\") chars[idx] = "/";
      };
      // Only swap the right-hand directional marker — that flips E/Z
      for (let k = tok.start + 1; k < Math.min(chars.length, tok.start + 5); k++) {
        if (chars[k] === "/" || chars[k] === "\\") {
          swapAt(k);
          break;
        }
      }
    }
    const candidate = chars.join("");
    const m2 = rdkit.get_mol(candidate);
    if (!m2) continue;
    try {
      const canon = m2.get_smiles();
      if (canon) variants.add(canon);
    } finally {
      m2.delete();
    }
  }

  return { smiles: Array.from(variants), centers: n, bonds: m };
}
