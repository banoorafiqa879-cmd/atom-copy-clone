import type { Element, Molecule } from "@/data/molecules";

export type BuilderBondOrder = 1 | 2 | 3;

export interface BuilderAtomNode {
  id: number;
  el: Element;
  x: number;
  y: number;
}

export interface BuilderBondEdge {
  id: number;
  a: number;
  b: number;
  order: BuilderBondOrder;
  aromatic?: boolean;
}

export interface BuilderStateGraph {
  nodes: BuilderAtomNode[];
  edges: BuilderBondEdge[];
}

export interface BuilderGraphDebug {
  atomCount: number;
  bondCount: number;
  ringCount: number;
  rings: number[][];
  atomRingMembership: Record<number, number[]>;
  bondRingMembership: Record<string, number[]>;
  adjacencyList: string[];
  errors: string[];
  warnings: string[];
}

interface NormalizedBond {
  id: number;
  a: number;
  b: number;
  aId: number;
  bId: number;
  order: BuilderBondOrder;
  aromatic?: boolean;
}

interface NormalizedGraph {
  nodes: BuilderAtomNode[];
  bonds: NormalizedBond[];
  adjacency: number[][];
  rings: number[][];
  atomRingMembership: Map<number, number[]>;
  bondRingMembership: Map<string, number[]>;
  components: number;
  errors: string[];
  warnings: string[];
}

const VALENCE: Record<Element, number> = { H: 1, C: 4, N: 3, O: 2, F: 1, Cl: 1, Br: 1, S: 2 };

const BOND_TARGET: Record<string, number> = {
  "C-C": 1.54,
  "C-N": 1.47,
  "C-O": 1.43,
  "C-S": 1.82,
  "C-F": 1.35,
  "C-Cl": 1.77,
  "C-Br": 1.94,
  "N-O": 1.40,
  "N-N": 1.45,
  "O-O": 1.48,
};

function edgeKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function bondTarget(a: Element, b: Element, order: BuilderBondOrder) {
  const key = [a, b].sort().join("-");
  const base = BOND_TARGET[key] ?? 1.50;
  return order === 3 ? base * 0.78 : order === 2 ? base * 0.87 : base;
}

function symmetricDifference(a: Set<number>, b: Set<number>) {
  const out = new Set(a);
  for (const value of b) {
    if (out.has(value)) out.delete(value);
    else out.add(value);
  }
  return out;
}

function canonicalCycleKey(cycle: number[]) {
  return [...cycle].sort((a, b) => a - b).join(",");
}

function findSimpleCycles(adjacency: number[][], maxSize: number) {
  const cycles: number[][] = [];
  const seen = new Set<string>();

  for (let start = 0; start < adjacency.length; start++) {
    const stack: { node: number; path: number[] }[] = [{ node: start, path: [start] }];
    while (stack.length) {
      const { node, path } = stack.pop()!;
      if (path.length > maxSize) continue;

      for (const next of adjacency[node]) {
        if (next === start && path.length >= 3) {
          const key = canonicalCycleKey(path);
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push([...path]);
          }
          continue;
        }
        if (next < start || path.includes(next)) continue;
        stack.push({ node: next, path: [...path, next] });
      }
    }
  }

  return cycles.sort((a, b) => a.length - b.length || canonicalCycleKey(a).localeCompare(canonicalCycleKey(b)));
}

function cycleEdgeVector(cycle: number[], bondIndexByKey: Map<string, number>) {
  const vector = new Set<number>();
  for (let i = 0; i < cycle.length; i++) {
    const a = cycle[i];
    const b = cycle[(i + 1) % cycle.length];
    const idx = bondIndexByKey.get(edgeKey(a, b));
    if (idx !== undefined) vector.add(idx);
  }
  return vector;
}

function minimumCycleBasis(cycles: number[][], bonds: NormalizedBond[], rank: number) {
  const bondIndexByKey = new Map<string, number>();
  bonds.forEach((bond, index) => bondIndexByKey.set(edgeKey(bond.a, bond.b), index));

  const basis = new Map<number, Set<number>>();
  const selected: number[][] = [];

  for (const cycle of cycles) {
    let vector = cycleEdgeVector(cycle, bondIndexByKey);
    while (vector.size > 0) {
      const pivot = Math.max(...vector);
      const reducer = basis.get(pivot);
      if (!reducer) {
        basis.set(pivot, vector);
        selected.push(cycle);
        break;
      }
      vector = symmetricDifference(vector, reducer);
    }
    if (selected.length >= rank) break;
  }

  return selected;
}

