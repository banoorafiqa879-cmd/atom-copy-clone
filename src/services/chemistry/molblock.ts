import type { Molecule } from "@/data/molecules";

/**
 * Serialize an internal Molecule to a V2000 MOL block string that RDKit
 * can ingest. Preserves atom positions and bond orders as-is.
 */
export function moleculeToMolblock(mol: Molecule): string {
  const lines: string[] = [];
  lines.push(mol.name || "molecule");
  lines.push("  AtomForge");
  lines.push("");
  const nA = mol.atoms.length;
  const nB = mol.bonds.length;
  lines.push(
    `${pad(nA, 3)}${pad(nB, 3)}  0  0  0  0  0  0  0  0999 V2000`,
  );
  for (const a of mol.atoms) {
    const [x, y, z] = a.pos;
    lines.push(
      `${f10(x)}${f10(y)}${f10(z)} ${padR(a.el, 3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    );
  }
  for (const b of mol.bonds) {
    lines.push(
      `${pad(b.a + 1, 3)}${pad(b.b + 1, 3)}${pad(b.order, 3)}  0  0  0  0`,
    );
  }
  lines.push("M  END");
  return lines.join("\n");
}

function pad(n: number, w: number) {
  return String(n).padStart(w);
}
function padR(s: string, w: number) {
  return (s + "   ").slice(0, w);
}
function f10(n: number) {
  // 10-char fixed: e.g. "    1.2345"
  return n.toFixed(4).padStart(10);
}
