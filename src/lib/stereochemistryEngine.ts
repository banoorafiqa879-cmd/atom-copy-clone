import * as THREE from "three";
import type { Bond, Element, Molecule } from "@/data/molecules";

export type ChiralityClass = "achiral" | "chiral-single" | "chiral-multi" | "meso";

export interface StereoLigand {
  atomIndex: number | null;
  element: Element | "H";
  signature: string;
  priority: string;
  implicit: boolean;
}

export interface StereoCenterInfo {
  atomIndex: number;
  ligands: StereoLigand[];
  equivalenceKey: string;
}

export interface GeometricStereoSite {
  bondIndex: number;
  a: number;
  b: number;
  ringSize: number | null;
  ringConstrained: boolean;
  renderable: boolean;
  cisTransAllowed: boolean;
  ligandsA: StereoLigand[];
  ligandsB: StereoLigand[];
}

export interface StereoAnalysis {
  stereocentres: number[];
  stereoCenters: StereoCenterInfo[];
  geomSites: number;
  geometricSites: GeometricStereoSite[];
  hasInternalMirror: boolean;
  isMeso: boolean;
  isChiral: boolean;
  hasEnantiomericPairs: boolean;
  hasMesoForms: boolean;
  classification: ChiralityClass;
  opticalIsomerCount: number;
  geometricalIsomerCount: number;
  totalStereoisomers: number;
  mesoStructures: string[];
  enantiomerPairs: Array<[string, string]>;
  geometricalPairs: Array<[string, string]>;
  symmetryPlanes: SymmetryPlaneInfo[];
  hasSymmetryCentre: boolean;
  notes: string[];
  approximate: false;
}

export interface SymmetryPlaneInfo {
  normal: [number, number, number];
  label: string;
}

const VALENCE: Record<Element, number> = {
  H: 1,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  S: 2,
  Cl: 1,
  Br: 1,
};

const ATOMIC_NO: Record<Element | "H", number> = {
  H: 1,
  C: 6,
  N: 7,
  O: 8,
  F: 9,
  S: 16,
  Cl: 17,
  Br: 35,
};

function neighbors(mol: Molecule, i: number): { idx: number; bond: Bond; bondIndex: number }[] {
  const out: { idx: number; bond: Bond; bondIndex: number }[] = [];
  mol.bonds.forEach((bond, bondIndex) => {
    if (bond.a === i) out.push({ idx: bond.b, bond, bondIndex });
    else if (bond.b === i) out.push({ idx: bond.a, bond, bondIndex });
  });
  return out;
}

function usedValence(mol: Molecule, atomIndex: number): number {
  return neighbors(mol, atomIndex).reduce((sum, n) => sum + n.bond.order, 0);
}

function implicitHydrogens(mol: Molecule, atomIndex: number): number {
  const atom = mol.atoms[atomIndex];
  if (atom.el === "H") return 0;
  const nominal = VALENCE[atom.el] ?? 0;
  return Math.max(0, nominal - usedValence(mol, atomIndex));
}

function branchSignature(
  mol: Molecule,
  atomIndex: number,
  from: number,
  depth: number,
  visited: Set<number> = new Set(),
): string {
  const atom = mol.atoms[atomIndex];
  const h = implicitHydrogens(mol, atomIndex);
  if (depth <= 0 || visited.has(atomIndex)) return `${atom.el}${h ? `H${h}` : ""}`;
  const nextVisited = new Set(visited);
  nextVisited.add(atomIndex);
  const branches = neighbors(mol, atomIndex)
    .filter((n) => n.idx !== from)
    .map((n) => `${n.bond.order}:${branchSignature(mol, n.idx, atomIndex, depth - 1, nextVisited)}`);
  for (let i = 0; i < h; i++) branches.push("1:H");
  branches.sort();
  return `${atom.el}${h ? `H${h}` : ""}[${branches.join("|")}]`;
}

function ligandForAtom(mol: Molecule, atomIndex: number, center: number): StereoLigand {
  const signature = branchSignature(mol, atomIndex, center, 6);
  const element = mol.atoms[atomIndex].el;
  return {
    atomIndex,
    element,
    signature,
    priority: `${String(ATOMIC_NO[element]).padStart(3, "0")}:${signature}`,
    implicit: false,
  };
}

function implicitHydrogenLigand(): StereoLigand {
  return {
    atomIndex: null,
    element: "H",
    signature: "H",
    priority: `${String(ATOMIC_NO.H).padStart(3, "0")}:H`,
    implicit: true,
  };
}

function substituentLigands(mol: Molecule, center: number, exclude?: number): StereoLigand[] {
  const ligands = neighbors(mol, center)
    .filter((n) => n.idx !== exclude)
    .map((n) => ligandForAtom(mol, n.idx, center));
  const h = implicitHydrogens(mol, center);
  for (let i = 0; i < h; i++) ligands.push(implicitHydrogenLigand());
  return ligands.sort((a, b) => b.priority.localeCompare(a.priority));
}

