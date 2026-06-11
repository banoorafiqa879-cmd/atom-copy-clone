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
  formula: string;
  structureClass: string;
  framework: string;
  aromaticity: string;
  functionalGroups: string[];
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
  cycleRank: number;
  errors: string[];
  warnings: string[];
}

interface AtomGeometry {
  el: Element;
  pos: [number, number, number];
}

interface BondGeometry {
  a: number;
  b: number;
  order: BuilderBondOrder;
}

const VALENCE: Record<Element, number> = { H: 1, C: 4, N: 3, O: 2, F: 1, Cl: 1, Br: 1, S: 2 };

const BOND_TARGET: Record<string, number> = {
  "C-C": 1.54,
  "C-H": 1.09,
  "C-N": 1.47,
  "C-O": 1.43,
  "C-S": 1.82,
  "C-F": 1.35,
  "C-Cl": 1.77,
  "C-Br": 1.94,
  "H-N": 1.01,
  "H-O": 0.96,
  "H-S": 1.34,
  "N-O": 1.40,
  "N-N": 1.45,
  "O-O": 1.48,
};

const RING_NAMES: Record<number, string> = {
  3: "Cyclopropane",
  4: "Cyclobutane",
  5: "Cyclopentane",
  6: "Cyclohexane",
  7: "Cycloheptane",
  8: "Cyclooctane",
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
    if (edge.order !== 1 && edge.order !== 2 && edge.order !== 3) {
      errors.push(`Bond ${edge.id} has unsupported order ${edge.order}`);
      continue;
    }
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
  const simpleCycles = findSimpleCycles(adjacency, Math.min(14, Math.max(8, nodes.length)));
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

  return { nodes, bonds, adjacency, rings, atomRingMembership, bondRingMembership, components, cycleRank, errors, warnings };
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

function ringBondOrders(ring: number[], bonds: NormalizedBond[]) {
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.b === a && bond.a === b))?.order ?? 1;
  });
}

function alternatingDoublePattern(orders: BuilderBondOrder[]) {
  if (orders.length % 2 !== 0) return false;
  return orders.every((order, index) => order === (index % 2 === 0 ? 2 : 1))
    || orders.every((order, index) => order === (index % 2 === 0 ? 1 : 2));
}

function isAromaticLikeRing(ring: number[], bonds: NormalizedBond[]) {
  const orders = ringBondOrders(ring, bonds);
  return ring.length === 6 && orders.filter((order) => order === 2).length === 3 && alternatingDoublePattern(orders);
}

function bondBetween(graph: NormalizedGraph, a: number, b: number) {
  return graph.bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.b === a && bond.a === b));
}

function atomStats(graph: NormalizedGraph, atomIndex: number) {
  let valence = 0;
  let maxOrder = 1;
  let doubleCount = 0;
  let tripleCount = 0;
  graph.bonds.forEach((bond) => {
    if (bond.a !== atomIndex && bond.b !== atomIndex) return;
    valence += bond.order;
    maxOrder = Math.max(maxOrder, bond.order);
    if (bond.order === 2) doubleCount += 1;
    if (bond.order === 3) tripleCount += 1;
  });
  return { valence, degree: graph.adjacency[atomIndex]?.length ?? 0, maxOrder, doubleCount, tripleCount };
}

function inferHybridization(graph: NormalizedGraph, atomIndex: number): "sp" | "sp2" | "sp3" {
  const stats = atomStats(graph, atomIndex);
  if (stats.tripleCount > 0 || stats.doubleCount >= 2) return "sp";
  if (stats.doubleCount === 1) return "sp2";
  return "sp3";
}

