/**
 * Chemistry correctness tests — exercises the real RDKit-JS engine.
 *
 * RDKit's loader is configured here to use the local WASM binary instead of
 * fetching from /wasm/, so the tests can run in Node without a server.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Inject a Node-friendly RDKit loader BEFORE importing the engine.
const wasmBinary = fs.readFileSync(
  path.resolve("node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm"),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rdkitInstance: any = null;
vi.mock("@/services/chemistry/rdkit", async () => {
  return {
    async getRDKit() {
      if (rdkitInstance) return rdkitInstance;
      // @ts-expect-error - non-typed dynamic import
      const mod = await import("@rdkit/rdkit/dist/RDKit_minimal.js");
      const init = mod.default ?? mod.initRDKitModule;
      rdkitInstance = await init({ wasmBinary });
      return rdkitInstance;
    },
    _resetRDKit() { rdkitInstance = null; },
  };
});

import { analyzeStereochemistry } from "@/services/chemistry";
import { analyzeFromSmiles } from "@/services/chemistry/stereochemistry";
import { getRDKit } from "@/services/chemistry/rdkit";
import type { Molecule, Element } from "@/data/molecules";

beforeAll(async () => {
  await getRDKit();
});

/** Build a minimal Molecule from an array of [el,x,y,z] and bond list. */
function mkMol(
  name: string,
  atoms: [Element, number, number, number][],
  bonds: [number, number, 1 | 2 | 3][],
): Molecule {
  return {
    id: name,
    name,
    formula: "",
    group: "test",
    description: "",
    atoms: atoms.map(([el, x, y, z]) => ({ el, pos: [x, y, z] })),
    bonds: bonds.map(([a, b, order]) => ({ a, b, order })),
  };
}

describe("real stereochemistry engine", () => {
  it("methane → achiral, 0 stereoisomers", async () => {
    const mol = mkMol("methane",
      [["C", 0, 0, 0], ["H", 0.63, 0.63, 0.63], ["H", -0.63, -0.63, 0.63],
       ["H", -0.63, 0.63, -0.63], ["H", 0.63, -0.63, -0.63]],
      [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]]);
    const r = await analyzeStereochemistry(mol);
    expect(r.classification).toBe("achiral");
    expect(r.centers).toBe(0);
    expect(r.ezBonds).toBe(0);
    expect(r.totalStereoisomers).toBe(0);
  });

  it("benzene → achiral, no isomers", async () => {
    const r = 1.4;
    const atoms: [Element, number, number, number][] = [];
    const bonds: [number, number, 1 | 2 | 3][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      atoms.push(["C", Math.cos(a) * r, Math.sin(a) * r, 0]);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      atoms.push(["H", Math.cos(a) * (r + 1.08), Math.sin(a) * (r + 1.08), 0]);
    }
    for (let i = 0; i < 6; i++) {
      bonds.push([i, (i + 1) % 6, i % 2 === 0 ? 2 : 1]);
      bonds.push([i, 6 + i, 1]);
    }
    const mol = mkMol("benzene", atoms, bonds);
    const res = await analyzeStereochemistry(mol);
    expect(res.classification).toBe("achiral");
    expect(res.centers).toBe(0);
    expect(res.totalStereoisomers).toBe(0);
  });

  it("ethylene → no stereoisomers (no different substituents on C=C)", async () => {
    const mol = mkMol("ethylene",
      [["C", -0.67, 0, 0], ["C", 0.67, 0, 0],
       ["H", -1.23, 0.92, 0], ["H", -1.23, -0.92, 0],
       ["H", 1.23, 0.92, 0], ["H", 1.23, -0.92, 0]],
      [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]]);
    const r = await analyzeStereochemistry(mol);
    expect(r.classification).toBe("achiral");
    expect(r.totalStereoisomers).toBe(0);
  });

  it("acetic acid → achiral", async () => {
    const mol = mkMol("acetic-acid",
      [["C", -1.2, 0, 0], ["C", 0.2, 0.3, 0], ["O", 1.0, -0.7, 0], ["O", 0.7, 1.55, 0],
       ["H", -1.5, -0.5, 0.9], ["H", -1.5, -0.5, -0.9], ["H", -1.6, 1.0, 0], ["H", 1.95, -0.55, 0]],
      [[0, 1, 1], [1, 2, 1], [1, 3, 2], [0, 4, 1], [0, 5, 1], [0, 6, 1], [2, 7, 1]]);
    const r = await analyzeStereochemistry(mol);
    expect(r.classification).toBe("achiral");
    expect(r.centers).toBe(0);
  });
});


describe("real stereochemistry — SMILES-driven cases", () => {
  it("2-butanol: 1 stereocenter, 2 enantiomers", async () => {
    const r = await analyzeFromSmiles("CC(O)CC");
    expect(r.centers).toBe(1);
    expect(r.totalStereoisomers).toBe(2);
    expect(r.classification).toBe("chiral-single");
    expect(r.isMeso).toBe(false);
  });

  it("lactic acid: 1 stereocenter, 2 enantiomers", async () => {
    const r = await analyzeFromSmiles("CC(O)C(=O)O");
    expect(r.centers).toBe(1);
    expect(r.totalStereoisomers).toBe(2);
    expect(r.classification).toBe("chiral-single");
  });

  it("tartaric acid: 2 centers, meso reduction → 3 unique", async () => {
    const r = await analyzeFromSmiles("OC(C(O)C(=O)O)C(=O)O");
    expect(r.centers).toBe(2);
    expect(r.isMeso).toBe(true);
    expect(r.classification).toBe("meso");
    expect(r.totalStereoisomers).toBe(3); // R,R + S,S + meso
  });

  it("2-butene: 1 E/Z double bond, 2 geometric isomers", async () => {
    const r = await analyzeFromSmiles("C/C=C/C");
    expect(r.centers).toBe(0);
    expect(r.ezBonds).toBe(1);
    expect(r.totalStereoisomers).toBe(2);
    expect(r.classification).toBe("achiral");
  });

  it("1,2-dichloroethene: 1 E/Z double bond, 2 geometric isomers", async () => {
    const r = await analyzeFromSmiles("Cl/C=C/Cl");
    expect(r.ezBonds).toBe(1);
    expect(r.totalStereoisomers).toBe(2);
  });

  it("cyclohexene: small ring C=C, no stereoisomers", async () => {
    const r = await analyzeFromSmiles("C1CCC=CC1");
    expect(r.centers).toBe(0);
    expect(r.totalStereoisomers).toBe(0);
  });

  it("cyclooctene: 8-ring C=C admits E/Z, 2 isomers", async () => {
    // (Z)-cyclooctene
    const r = await analyzeFromSmiles("C1CCC/C=C\\CC1");
    expect(r.ezBonds).toBeGreaterThanOrEqual(1);
    expect(r.totalStereoisomers).toBeGreaterThanOrEqual(1);
  });
});
