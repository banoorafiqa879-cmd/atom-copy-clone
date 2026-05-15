// Curated organic molecules with 3D coords (Angstrom-ish).
// Coordinates are simplified/idealized for visualization clarity.

export type Element = "C" | "H" | "O" | "N" | "Cl" | "F" | "Br" | "S";

export interface Atom {
  el: Element;
  pos: [number, number, number];
  label?: string;
}

export interface Bond {
  a: number;
  b: number;
  order: 1 | 2 | 3;
}

export interface Molecule {
  id: string;
  name: string;
  formula: string;
  description: string;
  group: string;
  atoms: Atom[];
  bonds: Bond[];
}

// Helper geometry
const T = Math.PI * 2;

// Benzene ring (C6H6)
const benzene: Molecule = (() => {
  const r = 1.4;
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * T;
    atoms.push({ el: "C", pos: [Math.cos(a) * r, Math.sin(a) * r, 0] });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * T;
    atoms.push({ el: "H", pos: [Math.cos(a) * (r + 1.08), Math.sin(a) * (r + 1.08), 0] });
  }
  for (let i = 0; i < 6; i++) {
    bonds.push({ a: i, b: (i + 1) % 6, order: i % 2 === 0 ? 2 : 1 });
    bonds.push({ a: i, b: 6 + i, order: 1 });
  }
  return {
    id: "benzene",
    name: "Benzene",
    formula: "C₆H₆",
    group: "Aromatic ring",
    description: "A flat hexagonal aromatic hydrocarbon with delocalized π electrons.",
    atoms,
    bonds,
  };
})();

// Methane CH4 - tetrahedral
const methane: Molecule = {
  id: "methane",
  name: "Methane",
  formula: "CH₄",
  group: "Alkane",
  description: "Simplest alkane. Tetrahedral geometry with 109.5° bond angles.",
  atoms: [
    { el: "C", pos: [0, 0, 0] },
    { el: "H", pos: [0.63, 0.63, 0.63] },
    { el: "H", pos: [-0.63, -0.63, 0.63] },
    { el: "H", pos: [-0.63, 0.63, -0.63] },
    { el: "H", pos: [0.63, -0.63, -0.63] },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
  ],
};

// Ethanol C2H5OH
const ethanol: Molecule = {
  id: "ethanol",
  name: "Ethanol",
  formula: "C₂H₆O",
  group: "Alcohol (-OH)",
  description: "Common alcohol with a hydroxyl functional group.",
  atoms: [
    { el: "C", pos: [-1.2, 0, 0] },
    { el: "C", pos: [0.2, 0.2, 0] },
    { el: "O", pos: [0.9, -1.0, 0] },
    { el: "H", pos: [-1.6, -0.9, 0.5] },
    { el: "H", pos: [-1.6, 0.9, 0.5] },
    { el: "H", pos: [-1.4, 0, -1.0] },
    { el: "H", pos: [0.6, 0.8, 0.9] },
    { el: "H", pos: [0.6, 0.8, -0.9] },
    { el: "H", pos: [1.85, -0.9, 0] },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
    { a: 0, b: 5, order: 1 },
    { a: 1, b: 6, order: 1 },
    { a: 1, b: 7, order: 1 },
    { a: 2, b: 8, order: 1 },
  ],
};

// Water H2O
const water: Molecule = {
  id: "water",
  name: "Water",
  formula: "H₂O",
  group: "Inorganic",
  description: "Bent molecule with a 104.5° bond angle.",
  atoms: [
    { el: "O", pos: [0, 0, 0] },
    { el: "H", pos: [0.76, 0.59, 0] },
    { el: "H", pos: [-0.76, 0.59, 0] },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
  ],
};

// Ammonia NH3
const ammonia: Molecule = {
  id: "ammonia",
  name: "Ammonia",
  formula: "NH₃",
  group: "Amine base",
  description: "Trigonal pyramidal molecule with a lone pair on nitrogen.",
  atoms: [
    { el: "N", pos: [0, 0, 0] },
    { el: "H", pos: [0.94, -0.33, 0] },
    { el: "H", pos: [-0.47, -0.33, 0.81] },
    { el: "H", pos: [-0.47, -0.33, -0.81] },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
  ],
};

