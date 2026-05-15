import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { type Molecule, ELEMENT_DATA } from "@/data/molecules";
import { PlaneOfSymmetry, CentreOfSymmetry, AxisOfSymmetry, StereocentreMarkers, type SymPlane } from "./Symmetry";
import { neighbors, type SymAxis } from "@/lib/chem-analysis";

interface Props {
  molecule: Molecule;
  spaceFilling: boolean;
  autoRotate: boolean;
  selected: number | null;
  onSelect: (i: number | null) => void;
  showPOS?: boolean;
  activePlane?: SymPlane | null;
  showCOS?: boolean;
  hasCOS?: boolean;
  activeAxis?: SymAxis | null;
  stereoIndices?: number[];
}

function Bond({
  start,
  end,
  order,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  order: 1 | 2 | 3;
}) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize()
  );

  // perpendicular offset for multi bonds
  const perp = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize();
  const offsets = order === 1 ? [0] : order === 2 ? [-0.12, 0.12] : [-0.18, 0, 0.18];

  return (
    <group position={mid} quaternion={quat}>
      {offsets.map((o, i) => (
        <mesh key={i} position={perp.clone().multiplyScalar(o)}>
          <cylinderGeometry args={[0.07, 0.07, length, 16]} />
          <meshStandardMaterial
            color="#cfd6e4"
            metalness={0.6}
            roughness={0.25}
            emissive="#3a4a6a"
            emissiveIntensity={0.15}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function Molecule3D({
  molecule,
  spaceFilling,
  autoRotate,
  selected,
  onSelect,
  showPOS,
  activePlane,
  showCOS,
  hasCOS,
  activeAxis,
  stereoIndices,
}: Props) {
  const group = useRef<THREE.Group>(null);

  const center = useMemo(() => {
    const c = new THREE.Vector3();
    molecule.atoms.forEach((a) => c.add(new THREE.Vector3(...a.pos)));
    c.divideScalar(molecule.atoms.length);
    return c;
  }, [molecule]);

  useFrame((_, delta) => {
    if (group.current && autoRotate) {
      group.current.rotation.y += delta * 0.4;
    }
  });

  // Outside-tap dismiss for selected atom tooltip
  useEffect(() => {
    if (selected === null) return;
    const dismiss = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-atom-tooltip]")) return;
      if (t?.closest("canvas")) return; // canvas clicks handled by mesh
      onSelect(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSelect(null); };
    // Defer attach so the originating tap doesn't immediately dismiss
    const id = window.setTimeout(() => {
      window.addEventListener("pointerdown", dismiss);
      window.addEventListener("keydown", onKey);
    }, 50);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, onSelect]);

  const stereoSet = useMemo(() => new Set(stereoIndices ?? []), [stereoIndices]);
  const singleStereo = (stereoIndices?.length ?? 0) === 1;

  return (
    <group ref={group} position={[-center.x, -center.y, -center.z]}>
      {showPOS && activePlane && (
        <PlaneOfSymmetry mol={molecule} plane={activePlane} />
      )}
      {showCOS && hasCOS && <CentreOfSymmetry mol={molecule} />}
      {activeAxis && <AxisOfSymmetry mol={molecule} axis={activeAxis} />}
      {stereoIndices && stereoIndices.length > 0 && (
        <StereocentreMarkers mol={molecule} indices={stereoIndices} />
      )}

      {!spaceFilling &&
        molecule.bonds.map((b, i) => {
          const s = new THREE.Vector3(...molecule.atoms[b.a].pos);
          const e = new THREE.Vector3(...molecule.atoms[b.b].pos);
          return <Bond key={i} start={s} end={e} order={b.order} />;
        })}

      {molecule.atoms.map((atom, i) => {
        const data = ELEMENT_DATA[atom.el];
        const r = spaceFilling ? data.radius * 2.4 : data.radius;
        const isSelected = selected === i;
        const isStereo = stereoSet.has(i);
        const subs = isSelected ? neighbors(molecule, i).map(n => molecule.atoms[n.idx].el) : [];
        return (
          <group key={i} position={atom.pos}>
            <mesh
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(isSelected ? null : i);
              }}
              scale={isSelected ? 1.18 : 1}
            >
              <sphereGeometry args={[r, 48, 48]} />
              <meshPhysicalMaterial
                color={data.color}
                metalness={0.35}
                roughness={0.25}
                clearcoat={0.7}
                clearcoatRoughness={0.15}
                emissive={isSelected ? data.color : "#000000"}
                emissiveIntensity={isSelected ? 0.6 : 0}
              />
            </mesh>
            {isSelected && (
              <Html
                center
                distanceFactor={8}
                position={[0, r + 0.5, 0]}
                zIndexRange={[40, 0]}
                style={{ pointerEvents: "auto" }}
              >
                <div
                  data-atom-tooltip
                  className="glass rounded-xl px-3 py-2 text-xs shadow-xl border border-white/10 max-w-[220px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold neon-text">{data.name}</div>
                    <div className="text-[10px] text-foreground/50 font-mono">#{i + 1}</div>
                  </div>
                  <div className="text-foreground/70 text-[11px] mt-0.5">Symbol: {atom.el}</div>
                  {subs.length > 0 && (
                    <div className="text-foreground/60 text-[10px] mt-1">
                      Bonded to: {subs.join(", ")}
                    </div>
                  )}
                  {isStereo && (
                    <div className="mt-2 pt-2 border-t border-white/10">
                      <div className="text-[10px] uppercase tracking-widest text-[#ffd84d] font-semibold">
                        Stereogenic centre
                      </div>
                      <div className="text-[10px] text-foreground/70 mt-0.5">
                        {singleStereo ? "Configuration: R / S enantiomers" : "One of multiple stereocentres"}
                      </div>
                      <div className="text-[10px] text-foreground/50 mt-0.5">
                        4 distinct substituents → CIP priority defines R/S.
                      </div>
                    </div>
                  )}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}