import type { Molecule, Atom, Bond, Element } from "@/data/molecules";

const KNOWN: Element[] = ["C", "H", "O", "N", "Cl", "F", "Br"];

function toSubscript(formula: string) {
  return formula.replace(/(\d+)/g, (m) =>
    m
      .split("")
      .map((d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)])
      .join(""),
  );
}

export function parseSDF(sdf: string, name: string): Molecule | null {
  const lines = sdf.split(/\r?\n/);
  // Counts line is the 4th line (index 3)
  if (lines.length < 5) return null;
  const counts = lines[3];
  const nAtoms = parseInt(counts.slice(0, 3).trim(), 10);
  const nBonds = parseInt(counts.slice(3, 6).trim(), 10);
  if (!nAtoms || isNaN(nAtoms)) return null;

  const atoms: Atom[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const ln = lines[4 + i];
    if (!ln) return null;
    const x = parseFloat(ln.slice(0, 10));
    const y = parseFloat(ln.slice(10, 20));
    const z = parseFloat(ln.slice(20, 30));
    const sym = ln.slice(31, 34).trim() as Element;
    if (!KNOWN.includes(sym)) {
      // Unsupported element — bail out gracefully
      return null;
    }
    atoms.push({ el: sym, pos: [x, y, z] });
  }

  const bonds: Bond[] = [];
  for (let i = 0; i < nBonds; i++) {
    const ln = lines[4 + nAtoms + i];
    if (!ln) break;
    const a = parseInt(ln.slice(0, 3).trim(), 10) - 1;
    const b = parseInt(ln.slice(3, 6).trim(), 10) - 1;
    const o = parseInt(ln.slice(6, 9).trim(), 10) as 1 | 2 | 3;
    if (a >= 0 && b >= 0) bonds.push({ a, b, order: (o === 2 || o === 3 ? o : 1) });
  }

  // Center molecule
  const cx = atoms.reduce((s, a) => s + a.pos[0], 0) / atoms.length;
  const cy = atoms.reduce((s, a) => s + a.pos[1], 0) / atoms.length;
  const cz = atoms.reduce((s, a) => s + a.pos[2], 0) / atoms.length;
  for (const a of atoms) {
    a.pos = [a.pos[0] - cx, a.pos[1] - cy, a.pos[2] - cz];
  }

  // Compute molecular formula (Hill order: C, H, then alphabetical)
  const counts2: Record<string, number> = {};
  for (const a of atoms) counts2[a.el] = (counts2[a.el] || 0) + 1;
  const order = Object.keys(counts2).sort((a, b) => {
    if (a === "C") return -1;
    if (b === "C") return 1;
    if (a === "H") return -1;
    if (b === "H") return 1;
    return a.localeCompare(b);
  });
  const formula = toSubscript(
    order.map((e) => (counts2[e] === 1 ? e : `${e}${counts2[e]}`)).join(""),
  );

  return {
    id: `iupac-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    formula,
    group: "Custom (IUPAC)",
    description: `Generated from IUPAC name "${name}" via NCI CACTUS structure service.`,
    atoms,
    bonds,
  };
}

export async function iupacToMolecule(name: string): Promise<Molecule> {
  const clean = name.trim();
  if (!clean) throw new Error("Please enter an IUPAC name.");
  const url = `https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(
    clean,
  )}/file?format=sdf&get3d=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Invalid or unsupported IUPAC name");
  const sdf = await res.text();
  if (sdf.includes("Page not found") || !sdf.includes("M  END")) {
    throw new Error("Invalid or unsupported IUPAC name");
  }
  const mol = parseSDF(sdf, clean);
  if (!mol) throw new Error("Could not parse the generated structure");
  return mol;
}