function connectedComponents(nodeCount: number, bonds: NormalizedBond[]) {
  if (nodeCount === 0) return 0;
  const parent = Array.from({ length: nodeCount }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  bonds.forEach((bond) => union(bond.a, bond.b));
  return new Set(Array.from({ length: nodeCount }, (_, i) => find(i))).size;
}

function normalizeGraph(state: BuilderStateGraph): NormalizedGraph {
  const nodes = state.nodes.map((node) => ({ ...node }));
  const idToIndex = new Map<number, number>();
  const errors: string[] = [];
  const warnings: string[] = [];

  nodes.forEach((node, index) => {
    if (idToIndex.has(node.id)) errors.push(`Duplicate atom id ${node.id}`);
    idToIndex.set(node.id, index);
  });

  const bonds: NormalizedBond[] = [];
  const seenBonds = new Map<string, number>();
  for (const edge of state.edges) {
    const a = idToIndex.get(edge.a);
    const b = idToIndex.get(edge.b);
    if (a === undefined || b === undefined) {
      errors.push(`Bond ${edge.id} references missing atom ${edge.a}-${edge.b}`);
      continue;
    }
    if (a === b) {
      errors.push(`Bond ${edge.id} loops atom ${edge.a} to itself`);
      continue;
    }
    const key = edgeKey(a, b);
    if (seenBonds.has(key)) {
      errors.push(`Duplicate bond between atom ${edge.a} and atom ${edge.b}`);
      continue;
    }
    seenBonds.set(key, edge.id);
    bonds.push({ id: edge.id, a, b, aId: edge.a, bId: edge.b, order: edge.order, aromatic: edge.aromatic });
  }

  const adjacency = nodes.map(() => [] as number[]);
  bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  });
  adjacency.forEach((neighbors) => neighbors.sort((a, b) => a - b));

  const components = connectedComponents(nodes.length, bonds);
  const cycleRank = Math.max(0, bonds.length - nodes.length + components);
  const simpleCycles = findSimpleCycles(adjacency, Math.min(12, Math.max(8, nodes.length)));
  const rings = minimumCycleBasis(simpleCycles, bonds, cycleRank);

  if (cycleRank > 0 && rings.length < cycleRank) {
    warnings.push(`Detected ${cycleRank} graph cycle(s), but only ${rings.length} small ring(s) could be enumerated`);
  }

  const atomRingMembership = new Map<number, number[]>();
  const bondRingMembership = new Map<string, number[]>();
  rings.forEach((ring, ringIndex) => {
    const ringNo = ringIndex + 1;
    ring.forEach((atomIndex, i) => {
      const atomId = nodes[atomIndex].id;
      atomRingMembership.set(atomId, [...(atomRingMembership.get(atomId) ?? []), ringNo]);
      const nextIndex = ring[(i + 1) % ring.length];
      const key = edgeKey(atomIndex, nextIndex);
      bondRingMembership.set(key, [...(bondRingMembership.get(key) ?? []), ringNo]);
    });
  });

  return { nodes, bonds, adjacency, rings, atomRingMembership, bondRingMembership, components, errors, warnings };
}

function formulaFromGraph(nodes: BuilderAtomNode[], bonds: NormalizedBond[]) {
  const counts: Partial<Record<Element, number>> = {};
  for (const node of nodes) counts[node.el] = (counts[node.el] || 0) + 1;

  const used = new Array(nodes.length).fill(0);
  bonds.forEach((bond) => {
    used[bond.a] += bond.order;
    used[bond.b] += bond.order;
  });

  nodes.forEach((node, index) => {
    if (node.el !== "H") counts.H = (counts.H || 0) + Math.max(0, VALENCE[node.el] - used[index]);
  });

  const order: Element[] = ["C", "H", "N", "O", "F", "Cl", "Br", "S"];
  return order.filter((el) => counts[el]).map((el) => (counts[el]! > 1 ? `${el}${counts[el]}` : el)).join("");
}