function smallestRingSize(mol: Molecule, bondIndex: number): number | null {
  const bond = mol.bonds[bondIndex];
  const adj = new Map<number, number[]>();
  mol.bonds.forEach((b, i) => {
    if (i === bondIndex) return;
    if (!adj.has(b.a)) adj.set(b.a, []);
    if (!adj.has(b.b)) adj.set(b.b, []);
    adj.get(b.a)!.push(b.b);
    adj.get(b.b)!.push(b.a);
  });
  const dist = new Map<number, number>([[bond.a, 0]]);
  const queue = [bond.a];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === bond.b) return (dist.get(cur) ?? 0) + 1;
    for (const next of adj.get(cur) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, (dist.get(cur) ?? 0) + 1);
      queue.push(next);
    }
  }
  return null;
}

function detectStereoCenters(mol: Molecule): StereoCenterInfo[] {
  const centres: StereoCenterInfo[] = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    if (mol.atoms[i].el !== "C") continue;
    const ns = neighbors(mol, i);
    if (ns.some((n) => n.bond.order !== 1)) continue;
    const ligands = substituentLigands(mol, i);
    if (ligands.length !== 4) continue;
    if (new Set(ligands.map((l) => l.signature)).size !== 4) continue;
    centres.push({
      atomIndex: i,
      ligands,
      equivalenceKey: ligands.map((l) => l.signature).sort().join("||"),
    });
  }
  return centres;
}

function detectGeometricSites(mol: Molecule): GeometricStereoSite[] {
  const sites: GeometricStereoSite[] = [];
  for (let bondIndex = 0; bondIndex < mol.bonds.length; bondIndex++) {
    const bond = mol.bonds[bondIndex];
    if (bond.order !== 2) continue;
    if (mol.atoms[bond.a].el !== "C" || mol.atoms[bond.b].el !== "C") continue;
    const ligandsA = substituentLigands(mol, bond.a, bond.b);
    const ligandsB = substituentLigands(mol, bond.b, bond.a);
    if (ligandsA.length !== 2 || ligandsB.length !== 2) continue;
    if (ligandsA[0].signature === ligandsA[1].signature) continue;
    if (ligandsB[0].signature === ligandsB[1].signature) continue;
    const ringSize = smallestRingSize(mol, bondIndex);
    if (ringSize !== null && ringSize < 8) continue;
    const cisTransAllowed = (
      (ligandsA[0].signature === ligandsB[0].signature && ligandsA[1].signature === ligandsB[1].signature) ||
      (ligandsA[0].signature === ligandsB[1].signature && ligandsA[1].signature === ligandsB[0].signature)
    );
    sites.push({
      bondIndex,
      a: bond.a,
      b: bond.b,
      ringSize,
      ringConstrained: ringSize !== null,
      renderable: ringSize === null,
      cisTransAllowed,
      ligandsA,
      ligandsB,
    });
  }
  return sites;
}

function enumerateOptical(centres: StereoCenterInfo[]) {
  if (centres.length === 0) {
    return { count: 0, meso: [] as string[], pairs: [] as Array<[string, string]> };
  }
  const groups = new Map<string, number[]>();
  centres.forEach((c, i) => {
    const arr = groups.get(c.equivalenceKey) ?? [];
    arr.push(i);
    groups.set(c.equivalenceKey, arr);
  });
  const groupList = Array.from(groups.entries()).map(([key, indices]) => ({ key, indices }));
  const canonical = (bits: number[]) => groupList
    .map((g) => `${g.key}:${g.indices.map((i) => bits[i]).sort().join("")}`)
    .join(";");
  const label = (bits: number[]) => bits.map((b, i) => `${centres[i].atomIndex}:${b ? "R" : "S"}`).join(",");
  const unique = new Map<string, number[]>();
  const total = 1 << centres.length;
  for (let mask = 0; mask < total; mask++) {
    const bits = centres.map((_, i) => (mask >> i) & 1);
    const key = canonical(bits);
    if (!unique.has(key)) unique.set(key, bits);
  }
  const meso: string[] = [];
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [key, bits] of unique) {
    if (seen.has(key)) continue;
    const inverted = bits.map((b) => 1 - b);
    const mirrorKey = canonical(inverted);
    if (mirrorKey === key && centres.length > 1) {
      meso.push(label(bits));
      seen.add(key);
    } else {
      pairs.push([label(bits), label(inverted)]);
      seen.add(key);
      seen.add(mirrorKey);
    }
  }
  return { count: unique.size, meso, pairs };
}

const SYMM_EPS = 0.32;

function centerOfGeometry(mol: Molecule) {
  const c = new THREE.Vector3();
  mol.atoms.forEach((a) => c.add(new THREE.Vector3(...a.pos)));
  return c.divideScalar(Math.max(1, mol.atoms.length));
}

function reflectedPoint(p: THREE.Vector3, normal: THREE.Vector3, point: THREE.Vector3) {
  const v = p.clone().sub(point);
  return p.clone().sub(normal.clone().multiplyScalar(2 * v.dot(normal)));
}

