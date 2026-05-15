import type { Molecule, Element, Bond } from "@/data/molecules";

export const ATOMIC_MASS: Record<Element, number> = {
  H: 1.008,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  S: 32.06,
  Cl: 35.45,
  Br: 79.904,
};

export const VALENCE: Record<Element, number> = {
  H: 1, C: 4, N: 3, O: 2, F: 1, S: 2, Cl: 1, Br: 1,
};

const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => (n <= 1 ? "" : String(n).split("").map(d => SUB[+d]).join(""));

export function molecularFormula(mol: Molecule): string {
  const counts: Partial<Record<Element, number>> = {};
  mol.atoms.forEach(a => { counts[a.el] = (counts[a.el] ?? 0) + 1; });
  // Hill order: C, H, then alphabetical
  const order: Element[] = ["C", "H", "N", "O", "F", "S", "Cl", "Br"];
  return order
    .filter(e => counts[e])
    .map(e => `${e}${sub(counts[e]!)}`)
    .join("");
}

export function molecularMass(mol: Molecule): number {
  return mol.atoms.reduce((s, a) => s + ATOMIC_MASS[a.el], 0);
}

export function neighbors(mol: Molecule, i: number): { idx: number; bond: Bond }[] {
  const out: { idx: number; bond: Bond }[] = [];
  mol.bonds.forEach(b => {
    if (b.a === i) out.push({ idx: b.b, bond: b });
    else if (b.b === i) out.push({ idx: b.a, bond: b });
  });
  return out;
}

export function atomCounts(mol: Molecule) {
  const c: Partial<Record<Element, number>> = {};
  mol.atoms.forEach(a => { c[a.el] = (c[a.el] ?? 0) + 1; });
  return c;
}

/** Hybridization based on bonded neighbors + bond orders (simple heuristic). */
export function hybridization(mol: Molecule, i: number): "sp" | "sp²" | "sp³" | "—" {
  const a = mol.atoms[i];
  if (a.el === "H") return "—";
  const ns = neighbors(mol, i);
  const maxOrder = ns.reduce((m, n) => Math.max(m, n.bond.order), 1);
  if (maxOrder === 3) return "sp";
  if (maxOrder === 2) return "sp²";
  return "sp³";
}

export function dominantHybridization(mol: Molecule): string {
  const tally: Record<string, number> = {};
  mol.atoms.forEach((a, i) => {
    if (a.el !== "C") return;
    const h = hybridization(mol, i);
    tally[h] = (tally[h] ?? 0) + 1;
  });
  const keys = Object.keys(tally);
  if (keys.length === 0) return "—";
  return keys.sort((a, b) => tally[b] - tally[a]).join(", ");
}

/** Detect functional groups (lightweight heuristic). */
export function functionalGroups(mol: Molecule): string[] {
  const groups = new Set<string>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const el = mol.atoms[i].el;
    const ns = neighbors(mol, i);
    if (el === "O") {
      const heavy = ns.filter(n => mol.atoms[n.idx].el !== "H");
      const hCount = ns.length - heavy.length;
      const dbl = ns.find(n => n.bond.order === 2 && mol.atoms[n.idx].el === "C");
      if (dbl) {
        // C=O — check if neighbor C also bonded to OH → carboxyl
        const cIdx = dbl.idx;
        const cNs = neighbors(mol, cIdx);
        const hasOH = cNs.some(n =>
          mol.atoms[n.idx].el === "O" &&
          n.idx !== i &&
          neighbors(mol, n.idx).some(x => mol.atoms[x.idx].el === "H")
        );
        if (hasOH) groups.add("Carboxyl (-COOH)");
        else groups.add("Carbonyl (C=O)");
      } else if (hCount === 1 && heavy.some(n => mol.atoms[n.idx].el === "C")) {
        groups.add("Hydroxyl (-OH)");
      }
    }
    if (el === "N") {
      const hC = ns.filter(n => mol.atoms[n.idx].el === "H").length;
      if (hC >= 1) groups.add("Amine (-NH)");
    }
    if (el === "C") {
      const dbl = ns.find(n => n.bond.order === 2 && mol.atoms[n.idx].el === "C");
      const trp = ns.find(n => n.bond.order === 3 && mol.atoms[n.idx].el === "C");
      if (trp) groups.add("Alkyne (C≡C)");
      else if (dbl) groups.add("Alkene (C=C)");
    }
    if (el === "Cl" || el === "Br" || el === "F") {
      groups.add(`Halide (-${el})`);
    }
  }
  return Array.from(groups);
}