export function describeBuilderGraph(state: BuilderStateGraph): BuilderGraphDebug {
  const graph = normalizeGraph(state);
  const atomRingMembership: Record<number, number[]> = {};
  graph.nodes.forEach((node) => { atomRingMembership[node.id] = graph.atomRingMembership.get(node.id) ?? []; });

  const bondRingMembership: Record<string, number[]> = {};
  graph.bonds.forEach((bond) => {
    bondRingMembership[`${bond.aId}-${bond.bId}`] = graph.bondRingMembership.get(edgeKey(bond.a, bond.b)) ?? [];
  });

  return {
    atomCount: graph.nodes.length,
    bondCount: graph.bonds.length,
    ringCount: Math.max(0, graph.bonds.length - graph.nodes.length + graph.components),
    rings: graph.rings.map((ring) => ring.map((index) => graph.nodes[index].id)),
    atomRingMembership,
    bondRingMembership,
    adjacencyList: graph.nodes.map((node, index) => {
      const neighbors = graph.adjacency[index]
        .map((neighborIndex) => {
          const bond = graph.bonds.find((candidate) =>
            (candidate.a === index && candidate.b === neighborIndex) || (candidate.b === index && candidate.a === neighborIndex),
          );
          return `${graph.nodes[neighborIndex].id}(${bond?.order ?? 1})`;
        })
        .join(", ");
      return `${node.id}:${node.el} → ${neighbors || "—"}`;
    }),
    errors: graph.errors,
    warnings: graph.warnings,
  };
}

export function validateBuilderState(state: BuilderStateGraph) {
  const graph = normalizeGraph(state);
  const errors = [...graph.errors];
  const warnings = [...graph.warnings];

  if (graph.nodes.length === 0) errors.push("No atoms in builder graph");
  if (graph.nodes.length > 1 && graph.components > 1) errors.push("Disconnected structures cannot be generated as one molecule");

  const usedValence = new Array(graph.nodes.length).fill(0);
  const degree = new Array(graph.nodes.length).fill(0);
  graph.bonds.forEach((bond) => {
    usedValence[bond.a] += bond.order;
    usedValence[bond.b] += bond.order;
    degree[bond.a] += 1;
    degree[bond.b] += 1;
  });

  graph.nodes.forEach((node, index) => {
    if (usedValence[index] > VALENCE[node.el]) {
      errors.push(`${node.el}${node.id} exceeds valence ${VALENCE[node.el]} with bond order sum ${usedValence[index]}`);
    }
    if (node.el === "H" && degree[index] > 1) errors.push(`Hydrogen ${node.id} has more than one bond`);
  });

  const debug = describeBuilderGraph(state);
  debug.errors = errors;
  debug.warnings = warnings;
  return { valid: errors.length === 0, errors, warnings, graph: debug };
}

function averageTargetScale(nodes: BuilderAtomNode[], bonds: NormalizedBond[]) {
  const lengths = bonds
    .map((bond) => {
      const a = nodes[bond.a];
      const b = nodes[bond.b];
      const pixelLength = Math.hypot(b.x - a.x, b.y - a.y);
      const target = bondTarget(a.el, b.el, bond.order);
      return pixelLength > 1e-6 ? target / pixelLength : null;
    })
    .filter((value): value is number => value !== null);
  if (!lengths.length) return 1 / 46;
  return lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
}

function puckerOffset(size: number, i: number) {
  if (size <= 3) return 0;
  if (size === 4) return i % 2 === 0 ? 0.22 : -0.22;
  if (size === 5) return i === 0 ? 0.42 : -0.08;
  if (size === 6) return i % 2 === 0 ? 0.36 : -0.36;
  return (i % 2 === 0 ? 1 : -1) * (0.30 + 0.04 * Math.min(size - 7, 3));
}

function ringBondOrders(ring: number[], bonds: NormalizedBond[]) {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.b === a && bond.a === b))?.order ?? 1;
  });
}