function classifyStructure(graph: NormalizedGraph) {
  const formula = formulaFromGraph(graph.nodes, graph.bonds);
  const carbonCount = graph.nodes.filter((node) => node.el === "C").length;
  const hetero = graph.nodes.filter((node) => node.el !== "C" && node.el !== "H");
  const ringCount = graph.cycleRank;
  const aromaticRings = graph.rings.filter((ring) => isAromaticLikeRing(ring, graph.bonds));
  const sharedRingBondCount = [...graph.bondRingMembership.values()].filter((rings) => rings.length > 1).length;
  const hasFusedBond = sharedRingBondCount > 0;
  const sharedRingAtoms = [...graph.atomRingMembership.entries()].filter(([, rings]) => rings.length > 1).map(([atomId]) => atomId);
  const sharedRingAtomDegree3 = sharedRingAtoms.filter((atomId) => {
    const atomIndex = graph.nodes.findIndex((node) => node.id === atomId);
    return atomIndex >= 0 && graph.adjacency[atomIndex].length >= 3;
  }).length;
  const hasSpiroAtom = sharedRingAtoms.length === 1 && !hasFusedBond;
  const hasBridge = ringCount > 1 && sharedRingAtomDegree3 >= 2 && sharedRingBondCount > 1;
  const allSingle = graph.bonds.every((bond) => bond.order === 1);
  const carbonOnly = hetero.length === 0;

  const functionalGroups: string[] = [];
  if (graph.bonds.some((bond) => bond.order === 2 && graph.nodes[bond.a].el === "C" && graph.nodes[bond.b].el === "O")) functionalGroups.push("carbonyl");
  if (graph.bonds.some((bond) => bond.order === 2 && graph.nodes[bond.a].el === "C" && graph.nodes[bond.b].el === "C")) functionalGroups.push("alkene");
  if (graph.bonds.some((bond) => bond.order === 3 && graph.nodes[bond.a].el === "C" && graph.nodes[bond.b].el === "C")) functionalGroups.push("alkyne");
  if (graph.nodes.some((node, index) => node.el === "O" && graph.adjacency[index].some((n) => graph.nodes[n].el === "C"))) functionalGroups.push("alcohol/ether oxygen");
  if (graph.nodes.some((node, index) => node.el === "N" && graph.adjacency[index].some((n) => graph.nodes[n].el === "C"))) functionalGroups.push("amine nitrogen");
  if (graph.nodes.some((node) => node.el === "F" || node.el === "Cl" || node.el === "Br")) functionalGroups.push("alkyl/aryl halide");
  if (graph.nodes.some((node) => node.el === "S")) functionalGroups.push("organosulfur");

  let structureClass = "Custom molecular graph";
  let framework = "User-defined connectivity";
  let detectedName = `Custom ${formula}`;

  if (carbonCount === 1 && graph.bonds.length === 0 && graph.nodes[0]?.el === "C") {
    structureClass = "Alkane";
    framework = "Methane";
    detectedName = "Methane";
  } else if (carbonCount === 2 && graph.bonds.length === 1 && carbonOnly) {
    const order = graph.bonds[0].order;
    structureClass = order === 1 ? "Alkane" : order === 2 ? "Alkene" : "Alkyne";
    framework = order === 1 ? "Ethane" : order === 2 ? "Ethene" : "Acetylene";
    detectedName = framework;
  } else if (aromaticRings.length > 0) {
    structureClass = aromaticRings.length > 1 ? "Polycyclic aromatic system" : "Aromatic system";
    framework = carbonCount === 6 && graph.nodes.length === 6 ? "Benzene" : hasFusedBond ? "Fused aromatic framework" : "Substituted aromatic ring";
    detectedName = framework === "Benzene" ? "Benzene" : `${framework} ${formula}`;
  } else if (ringCount === 1 && graph.rings.length === 1 && carbonOnly && allSingle) {
    const ring = graph.rings[0];
    const substituentCount = carbonCount - ring.length;
    structureClass = "Cycloalkane";
    framework = substituentCount === 0 ? (RING_NAMES[ring.length] ?? `${ring.length}-membered cycloalkane`) : `Substituted ${RING_NAMES[ring.length]?.toLowerCase() ?? `${ring.length}-membered ring`}`;
    if (substituentCount === 0) detectedName = framework;
    else if (substituentCount === 1) detectedName = `Methyl${(RING_NAMES[ring.length] ?? "cycloalkane").toLowerCase()}`;
    else detectedName = `${framework} ${formula}`;
  } else if (hasBridge && !aromaticRings.length) {
    structureClass = "Bridged ring system";
    framework = `${ringCount}-ring bridged framework`;
    detectedName = `Bridged system ${formula}`;
  } else if (hasFusedBond) {
    structureClass = aromaticRings.length ? "Fused aromatic ring system" : "Fused bicyclic/polycyclic ring system";
    framework = `${ringCount}-ring fused framework`;
    detectedName = `Fused ring system ${formula}`;
  } else if (hasSpiroAtom) {
    structureClass = "Spiro ring system";
    framework = `${ringCount}-ring spiro framework`;
    detectedName = `Spiro system ${formula}`;
  } else if (ringCount > 0) {
    structureClass = "Cyclic molecular graph";
    framework = `${ringCount}-ring cyclic framework`;
    detectedName = `Cyclic structure ${formula}`;
  }

  return {
    formula,
    structureClass,
    framework,
    detectedName,
    aromaticity: aromaticRings.length ? `${aromaticRings.length} aromatic ring(s)` : "non-aromatic or not assigned aromatic",
    functionalGroups: functionalGroups.length ? functionalGroups : ["hydrocarbon framework"],
  };
}