/** Count rings via cyclomatic number (E - V + connected components). */
export function ringCount(mol: Molecule): number {
  const n = mol.atoms.length;
  const e = mol.bonds.length;
  // connected components via union-find
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  mol.bonds.forEach(b => union(b.a, b.b));
  const comps = new Set(Array.from({ length: n }, (_, i) => find(i))).size;
  return Math.max(0, e - n + comps);
}

/** Stereocentre = sp³ C with 4 bonded neighbors and 4 unique neighbor signatures. */
export function stereocentres(mol: Molecule): number[] {
  const result: number[] = [];
  for (let i = 0; i < mol.atoms.length; i++) {
    if (mol.atoms[i].el !== "C") continue;
    const ns = neighbors(mol, i);
    if (ns.length !== 4) continue;
    if (ns.some(n => n.bond.order !== 1)) continue;
    // Morgan-like signature depth 2
    const sig = (j: number, depth: number, from: number): string => {
      if (depth === 0) return mol.atoms[j].el;
      const sub = neighbors(mol, j)
        .filter(n => n.idx !== from)
        .map(n => sig(n.idx, depth - 1, j))
        .sort()
        .join(",");
      return `${mol.atoms[j].el}(${sub})`;
    };
    const sigs = ns.map(n => sig(n.idx, 2, i));
    if (new Set(sigs).size === 4) result.push(i);
  }
  return result;
}

/** Detect whether the molecule can show geometrical (cis/trans, E/Z) isomerism.
 *  Returns count of distinct geometrical isomers around eligible C=C bonds (2^n).
 */
export function geometricIsomerInfo(mol: Molecule): { possible: boolean; count: number; sites: number; reason?: string } {
  let sites = 0;
  for (const b of mol.bonds) {
    if (b.order !== 2) continue;
    if (mol.atoms[b.a].el !== "C" || mol.atoms[b.b].el !== "C") continue;
    const subsA = neighbors(mol, b.a).filter(n => n.idx !== b.b);
    const subsB = neighbors(mol, b.b).filter(n => n.idx !== b.a);
    if (subsA.length < 2 || subsB.length < 2) continue;
    const elsA = subsA.map(n => mol.atoms[n.idx].el);
    const elsB = subsB.map(n => mol.atoms[n.idx].el);
    if (new Set(elsA).size < 2 || new Set(elsB).size < 2) continue;
    sites++;
  }
  if (sites === 0) {
    return { possible: false, count: 0, sites: 0, reason: "Geometrical isomerism requires restricted rotation (C=C or ring) with two different substituents on each end." };
  }
  return { possible: true, count: Math.pow(2, sites), sites };
}

/** Optical isomer info: 2^n stereocentres (upper bound for chiral isomers). */
export function opticalIsomerInfo(mol: Molecule): { chiral: boolean; count: number; centres: number } {
  const s = stereocentres(mol);
  if (s.length === 0) return { chiral: false, count: 0, centres: 0 };
  return { chiral: true, count: Math.pow(2, s.length), centres: s.length };
}

// ---------- Conformational analysis ----------
import type { Atom } from "@/data/molecules";

