import { describe, expect, it } from "vitest";
import { build3D, describeBuilderGraph, validateBuilderState, type BuilderStateGraph } from "./builderGraph";

function heavyBondKeys(mol: ReturnType<typeof build3D>, heavyCount: number) {
  return mol.bonds
    .filter((bond) => bond.a < heavyCount && bond.b < heavyCount)
    .map((bond) => [bond.a, bond.b].sort((a, b) => a - b).join("-"))
    .sort();
}

function graphBondKeys(state: BuilderStateGraph) {
  const indexById = new Map(state.nodes.map((node, index) => [node.id, index]));
  return state.edges
    .map((edge) => [indexById.get(edge.a)!, indexById.get(edge.b)!].sort((a, b) => a - b).join("-"))
    .sort();
}

function expectTopologyPreserved(state: BuilderStateGraph) {
  const mol = build3D(state, "test");
  expect(mol.atoms.slice(0, state.nodes.length).map((atom) => atom.el)).toEqual(state.nodes.map((node) => node.el));
  expect(heavyBondKeys(mol, state.nodes.length)).toEqual(graphBondKeys(state));
  return mol;
}

const atom = (id: number, x: number, y: number) => ({ id, el: "C" as const, x, y });
const bond = (id: number, a: number, b: number, order: 1 | 2 | 3 = 1) => ({ id, a, b, order });

describe("builder graph-preserving 3D generation", () => {
  it("keeps cyclobutane topology and puckers the ring", () => {
    const state: BuilderStateGraph = {
      nodes: [atom(1, 0, 0), atom(2, 46, 0), atom(3, 46, 46), atom(4, 0, 46)],
      edges: [bond(10, 1, 2), bond(11, 2, 3), bond(12, 3, 4), bond(13, 4, 1)],
    };

    const debug = describeBuilderGraph(state);
    expect(debug.ringCount).toBe(1);
    expect(debug.rings).toHaveLength(1);
    const mol = expectTopologyPreserved(state);
    const heavyZ = mol.atoms.slice(0, 4).map((atom) => Math.abs(atom.pos[2]));
    expect(Math.max(...heavyZ)).toBeGreaterThan(0.05);
  });

  it("preserves two cyclobutanes fused through one shared bond", () => {
    const state: BuilderStateGraph = {
      nodes: [atom(1, 0, 0), atom(2, 46, 0), atom(3, 46, 46), atom(4, 0, 46), atom(5, 46, -46), atom(6, 0, -46)],
      edges: [bond(10, 1, 2), bond(11, 2, 3), bond(12, 3, 4), bond(13, 4, 1), bond(14, 2, 5), bond(15, 5, 6), bond(16, 6, 1)],
    };

    const debug = describeBuilderGraph(state);
    expect(debug.ringCount).toBe(2);
    expect(debug.bondRingMembership["1-2"]).toEqual([1, 2]);
    expectTopologyPreserved(state);
  });

  it("preserves decalin-like fused cyclohexane topology", () => {
    const state: BuilderStateGraph = {
      nodes: [
        atom(1, 0, 0), atom(2, 46, 0), atom(3, 69, 40), atom(4, 46, 80), atom(5, 0, 80), atom(6, -23, 40),
        atom(7, 69, -40), atom(8, 46, -80), atom(9, 0, -80), atom(10, -23, -40),
      ],
      edges: [
        bond(10, 1, 2), bond(11, 2, 3), bond(12, 3, 4), bond(13, 4, 5), bond(14, 5, 6), bond(15, 6, 1),
        bond(16, 2, 7), bond(17, 7, 8), bond(18, 8, 9), bond(19, 9, 10), bond(20, 10, 1),
      ],
    };

    const debug = describeBuilderGraph(state);
    expect(debug.ringCount).toBe(2);
    expect(debug.bondRingMembership["1-2"]).toEqual([1, 2]);
    expectTopologyPreserved(state);
  });

  it("keeps benzene planar while preserving alternating bond orders", () => {
    const state: BuilderStateGraph = {
      nodes: [atom(1, 0, -46), atom(2, 40, -23), atom(3, 40, 23), atom(4, 0, 46), atom(5, -40, 23), atom(6, -40, -23)],
      edges: [bond(10, 1, 2, 2), bond(11, 2, 3), bond(12, 3, 4, 2), bond(13, 4, 5), bond(14, 5, 6, 2), bond(15, 6, 1)],
    };

    const mol = expectTopologyPreserved(state);
    expect(mol.bonds.slice(0, 6).map((bond) => bond.order)).toEqual([2, 1, 2, 1, 2, 1]);
    const heavyZ = mol.atoms.slice(0, 6).map((atom) => Math.abs(atom.pos[2]));
    expect(Math.max(...heavyZ)).toBeLessThan(0.001);
  });

  it("preserves spiro topology with one shared atom and two independent rings", () => {
    const state: BuilderStateGraph = {
      nodes: [atom(1, 0, 0), atom(2, 46, 0), atom(3, 46, 46), atom(4, 0, 46), atom(5, -46, 0), atom(6, -46, -46), atom(7, 0, -46)],
      edges: [bond(10, 1, 2), bond(11, 2, 3), bond(12, 3, 4), bond(13, 4, 1), bond(14, 1, 5), bond(15, 5, 6), bond(16, 6, 7), bond(17, 7, 1)],
    };

    const debug = describeBuilderGraph(state);
    expect(debug.ringCount).toBe(2);
    expect(debug.atomRingMembership[1]).toEqual([1, 2]);
    expectTopologyPreserved(state);
  });

  it("rejects invalid valence instead of silently generating a random structure", () => {
    const state: BuilderStateGraph = {
      nodes: [atom(1, 0, 0), atom(2, 46, 0), atom(3, -46, 0), atom(4, 0, 46)],
      edges: [bond(10, 1, 2, 2), bond(11, 1, 3, 2), bond(12, 1, 4, 2)],
    };

    const validation = validateBuilderState(state);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("exceeds valence");
  });
});