function planeMatches(mol: Molecule, normal: THREE.Vector3, point: THREE.Vector3) {
  const used = new Set<number>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const atom = mol.atoms[i];
    const rp = reflectedPoint(new THREE.Vector3(...atom.pos), normal, point);
    let match = -1;
    for (let j = 0; j < mol.atoms.length; j++) {
      if (used.has(j) || mol.atoms[j].el !== atom.el) continue;
      if (new THREE.Vector3(...mol.atoms[j].pos).distanceTo(rp) <= SYMM_EPS) { match = j; break; }
    }
    if (match === -1) return false;
    used.add(match);
  }
  return true;
}

function detectSymmetryPlanes(mol: Molecule, allowMirror: boolean): SymmetryPlaneInfo[] {
  if (!allowMirror) return [];
  const c = centerOfGeometry(mol);
  const candidates: SymmetryPlaneInfo[] = [
    { normal: [1, 0, 0], label: "YZ Plane" },
    { normal: [0, 1, 0], label: "XZ Plane" },
    { normal: [0, 0, 1], label: "XY Plane" },
    { normal: [Math.SQRT1_2, Math.SQRT1_2, 0], label: "Diagonal Plane A" },
    { normal: [Math.SQRT1_2, -Math.SQRT1_2, 0], label: "Diagonal Plane B" },
    { normal: [Math.SQRT1_2, 0, Math.SQRT1_2], label: "Diagonal Plane C" },
  ];
  return candidates.filter((p) => planeMatches(mol, new THREE.Vector3(...p.normal).normalize(), c));
}

function detectSymmetryCentre(mol: Molecule, allowCentre: boolean): boolean {
  if (!allowCentre) return false;
  const c = centerOfGeometry(mol);
  const used = new Set<number>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const atom = mol.atoms[i];
    const antipode = c.clone().multiplyScalar(2).sub(new THREE.Vector3(...atom.pos));
    let match = -1;
    for (let j = 0; j < mol.atoms.length; j++) {
      if (used.has(j) || mol.atoms[j].el !== atom.el) continue;
      if (new THREE.Vector3(...mol.atoms[j].pos).distanceTo(antipode) <= SYMM_EPS) { match = j; break; }
    }
    if (match === -1) return false;
    used.add(match);
  }
  return true;
}

export function analyzeStereochemistry(mol: Molecule): StereoAnalysis {
  const stereoCenters = detectStereoCenters(mol);
  const geometricSites = detectGeometricSites(mol);
  const optical = enumerateOptical(stereoCenters);
  const geometricalIsomerCount = geometricSites.length ? 2 ** geometricSites.length : 0;
  const opticalIsomerCount = optical.count;
  const totalStereoisomers = opticalIsomerCount && geometricalIsomerCount
    ? opticalIsomerCount * geometricalIsomerCount
    : opticalIsomerCount || geometricalIsomerCount;
  const hasMesoForms = optical.meso.length > 0;
  const hasEnantiomericPairs = optical.pairs.length > 0;
  const isMeso = hasMesoForms;
  const isChiral = stereoCenters.length > 0 && hasEnantiomericPairs && !hasMesoForms;
  const classification: ChiralityClass = stereoCenters.length === 0
    ? "achiral"
    : isMeso
      ? "meso"
      : stereoCenters.length === 1
        ? "chiral-single"
        : "chiral-multi";
  const notes: string[] = [];
  if (stereoCenters.length > 0) {
    notes.push(`${stereoCenters.length} stereocentre${stereoCenters.length > 1 ? "s" : ""} enumerate to ${opticalIsomerCount} unique configurational stereoisomer${opticalIsomerCount === 1 ? "" : "s"}.`);
  }
  if (isMeso) {
    notes.push(`Symmetry-equivalent stereocentre assignments collapse duplicate configurations; ${optical.meso.length} meso form${optical.meso.length === 1 ? "" : "s"} detected.`);
  }
  if (geometricSites.length > 0) {
    notes.push(`${geometricSites.length} stereogenic C=C site${geometricSites.length > 1 ? "s" : ""} enumerate to ${geometricalIsomerCount} geometrical isomer${geometricalIsomerCount === 1 ? "" : "s"}.`);
  }
  if (stereoCenters.length === 0 && geometricSites.length === 0) {
    notes.push("No stereocentres and no eligible restricted-rotation C=C sites detected.");
  }
  return {
    stereocentres: stereoCenters.map((c) => c.atomIndex),
    stereoCenters,
    geomSites: geometricSites.length,
    geometricSites,
    hasInternalMirror: hasMesoForms,
    isMeso,
    isChiral,
    hasEnantiomericPairs,
    hasMesoForms,
    classification,
    opticalIsomerCount,
    geometricalIsomerCount,
    totalStereoisomers,
    mesoStructures: optical.meso,
    enantiomerPairs: optical.pairs,
    geometricalPairs: geometricSites.map((s) => [`Z:${s.bondIndex}`, `E:${s.bondIndex}`]),
    notes,
    approximate: false,
  };
}