/** BFS atoms reachable from `start` without crossing the (start,blocked) edge. */
function reachableFrom(mol: Molecule, start: number, blocked: number): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbors(mol, cur)) {
      if (cur === start && n.idx === blocked) continue;
      if (seen.has(n.idx)) continue;
      seen.add(n.idx);
      queue.push(n.idx);
    }
  }
  return seen;
}

export interface RotatableBond {
  a: number;       // pivot atom (kept fixed)
  b: number;       // atom whose side rotates
  side: number[];  // atoms that rotate (includes b, excludes a)
  label: string;
  kind: "alkane" | "polar" | "generic";
}

export function rotatableBonds(mol: Molecule): RotatableBond[] {
  const out: RotatableBond[] = [];
  for (const bond of mol.bonds) {
    if (bond.order !== 1) continue;
    const ea = mol.atoms[bond.a].el;
    const eb = mol.atoms[bond.b].el;
    if (ea === "H" || eb === "H") continue;
    const degA = neighbors(mol, bond.a).length;
    const degB = neighbors(mol, bond.b).length;
    if (degA < 2 || degB < 2) continue; // terminal — rotating just spins H tripod, skip
    // ring detection: b-side reaches a → ring bond, skip
    const bSide = reachableFrom(mol, bond.b, bond.a);
    if (bSide.has(bond.a)) continue;
    const aSide = reachableFrom(mol, bond.a, bond.b);
    // pick the smaller side to rotate (less visual jitter)
    const rotateB = bSide.size <= aSide.size;
    const pivot = rotateB ? bond.a : bond.b;
    const moving = rotateB ? bond.b : bond.a;
    const side = Array.from(rotateB ? bSide : aSide).filter(i => i !== pivot);
    const kind: RotatableBond["kind"] =
      ea === "C" && eb === "C" ? "alkane" :
      (ea === "O" || eb === "O" || ea === "N" || eb === "N") ? "polar" : "generic";
    out.push({
      a: pivot,
      b: moving,
      side,
      label: `${ea}${pivot + 1}–${eb}${moving + 1}`,
      kind,
    });
  }
  return out;
}

/** Rotate `side` atoms around axis through atom `a` toward atom `b` by `deg` degrees. */
export function rotateAroundBond(mol: Molecule, rb: RotatableBond, deg: number): Molecule {
  const pa = new THREE.Vector3(...mol.atoms[rb.a].pos);
  const pb = new THREE.Vector3(...mol.atoms[rb.b].pos);
  const axis = pb.clone().sub(pa).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
  const sideSet = new Set(rb.side);
  const atoms: Atom[] = mol.atoms.map((atom, i) => {
    if (!sideSet.has(i)) return atom;
    const p = new THREE.Vector3(...atom.pos).sub(pa).applyQuaternion(q).add(pa);
    return { ...atom, pos: [p.x, p.y, p.z] };
  });
  return { ...mol, atoms, id: `${mol.id}-rot${deg}`, name: `${mol.name} (${deg.toFixed(0)}°)` };
}