function isAromaticLikeRing(ring: number[], bonds: NormalizedBond[]) {
  const orders = ringBondOrders(ring, bonds);
  return ring.length === 6 && orders.filter((order) => order === 2).length >= 3;
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function addHydrogens(
  atoms: { el: Element; pos: [number, number, number] }[],
  bonds: { a: number; b: number; order: BuilderBondOrder }[],
  graph: NormalizedGraph,
) {
  const heavyCount = graph.nodes.length;
  const maxOrderAt = new Array(heavyCount).fill(1);
  const usedValence = new Array(heavyCount).fill(0);
  graph.bonds.forEach((bond) => {
    usedValence[bond.a] += bond.order;
    usedValence[bond.b] += bond.order;
    maxOrderAt[bond.a] = Math.max(maxOrderAt[bond.a], bond.order);
    maxOrderAt[bond.b] = Math.max(maxOrderAt[bond.b], bond.order);
  });

  for (let i = 0; i < heavyCount; i++) {
    const atom = atoms[i];
    if (atom.el === "H") continue;
    const need = Math.max(0, VALENCE[atom.el] - usedValence[i]);
    if (need === 0) continue;

    const neighborDirs = graph.adjacency[i].map((neighborIndex) => {
      const neighbor = atoms[neighborIndex].pos;
      return normalizeVector([
        neighbor[0] - atom.pos[0],
        neighbor[1] - atom.pos[1],
        neighbor[2] - atom.pos[2],
      ]);
    });
    const sum: [number, number, number] = [0, 0, 0];
    neighborDirs.forEach((dir) => {
      sum[0] += dir[0];
      sum[1] += dir[1];
      sum[2] += dir[2];
    });
    const opposite = neighborDirs.length ? normalizeVector([-sum[0], -sum[1], -sum[2]]) : [1, 0, 0] as [number, number, number];
    const helper: [number, number, number] = Math.abs(opposite[2]) < 0.8 ? [0, 0, 1] : [0, 1, 0];
    const perp1 = normalizeVector([
      opposite[1] * helper[2] - opposite[2] * helper[1],
      opposite[2] * helper[0] - opposite[0] * helper[2],
      opposite[0] * helper[1] - opposite[1] * helper[0],
    ]);
    const perp2 = normalizeVector([
      opposite[1] * perp1[2] - opposite[2] * perp1[1],
      opposite[2] * perp1[0] - opposite[0] * perp1[2],
      opposite[0] * perp1[1] - opposite[1] * perp1[0],
    ]);
    const sp2 = maxOrderAt[i] === 2;
    const sp = maxOrderAt[i] === 3;

    for (let h = 0; h < need; h++) {
      let dir: [number, number, number];
      if (need === 1 || sp) {
        dir = opposite;
      } else if (sp2) {
        const angle = (h - (need - 1) / 2) * (Math.PI / 3);
        dir = normalizeVector([
          opposite[0] * Math.cos(angle) + perp1[0] * Math.sin(angle),
          opposite[1] * Math.cos(angle) + perp1[1] * Math.sin(angle),
          opposite[2] * Math.cos(angle) + perp1[2] * Math.sin(angle),
        ]);
      } else {
        const theta = 109.5 * Math.PI / 180;
        const phi = need === 2 ? (h === 0 ? 0 : Math.PI) : (h * 2 * Math.PI) / Math.max(need, 3);
        const tilt: [number, number, number] = [
          perp1[0] * Math.cos(phi) + perp2[0] * Math.sin(phi),
          perp1[1] * Math.cos(phi) + perp2[1] * Math.sin(phi),
          perp1[2] * Math.cos(phi) + perp2[2] * Math.sin(phi),
        ];
        dir = normalizeVector([
          opposite[0] * Math.cos(theta / 2) + tilt[0] * Math.sin(theta / 2),
          opposite[1] * Math.cos(theta / 2) + tilt[1] * Math.sin(theta / 2),
          opposite[2] * Math.cos(theta / 2) + tilt[2] * Math.sin(theta / 2),
        ]);
      }

      const bondLength = atom.el === "C" ? 1.09 : 1.0;
      atoms.push({
        el: "H",
        pos: [
          atom.pos[0] + dir[0] * bondLength,
          atom.pos[1] + dir[1] * bondLength,
          atom.pos[2] + dir[2] * bondLength,
        ],
      });
      bonds.push({ a: i, b: atoms.length - 1, order: 1 });
    }
  }
}

function relaxHydrogensOnly(
  atoms: { el: Element; pos: [number, number, number] }[],
  bonds: { a: number; b: number; order: BuilderBondOrder }[],
  heavyCount: number,
) {
  for (let iteration = 0; iteration < 20; iteration++) {
    for (let atomIndex = heavyCount; atomIndex < atoms.length; atomIndex++) {
      const bonded = bonds.find((bond) => bond.a === atomIndex || bond.b === atomIndex);
      if (!bonded) continue;
      const heavyIndex = bonded.a === atomIndex ? bonded.b : bonded.a;
      if (heavyIndex >= heavyCount) continue;
      const heavy = atoms[heavyIndex].pos;
      const current = atoms[atomIndex].pos;
      const dir = normalizeVector([current[0] - heavy[0], current[1] - heavy[1], current[2] - heavy[2]]);
      atoms[atomIndex].pos = [heavy[0] + dir[0] * 1.09, heavy[1] + dir[1] * 1.09, heavy[2] + dir[2] * 1.09];
    }
  }
}

export function build3D(state: BuilderStateGraph, name: string): Molecule {
  const validation = validateBuilderState(state);
  if (!validation.valid) throw new Error(validation.errors.join("; "));

  const graph = normalizeGraph(state);
  const scale = averageTargetScale(graph.nodes, graph.bonds);
  const atoms = graph.nodes.map((node) => ({
    el: node.el,
    pos: [node.x * scale, -node.y * scale, 0] as [number, number, number],
  }));
  const bonds = graph.bonds.map((bond) => ({ a: bond.a, b: bond.b, order: bond.order }));

  if (atoms.length) {
    const cx = atoms.reduce((sum, atom) => sum + atom.pos[0], 0) / atoms.length;
    const cy = atoms.reduce((sum, atom) => sum + atom.pos[1], 0) / atoms.length;
    atoms.forEach((atom) => { atom.pos = [atom.pos[0] - cx, atom.pos[1] - cy, atom.pos[2]]; });
  }

  const zSum = new Array(atoms.length).fill(0);
  const zCount = new Array(atoms.length).fill(0);
  graph.rings.forEach((ring, ringIndex) => {
    if (isAromaticLikeRing(ring, graph.bonds)) return;
    const sign = ringIndex % 2 === 0 ? 1 : -1;
    ring.forEach((atomIndex, i) => {
      zSum[atomIndex] += sign * puckerOffset(ring.length, i);
      zCount[atomIndex] += 1;
    });
  });
  atoms.forEach((atom, index) => {
    if (zCount[index] > 0) atom.pos[2] = zSum[index] / zCount[index];
  });

  const heavyCount = atoms.length;
  addHydrogens(atoms, bonds, graph);
  relaxHydrogensOnly(atoms, bonds, heavyCount);

  const heavyBondKeys = new Set(bonds.filter((bond) => bond.a < heavyCount && bond.b < heavyCount).map((bond) => edgeKey(bond.a, bond.b)));
  for (const sourceBond of graph.bonds) {
    if (!heavyBondKeys.has(edgeKey(sourceBond.a, sourceBond.b))) {
      throw new Error(`Generated graph lost bond ${sourceBond.aId}-${sourceBond.bId}`);
    }
  }

  if (atoms.length) {
    const cx = atoms.reduce((sum, atom) => sum + atom.pos[0], 0) / atoms.length;
    const cy = atoms.reduce((sum, atom) => sum + atom.pos[1], 0) / atoms.length;
    const cz = atoms.reduce((sum, atom) => sum + atom.pos[2], 0) / atoms.length;
    atoms.forEach((atom) => { atom.pos = [atom.pos[0] - cx, atom.pos[1] - cy, atom.pos[2] - cz]; });
  }

  return {
    id: `built-${Date.now()}`,
    name,
    formula: formulaFromGraph(graph.nodes, graph.bonds),
    description: "Custom molecule generated directly from the builder connectivity graph.",
    group: "Custom",
    atoms,
    bonds,
  };
}