export function describeBuilderGraph(state: BuilderStateGraph): BuilderGraphDebug {
  const graph = normalizeGraph(state);
  const identity = classifyStructure(graph);
  const atomRingMembership: Record<number, number[]> = {};
  graph.nodes.forEach((node) => { atomRingMembership[node.id] = graph.atomRingMembership.get(node.id) ?? []; });

  const bondRingMembership: Record<string, number[]> = {};
  graph.bonds.forEach((bond) => {
    bondRingMembership[`${bond.aId}-${bond.bId}`] = graph.bondRingMembership.get(edgeKey(bond.a, bond.b)) ?? [];
  });

  return {
    atomCount: graph.nodes.length,
    bondCount: graph.bonds.length,
    ringCount: graph.cycleRank,
    rings: graph.rings.map((ring) => ring.map((index) => graph.nodes[index].id)),
    atomRingMembership,
    bondRingMembership,
    adjacencyList: graph.nodes.map((node, index) => {
      const neighbors = graph.adjacency[index]
        .map((neighborIndex) => {
          const bond = bondBetween(graph, index, neighborIndex);
          return `${graph.nodes[neighborIndex].id}(${bond?.order ?? 1})`;
        })
        .join(", ");
      return `${node.id}:${node.el} → ${neighbors || "—"}`;
    }),
    formula: identity.formula,
    structureClass: identity.structureClass,
    framework: identity.framework,
    aromaticity: identity.aromaticity,
    functionalGroups: identity.functionalGroups,
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

  graph.nodes.forEach((node, index) => {
    const stats = atomStats(graph, index);
    if (stats.valence > VALENCE[node.el]) {
      errors.push(`${node.el}${node.id} exceeds valence ${VALENCE[node.el]} with bond order sum ${stats.valence}`);
    }
    if (node.el === "H" && stats.degree > 1) errors.push(`Hydrogen ${node.id} has more than one bond`);
    if ((node.el === "F" || node.el === "Cl" || node.el === "Br") && (stats.degree > 1 || stats.valence > 1)) {
      errors.push(`${node.el}${node.id} exceeds halogen valence 1`);
    }
    if ((node.el === "O" || node.el === "S") && stats.tripleCount > 0) errors.push(`${node.el}${node.id} triple-bond chemistry is unsupported`);
    if (stats.tripleCount > 0 && stats.degree > 2) errors.push(`${node.el}${node.id} has incompatible sp connectivity`);
    if (stats.doubleCount > 0 && stats.degree > 3) errors.push(`${node.el}${node.id} has incompatible sp2 connectivity`);
  });

  graph.rings.forEach((ring, ringIndex) => {
    const ringNo = ringIndex + 1;
    const orders = ringBondOrders(ring, graph.bonds);
    const doubleCount = orders.filter((order) => order === 2).length;
    const tripleCount = orders.filter((order) => order === 3).length;
    const hasExplicitAromatic = ring.some((atomIndex, i) => bondBetween(graph, atomIndex, ring[(i + 1) % ring.length])?.aromatic);

    if (ring.length < 3) errors.push(`Ring ${ringNo} is not a valid cycle`);
    if (ring.length > 8) warnings.push(`Ring ${ringNo} has ${ring.length} atoms; only 3–8 membered ring conformations are optimized`);
    if (tripleCount > 0 && ring.length <= 8) errors.push(`Ring ${ringNo} contains an unsupported in-ring triple bond`);
    if (ring.length === 3 && doubleCount > 1) errors.push(`Ring ${ringNo} has impossible cyclopropane/cyclopropene bond-order geometry`);
    if (ring.length <= 5) {
      ring.forEach((atomIndex) => {
        if (inferHybridization(graph, atomIndex) === "sp") {
          errors.push(`Atom ${graph.nodes[atomIndex].id} requires linear sp geometry inside a small ring`);
        }
      });
    }
    if (doubleCount === 3 && ring.length === 6 && !alternatingDoublePattern(orders)) {
      errors.push(`Ring ${ringNo} has inconsistent non-alternating aromatic bond orders`);
    }
    if (hasExplicitAromatic && !isAromaticLikeRing(ring, graph.bonds)) {
      errors.push(`Ring ${ringNo} is marked aromatic but does not satisfy supported six-member alternating aromaticity`);
    }
    ring.forEach((atomIndex, i) => {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const next = ring[(i + 1) % ring.length];
      const ringValence = (bondBetween(graph, atomIndex, prev)?.order ?? 1) + (bondBetween(graph, atomIndex, next)?.order ?? 1);
      if (ring.length <= 4 && ringValence >= 4) {
        errors.push(`Atom ${graph.nodes[atomIndex].id} has impossible small-ring bond-angle requirements`);
      }
    });
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

function normalizeVector(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function puckerOffset(size: number, i: number) {
  if (size <= 3) return 0;
  if (size === 4) return i % 2 === 0 ? 0.28 : -0.28;
  if (size === 5) return i === 0 ? 0.46 : -0.10;
  if (size === 6) return i % 2 === 0 ? 0.42 : -0.42;
  return (i % 2 === 0 ? 1 : -1) * (0.34 + 0.04 * Math.min(size - 7, 2));
}

function makeRegularRingCoordinates(atoms: AtomGeometry[], graph: NormalizedGraph) {
  if (graph.rings.length !== 1) return;
  const ring = graph.rings[0];
  if (ring.length < 3 || ring.length > 8 || ring.length !== graph.nodes.length) return;

  const targets = ring.map((atomIndex, i) => {
    const next = ring[(i + 1) % ring.length];
    const bond = bondBetween(graph, atomIndex, next);
    return bond ? bondTarget(graph.nodes[atomIndex].el, graph.nodes[next].el, bond.order) : 1.5;
  });
  const side = targets.reduce((sum, value) => sum + value, 0) / targets.length;
  const radius = side / (2 * Math.sin(Math.PI / ring.length));
  const start = -Math.PI / 2;
  ring.forEach((atomIndex, i) => {
    const angle = start + (i / ring.length) * Math.PI * 2;
    atoms[atomIndex].pos = [Math.cos(angle) * radius, Math.sin(angle) * radius, 0];
  });
}

function applyRingConformations(atoms: AtomGeometry[], graph: NormalizedGraph) {
  makeRegularRingCoordinates(atoms, graph);
  const assigned = new Array(atoms.length).fill(false);

  graph.rings.forEach((ring) => {
    const aromatic = isAromaticLikeRing(ring, graph.bonds);
    ring.forEach((atomIndex, i) => {
      if (aromatic) {
        atoms[atomIndex].pos[2] = 0;
        assigned[atomIndex] = true;
        return;
      }
      if (assigned[atomIndex]) return;
      atoms[atomIndex].pos[2] = puckerOffset(ring.length, i);
      assigned[atomIndex] = true;
    });
  });
}

function idealIsolatedDirections(el: Element, need: number): [number, number, number][] | null {
  if (el === "C" && need === 4) {
    return [
      normalizeVector([1, 1, 1]),
      normalizeVector([-1, -1, 1]),
      normalizeVector([-1, 1, -1]),
      normalizeVector([1, -1, -1]),
    ];
  }
  if (el === "N" && need === 3) {
    return [normalizeVector([1, 0, -0.35]), normalizeVector([-0.5, 0.866, -0.35]), normalizeVector([-0.5, -0.866, -0.35])];
  }
  if (el === "O" && need === 2) {
    const a = 104.5 * Math.PI / 180 / 2;
    return [[Math.cos(a), Math.sin(a), 0], [Math.cos(a), -Math.sin(a), 0]];
  }
  if (need === 1) return [[1, 0, 0]];
  return null;
}

function addHydrogens(atoms: AtomGeometry[], bonds: BondGeometry[], graph: NormalizedGraph) {
  const heavyCount = graph.nodes.length;
  const usedValence = new Array(heavyCount).fill(0);
  graph.bonds.forEach((bond) => {
    usedValence[bond.a] += bond.order;
    usedValence[bond.b] += bond.order;
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

    const isolated = neighborDirs.length === 0 ? idealIsolatedDirections(atom.el, need) : null;
    if (isolated) {
      isolated.forEach((dir) => {
        const length = bondTarget(atom.el, "H", 1);
        atoms.push({ el: "H", pos: [atom.pos[0] + dir[0] * length, atom.pos[1] + dir[1] * length, atom.pos[2] + dir[2] * length] });
        bonds.push({ a: i, b: atoms.length - 1, order: 1 });
      });
      continue;
    }

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
    const hyb = inferHybridization(graph, i);

    for (let h = 0; h < need; h++) {
      let dir: [number, number, number];
      if (need === 1 || hyb === "sp") {
        dir = opposite;
      } else if (hyb === "sp2") {
        const angle = (h - (need - 1) / 2) * (Math.PI / 3);
        dir = normalizeVector([
          opposite[0] * Math.cos(angle) + perp1[0] * Math.sin(angle),
          opposite[1] * Math.cos(angle) + perp1[1] * Math.sin(angle),
          opposite[2] * Math.cos(angle) + perp1[2] * Math.sin(angle),
        ]);
      } else {
        const cone = Math.acos(1 / 3);
        const phi = need === 2 ? (h === 0 ? 0 : Math.PI) : (h * 2 * Math.PI) / Math.max(need, 3);
        const tilt: [number, number, number] = [
          perp1[0] * Math.cos(phi) + perp2[0] * Math.sin(phi),
          perp1[1] * Math.cos(phi) + perp2[1] * Math.sin(phi),
          perp1[2] * Math.cos(phi) + perp2[2] * Math.sin(phi),
        ];
        dir = normalizeVector([
          opposite[0] * Math.cos(cone) + tilt[0] * Math.sin(cone),
          opposite[1] * Math.cos(cone) + tilt[1] * Math.sin(cone),
          opposite[2] * Math.cos(cone) + tilt[2] * Math.sin(cone),
        ]);
      }

      const bondLength = bondTarget(atom.el, "H", 1);
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

function optimizeCoordinates(atoms: AtomGeometry[], bonds: BondGeometry[], heavyCount: number, graph: NormalizedGraph) {
  const bonded = new Set(bonds.map((bond) => edgeKey(bond.a, bond.b)));
  const ringHeavy = new Set(graph.rings.flat());

  for (let iteration = 0; iteration < 80; iteration++) {
    const delta = atoms.map(() => [0, 0, 0] as [number, number, number]);

    bonds.forEach((bond) => {
      const a = atoms[bond.a];
      const b = atoms[bond.b];
      const dx = b.pos[0] - a.pos[0];
      const dy = b.pos[1] - a.pos[1];
      const dz = b.pos[2] - a.pos[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      const target = bondTarget(a.el, b.el, bond.order);
      const force = (length - target) * 0.035;
      const ux = (dx / length) * force;
      const uy = (dy / length) * force;
      const uz = (dz / length) * force;
      const aFrozen = bond.a < heavyCount && ringHeavy.has(bond.a);
      const bFrozen = bond.b < heavyCount && ringHeavy.has(bond.b);
      if (!aFrozen) {
        delta[bond.a][0] += ux;
        delta[bond.a][1] += uy;
        delta[bond.a][2] += uz;
      }
      if (!bFrozen) {
        delta[bond.b][0] -= ux;
        delta[bond.b][1] -= uy;
        delta[bond.b][2] -= uz;
      }
    });

    for (let i = 0; i < atoms.length; i++) {
      for (let j = i + 1; j < atoms.length; j++) {
        if (bonded.has(edgeKey(i, j))) continue;
        const dx = atoms[j].pos[0] - atoms[i].pos[0];
        const dy = atoms[j].pos[1] - atoms[i].pos[1];
        const dz = atoms[j].pos[2] - atoms[i].pos[2];
        const dist = Math.hypot(dx, dy, dz) || 1;
        const minDist = atoms[i].el === "H" || atoms[j].el === "H" ? 0.95 : 1.35;
        if (dist >= minDist) continue;
        const force = (minDist - dist) * 0.012;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        const uz = (dz / dist) * force;
        const iFrozen = i < heavyCount && ringHeavy.has(i);
        const jFrozen = j < heavyCount && ringHeavy.has(j);
        if (!iFrozen) {
          delta[i][0] -= ux;
          delta[i][1] -= uy;
          delta[i][2] -= uz;
        }
        if (!jFrozen) {
          delta[j][0] += ux;
          delta[j][1] += uy;
          delta[j][2] += uz;
        }
      }
    }

    atoms.forEach((atom, index) => {
      atom.pos = [atom.pos[0] + delta[index][0], atom.pos[1] + delta[index][1], atom.pos[2] + delta[index][2]];
    });
  }
}

function assertGeneratedTopology(graph: NormalizedGraph, atoms: AtomGeometry[], bonds: BondGeometry[], heavyCount: number) {
  if (heavyCount !== graph.nodes.length) throw new Error(`Topology mismatch: generated ${heavyCount} heavy atoms from ${graph.nodes.length} builder atoms`);
  graph.nodes.forEach((node, index) => {
    if (atoms[index]?.el !== node.el) throw new Error(`Topology mismatch: atom ${node.id} changed from ${node.el} to ${atoms[index]?.el ?? "missing"}`);
  });

  const expected = graph.bonds.map((bond) => `${edgeKey(bond.a, bond.b)}:${bond.order}`).sort();
  const actual = bonds
    .filter((bond) => bond.a < heavyCount && bond.b < heavyCount)
    .map((bond) => `${edgeKey(bond.a, bond.b)}:${bond.order}`)
    .sort();
  if (expected.length !== actual.length) throw new Error(`Topology mismatch: expected ${expected.length} heavy bonds but generated ${actual.length}`);
  expected.forEach((key, index) => {
    if (actual[index] !== key) throw new Error(`Topology mismatch: expected heavy bond ${key}, generated ${actual[index] ?? "missing"}`);
  });

  const generatedGraph = normalizeGraph({
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: bonds
      .filter((bond) => bond.a < heavyCount && bond.b < heavyCount)
      .map((bond, index) => ({ id: index + 1, a: graph.nodes[bond.a].id, b: graph.nodes[bond.b].id, order: bond.order })),
  });
  if (generatedGraph.cycleRank !== graph.cycleRank) {
    throw new Error(`Topology mismatch: expected ${graph.cycleRank} ring closures but generated ${generatedGraph.cycleRank}`);
  }
}

export function build3D(state: BuilderStateGraph, name: string): Molecule {
  const validation = validateBuilderState(state);
  if (!validation.valid) throw new Error(validation.errors.join("; "));

  const graph = normalizeGraph(state);
  const scale = averageTargetScale(graph.nodes, graph.bonds);
  const atoms: AtomGeometry[] = graph.nodes.map((node) => ({
    el: node.el,
    pos: [node.x * scale, -node.y * scale, 0],
  }));
  const bonds: BondGeometry[] = graph.bonds.map((bond) => ({ a: bond.a, b: bond.b, order: bond.order }));

  if (atoms.length) {
    const cx = atoms.reduce((sum, atom) => sum + atom.pos[0], 0) / atoms.length;
    const cy = atoms.reduce((sum, atom) => sum + atom.pos[1], 0) / atoms.length;
    atoms.forEach((atom) => { atom.pos = [atom.pos[0] - cx, atom.pos[1] - cy, atom.pos[2]]; });
  }

  applyRingConformations(atoms, graph);

  const heavyCount = atoms.length;
  addHydrogens(atoms, bonds, graph);
  optimizeCoordinates(atoms, bonds, heavyCount, graph);
  assertGeneratedTopology(graph, atoms, bonds, heavyCount);

  if (atoms.length) {
    const cx = atoms.reduce((sum, atom) => sum + atom.pos[0], 0) / atoms.length;
    const cy = atoms.reduce((sum, atom) => sum + atom.pos[1], 0) / atoms.length;
    const cz = atoms.reduce((sum, atom) => sum + atom.pos[2], 0) / atoms.length;
    atoms.forEach((atom) => { atom.pos = [atom.pos[0] - cx, atom.pos[1] - cy, atom.pos[2] - cz]; });
  }

  const identity = classifyStructure(graph);
  const moleculeName = identity.detectedName.startsWith("Custom") && !name.startsWith("Custom") ? name : identity.detectedName;

  return {
    id: `built-${Date.now()}`,
    name: moleculeName,
    formula: identity.formula,
    description: `Formula ${identity.formula}; ${graph.cycleRank} ring(s); ${identity.structureClass}; framework: ${identity.framework}; aromaticity: ${identity.aromaticity}; functional groups: ${identity.functionalGroups.join(", ")}. Generated directly from the builder molecular graph with topology verification.`,
    group: identity.structureClass,
    atoms,
    bonds,
  };
}