// Chloromethane CH3Cl
const chloromethane: Molecule = {
  id: "chloromethane",
  name: "Chloromethane",
  formula: "CH₃Cl",
  group: "Haloalkane",
  description: "Methane with one hydrogen replaced by chlorine.",
  atoms: [
    { el: "C", pos: [0, 0, 0] },
    { el: "Cl", pos: [1.78, 0, 0] },
    { el: "H", pos: [-0.36, 1.03, 0] },
    { el: "H", pos: [-0.36, -0.51, 0.89] },
    { el: "H", pos: [-0.36, -0.51, -0.89] },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 0, b: 4, order: 1 },
  ],
};

// Ethylene C2H4 (double bond)
const ethylene: Molecule = {
  id: "ethylene",
  name: "Ethylene",
  formula: "C₂H₄",
  group: "Alkene (C=C)",
  description: "Simplest alkene. Planar with a C=C double bond.",
  atoms: [
    { el: "C", pos: [-0.67, 0, 0] },
    { el: "C", pos: [0.67, 0, 0] },
    { el: "H", pos: [-1.23, 0.92, 0] },
    { el: "H", pos: [-1.23, -0.92, 0] },
    { el: "H", pos: [1.23, 0.92, 0] },
    { el: "H", pos: [1.23, -0.92, 0] },
  ],
  bonds: [
    { a: 0, b: 1, order: 2 },
    { a: 0, b: 2, order: 1 },
    { a: 0, b: 3, order: 1 },
    { a: 1, b: 4, order: 1 },
    { a: 1, b: 5, order: 1 },
  ],
};

// Acetylene C2H2 (triple bond)
const acetylene: Molecule = {
  id: "acetylene",
  name: "Acetylene",
  formula: "C₂H₂",
  group: "Alkyne (C≡C)",
  description: "Linear molecule with a triple bond between carbons.",
  atoms: [
    { el: "C", pos: [-0.6, 0, 0] },
    { el: "C", pos: [0.6, 0, 0] },
    { el: "H", pos: [-1.66, 0, 0] },
    { el: "H", pos: [1.66, 0, 0] },
  ],
  bonds: [
    { a: 0, b: 1, order: 3 },
    { a: 0, b: 2, order: 1 },
    { a: 1, b: 3, order: 1 },
  ],
};

// Acetic acid CH3COOH
const aceticAcid: Molecule = {
  id: "acetic-acid",
  name: "Acetic Acid",
  formula: "CH₃COOH",
  group: "Carboxylic acid",
  description: "The acid in vinegar. Contains a -COOH carboxyl group.",
  atoms: [
    { el: "C", pos: [-1.2, 0, 0] },
    { el: "C", pos: [0.2, 0.3, 0] },
    { el: "O", pos: [1.0, -0.7, 0] },
    { el: "O", pos: [0.7, 1.55, 0] },
    { el: "H", pos: [-1.5, -0.5, 0.9] },
    { el: "H", pos: [-1.5, -0.5, -0.9] },
    { el: "H", pos: [-1.6, 1.0, 0] },
    { el: "H", pos: [1.95, -0.55, 0] },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 1, b: 2, order: 1 },
    { a: 1, b: 3, order: 2 },
    { a: 0, b: 4, order: 1 },
    { a: 0, b: 5, order: 1 },
    { a: 0, b: 6, order: 1 },
    { a: 2, b: 7, order: 1 },
  ],
};

export const MOLECULES: Molecule[] = [
  methane,
  water,
  ammonia,
  ethylene,
  acetylene,
  ethanol,
  chloromethane,
  aceticAcid,
  benzene,
];

export const ELEMENT_DATA: Record<Element, { color: string; radius: number; name: string }> = {
  H: { color: "#ffffff", radius: 0.28, name: "Hydrogen" },
  C: { color: "#444444", radius: 0.42, name: "Carbon" },
  O: { color: "#ff3344", radius: 0.42, name: "Oxygen" },
  N: { color: "#3370ff", radius: 0.42, name: "Nitrogen" },
  Cl: { color: "#33dd55", radius: 0.5, name: "Chlorine" },
  F: { color: "#aaff66", radius: 0.4, name: "Fluorine" },
  Br: { color: "#a0522d", radius: 0.55, name: "Bromine" },
  S: { color: "#ffd633", radius: 0.5, name: "Sulfur" },
};