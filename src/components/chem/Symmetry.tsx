import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { type Molecule, ELEMENT_DATA } from "@/data/molecules";
import type { SymAxis } from "@/lib/chem-analysis";
import { analyzeStereochemistry } from "@/lib/stereochemistryEngine";

// ---------- Detection helpers ----------

const EPS = 0.35; // tolerance for matching mirrored atoms (Å)

function getCenter(mol: Molecule) {
  const c = new THREE.Vector3();
  mol.atoms.forEach((a) => c.add(new THREE.Vector3(...a.pos)));
  return c.divideScalar(mol.atoms.length);
}

function reflect(p: THREE.Vector3, normal: THREE.Vector3, point: THREE.Vector3) {
  const v = new THREE.Vector3().subVectors(p, point);
  const d = v.dot(normal);
  return new THREE.Vector3().copy(p).sub(normal.clone().multiplyScalar(2 * d));
}

function planeIsSymmetry(mol: Molecule, normal: THREE.Vector3, point: THREE.Vector3) {
  const used = new Set<number>();
  for (let i = 0; i < mol.atoms.length; i++) {
    const a = mol.atoms[i];
    const p = new THREE.Vector3(...a.pos);
    const r = reflect(p, normal, point);
    let match = -1;
    for (let j = 0; j < mol.atoms.length; j++) {
      if (used.has(j)) continue;
      if (mol.atoms[j].el !== a.el) continue;
      if (new THREE.Vector3(...mol.atoms[j].pos).distanceTo(r) < EPS) {
        match = j;
        break;
      }
    }
    if (match === -1) return false;
    used.add(match);
  }
  return true;
}

export interface SymPlane {
  normal: THREE.Vector3;
  label: string;
}

export function detectPlanes(mol: Molecule): SymPlane[] {
  return analyzeStereochemistry(mol).symmetryPlanes.map((p) => ({
    normal: new THREE.Vector3(...p.normal).normalize(),
    label: p.label,
  }));
}

export function detectCentre(mol: Molecule): boolean {
  return analyzeStereochemistry(mol).hasSymmetryCentre;
}

// ---------- Visual components (rendered inside the same molecule group) ----------

export function PlaneOfSymmetry({
  mol,
  plane,
}: {
  mol: Molecule;
  plane: SymPlane;
}) {
  const center = useMemo(() => getCenter(mol), [mol]);
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal.clone().normalize());
    return q;
  }, [plane]);

  // mirrored atom highlights
  const highlights = useMemo(() => {
    return mol.atoms.map((a) => {
      const p = new THREE.Vector3(...a.pos);
      const r = reflect(p, plane.normal, center);
      return { p, r, el: a.el };
    });
  }, [mol, plane, center]);

  return (
    <group>
      <group position={center} quaternion={quat}>
        <mesh>
          <planeGeometry args={[6, 6]} />
          <meshBasicMaterial
            color="#7af6ff"
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
        {/* Glowing border */}
        <lineSegments>
          <edgesGeometry args={[new THREE.PlaneGeometry(6, 6)]} />
          <lineBasicMaterial color="#7af6ff" transparent opacity={0.9} />
        </lineSegments>
        <Html position={[0, 3.1, 0]} center distanceFactor={10}>
          <div className="glass rounded-lg px-3 py-1 text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))] whitespace-nowrap">
            {plane.label}
          </div>
        </Html>
      </group>
      {highlights.map((h, i) => (
        <group key={i}>
          <mesh position={h.p}>
            <sphereGeometry args={[ELEMENT_DATA[h.el].radius * 1.25, 24, 24]} />
            <meshBasicMaterial color="#7af6ff" transparent opacity={0.25} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function CentreOfSymmetry({ mol }: { mol: Molecule }) {
  const center = useMemo(() => getCenter(mol), [mol]);
  return (
    <group position={center}>
      <mesh>
        <sphereGeometry args={[0.18, 32, 32]} />
        <meshBasicMaterial color="#ff6bf2" />
      </mesh>
      {/* pulsing halo */}
      <mesh>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshBasicMaterial color="#ff6bf2" transparent opacity={0.3} />
      </mesh>
      {/* connecting lines between atom pairs through center */}
      {mol.atoms.map((a, i) => {
        const p = new THREE.Vector3(...a.pos);
        const r = new THREE.Vector3().copy(center).multiplyScalar(2).sub(p);
        // draw only once per pair
        if (p.x + p.y + p.z < r.x + r.y + r.z) return null;
        const points = [p.clone().sub(center), r.clone().sub(center)];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <line key={i}>
            <primitive object={geom} attach="geometry" />
            <lineBasicMaterial color="#ff6bf2" transparent opacity={0.45} />
          </line>
        );
      })}
      <Html center position={[0, 0.55, 0]} distanceFactor={10}>
        <div className="glass rounded-lg px-3 py-1 text-[10px] uppercase tracking-widest text-[#ff6bf2] whitespace-nowrap">
          Centre of Symmetry
        </div>
      </Html>
    </group>
  );
}

/** Glowing rotation axis line + label. */
export function AxisOfSymmetry({ mol, axis }: { mol: Molecule; axis: SymAxis }) {
  const c = useMemo(() => getCenter(mol), [mol]);
  const len = 6;
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.axis.clone().normalize());
    return q;
  }, [axis]);
  return (
    <group position={c} quaternion={quat}>
      <mesh>
        <cylinderGeometry args={[0.04, 0.04, len, 16]} />
        <meshBasicMaterial color="#a78bff" transparent opacity={0.95} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.16, 0.16, len, 16]} />
        <meshBasicMaterial color="#a78bff" transparent opacity={0.18} />
      </mesh>
      <Html position={[0, len / 2 + 0.3, 0]} center distanceFactor={10}>
        <div className="glass rounded-lg px-2.5 py-1 text-[10px] uppercase tracking-widest text-[#a78bff] whitespace-nowrap">
          {axis.label} axis
        </div>
      </Html>
    </group>
  );
}

/** Glowing stereocentre markers. */
export function StereocentreMarkers({ mol, indices }: { mol: Molecule; indices: number[] }) {
  return (
    <group>
      {indices.map((i) => {
        const a = mol.atoms[i];
        const r = ELEMENT_DATA[a.el].radius * 1.5;
        return (
          <group key={i} position={a.pos}>
            <mesh>
              <sphereGeometry args={[r, 24, 24]} />
              <meshBasicMaterial color="#ffd84d" transparent opacity={0.28} />
            </mesh>
            <Html position={[0, r + 0.2, 0]} center distanceFactor={10}>
              <div className="rounded-md px-1.5 py-0.5 text-[9px] font-bold bg-[#ffd84d] text-black">
                *
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}