/** Heuristic torsional energy 0..1 for a molecule's current geometry around a bond. */
export function torsionalEnergy(mol: Molecule, rb: RotatableBond): { score: number; label: string; primaryDihedral: number } {
  const pa = new THREE.Vector3(...mol.atoms[rb.a].pos);
  const pb = new THREE.Vector3(...mol.atoms[rb.b].pos);
  const axis = pb.clone().sub(pa).normalize();
  // build a reference frame perpendicular to axis
  const ref = Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const project = (p: THREE.Vector3, anchor: THREE.Vector3) => {
    const d = p.clone().sub(anchor);
    return Math.atan2(d.dot(v), d.dot(u));
  };
  const aN = neighbors(mol, rb.a).filter(n => n.idx !== rb.b);
  const bN = neighbors(mol, rb.b).filter(n => n.idx !== rb.a);
  if (!aN.length || !bN.length) return { score: 0, label: "—", primaryDihedral: 0 };
  let total = 0; let weight = 0;
  let primary = 0;
  let bestW = -1;
  for (const x of aN) {
    const px = new THREE.Vector3(...mol.atoms[x.idx].pos);
    const ax = project(px, pa);
    const wx = mol.atoms[x.idx].el === "H" ? 1 : 2;
    for (const y of bN) {
      const py = new THREE.Vector3(...mol.atoms[y.idx].pos);
      const ay = project(py, pb);
      const phi = ax - ay;
      const wy = mol.atoms[y.idx].el === "H" ? 1 : 2;
      const w = wx * wy;
      total += w * (1 + Math.cos(3 * phi)) * 0.5;
      weight += w;
      if (w > bestW) { bestW = w; primary = ((phi * 180) / Math.PI + 540) % 360 - 180; }
    }
  }
  const score = weight ? total / weight : 0;
  const abs = Math.abs(primary);
  let label = "Skew";
  if (abs < 20) label = "Eclipsed (syn)";
  else if (abs > 160) label = "Anti";
  else if (abs > 40 && abs < 80) label = "Gauche";
  else if (abs > 100 && abs < 140) label = "Eclipsed";
  return { score, label, primaryDihedral: primary };
}

/** Detect a 6-membered all-carbon ring (cyclohexane skeleton). */
export function findCyclohexane(mol: Molecule): number[] | null {
  const carbons = mol.atoms.map((a, i) => a.el === "C" ? i : -1).filter(i => i >= 0);
  const cset = new Set(carbons);
  const adj: Record<number, number[]> = {};
  carbons.forEach(i => {
    adj[i] = neighbors(mol, i).filter(n => cset.has(n.idx) &&
      mol.bonds.find(b => (b.a === i && b.b === n.idx) || (b.b === i && b.a === n.idx))?.order === 1
    ).map(n => n.idx);
  });
  // DFS for cycle of length 6
  for (const start of carbons) {
    const stack: { node: number; path: number[] }[] = [{ node: start, path: [start] }];
    while (stack.length) {
      const { node, path } = stack.pop()!;
      if (path.length === 6) {
        if (adj[node]?.includes(start)) return path;
        continue;
      }
      for (const nx of adj[node] ?? []) {
        if (path.includes(nx)) continue;
        stack.push({ node: nx, path: [...path, nx] });
      }
    }
  }
  return null;
}

/** Build idealized cyclohexane in a given conformation (with axial/equatorial H). */
export function cyclohexaneConformer(form: "chair" | "boat" | "twist-boat" | "half-chair"): Molecule {
  const r = 1.54;        // C–C bond length
  const ring: [number, number, number][] = [];
  // 6 ring carbons at radius R, alternating z
  const R = 1.45;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    let z = 0;
    if (form === "chair") z = i % 2 === 0 ? 0.25 : -0.25;
    else if (form === "boat") z = i === 0 || i === 3 ? 0.55 : 0;
    else if (form === "twist-boat") z = i === 0 ? 0.45 : i === 3 ? -0.45 : i % 2 === 0 ? 0.15 : -0.15;
    else if (form === "half-chair") z = i < 3 ? 0 : (i % 2 === 0 ? 0.4 : -0.2);
    ring.push([Math.cos(a) * R, Math.sin(a) * R, z]);
  }
  const atoms: Atom[] = ring.map(p => ({ el: "C", pos: p }));
  const bonds: Bond[] = [];
  for (let i = 0; i < 6; i++) bonds.push({ a: i, b: (i + 1) % 6, order: 1 });
  // add 2 H per carbon — axial (along ±z direction relative to local pucker) and equatorial (radial)
  for (let i = 0; i < 6; i++) {
    const c = ring[i];
    const ax = (form === "chair" ? (i % 2 === 0 ? 1 : -1) : 1);
    atoms.push({ el: "H", pos: [c[0], c[1], c[2] + 0.95 * ax] });
    const radial = Math.hypot(c[0], c[1]);
    const ux = c[0] / radial, uy = c[1] / radial;
    atoms.push({ el: "H", pos: [c[0] + 0.85 * ux, c[1] + 0.85 * uy, c[2] - 0.4 * ax] });
    bonds.push({ a: i, b: 6 + i * 2, order: 1 });
    bonds.push({ a: i, b: 6 + i * 2 + 1, order: 1 });
  }
  const labels: Record<typeof form, string> = {
    "chair": "Chair (most stable)",
    "boat": "Boat (eclipsing strain)",
    "twist-boat": "Twist-boat (intermediate)",
    "half-chair": "Half-chair (transition)",
  } as any;
  return {
    id: `cyclohexane-${form}`,
    name: `Cyclohexane — ${labels[form]}`,
    formula: "C₆H₁₂",
    group: "Ring conformation",
    description: `Cyclohexane in the ${form} conformation.`,
    atoms, bonds,
  };
}
// ---------- Cn axis detection ----------
import * as THREE from "three";

export interface SymAxis {
  axis: THREE.Vector3;   // unit vector through molecule center
  n: number;             // order (2,3,4,6)
  label: string;
}

function center(mol: Molecule): THREE.Vector3 {
  const c = new THREE.Vector3();
  mol.atoms.forEach(a => c.add(new THREE.Vector3(...a.pos)));
  return c.divideScalar(mol.atoms.length);
}

function axisIsSymmetry(mol: Molecule, axis: THREE.Vector3, c: THREE.Vector3, n: number, eps = 0.4) {
  const angle = (Math.PI * 2) / n;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const used = new Set<number>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const a = mol.atoms[i];
    const p = new THREE.Vector3(...a.pos).sub(c).applyQuaternion(q).add(c);
    let match = -1;
    for (let j = 0; j < mol.atoms.length; j++) {
      if (used.has(j)) continue;
      if (mol.atoms[j].el !== a.el) continue;
      if (new THREE.Vector3(...mol.atoms[j].pos).distanceTo(p) < eps) { match = j; break; }
    }
    if (match === -1) return false;
    used.add(match);
  }
  return true;
}

export function detectAxes(mol: Molecule): SymAxis[] {
  const c = center(mol);
  const out: SymAxis[] = [];
  const candidates: THREE.Vector3[] = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  // axes through pairs of like atoms
  for (let i = 0; i < mol.atoms.length; i++) {
    for (let j = i + 1; j < mol.atoms.length; j++) {
      if (mol.atoms[i].el !== mol.atoms[j].el) continue;
      const mid = new THREE.Vector3(...mol.atoms[i].pos).add(new THREE.Vector3(...mol.atoms[j].pos)).multiplyScalar(0.5);
      const v = mid.clone().sub(c);
      if (v.lengthSq() < 0.01) continue;
      candidates.push(v.normalize());
    }
    // axis through single atom and center
    const v = new THREE.Vector3(...mol.atoms[i].pos).sub(c);
    if (v.lengthSq() > 0.01) candidates.push(v.normalize());
  }
  // dedupe
  const uniq: THREE.Vector3[] = [];
  candidates.forEach(v => {
    if (!uniq.some(u => Math.abs(u.dot(v)) > 0.985)) uniq.push(v);
  });
  for (const v of uniq) {
    let best = 1;
    for (const n of [6, 4, 3, 2]) {
      if (axisIsSymmetry(mol, v, c, n)) { best = n; break; }
    }
    if (best >= 2) {
      // dedupe by axis direction + order
      if (!out.some(o => o.n === best && Math.abs(o.axis.dot(v)) > 0.985)) {
        out.push({ axis: v.clone(), n: best, label: `C${best}` });
      }
    }
  }
  // sort highest order first
  out.sort((a, b) => b.n - a.n);
  return out.slice(0, 4);
}