import { useEffect, useMemo, useState, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { TOUCH } from "three";
import * as THREE from "three";
import { X, FlaskConical, Link2, Link2Off } from "lucide-react";
import { type Molecule, type Atom } from "@/data/molecules";
import Molecule3D from "./Molecule3D";
import {
  neighbors,
  stereocentres,
  rotatableBonds,
  rotateAroundBond,
  torsionalEnergy,
  findCyclohexane,
  cyclohexaneConformer,
  type RotatableBond,
} from "@/lib/chem-analysis";
import { cn } from "@/lib/utils";

type Tab = "geometric" | "optical" | "conformation";

interface Props {
  molecule: Molecule;
  onClose: () => void;
  initialTab?: Tab;
}

/** True if removing this bond still leaves a path between its endpoints (i.e. it's a ring bond). */
function isRingBond(mol: Molecule, bondIdx: number): boolean {
  const bond = mol.bonds[bondIdx];
  const adj: Record<number, number[]> = {};
  mol.bonds.forEach((b, i) => {
    if (i === bondIdx) return;
    (adj[b.a] ??= []).push(b.b);
    (adj[b.b] ??= []).push(b.a);
  });
  const seen = new Set<number>([bond.a]);
  const queue = [bond.a];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === bond.b) return true;
    for (const n of adj[cur] ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return false;
}

/** Build cis/trans isomers around the first detected acyclic C=C bond. */
function buildGeometricIsomers(mol: Molecule): { cis?: Molecule; trans?: Molecule; reason?: string } {
  const dblIdx = mol.bonds.findIndex(b => b.order === 2 && mol.atoms[b.a].el === "C" && mol.atoms[b.b].el === "C");
  if (dblIdx === -1) return { reason: "No C=C double bond detected." };
  const dbl = mol.bonds[dblIdx];
  if (isRingBond(mol, dblIdx)) {
    return { reason: "C=C is part of a ring — exact 3D stereoisomer generation is not available for ring-bound double bonds in this engine. The Stereo Lab counts above are accurate." };
  }
  // Each carbon must have 2 different substituents (other than the double bond partner) for cis/trans
  const c1 = dbl.a, c2 = dbl.b;
  const subs1 = neighbors(mol, c1).filter(n => n.idx !== c2);
  const subs2 = neighbors(mol, c2).filter(n => n.idx !== c1);
  if (subs1.length < 2 || subs2.length < 2) return { reason: "Each sp² carbon needs 2 substituents." };
  const els1 = subs1.map(n => mol.atoms[n.idx].el);
  const els2 = subs2.map(n => mol.atoms[n.idx].el);
  if (new Set(els1).size < 2 || new Set(els2).size < 2) {
    return { reason: "Both alkene carbons must carry two different substituents." };
  }
  // Build idealized planar molecule: C=C along x, substituents in plane
  const make = (mode: "cis" | "trans"): Molecule => {
    // pick "heavy" sub on each carbon (non-H) and "light" (H or lighter)
    const heavy = (els: string[], idxs: typeof subs1) => {
      const heavyIdx = idxs.findIndex(n => mol.atoms[n.idx].el !== "H");
      if (heavyIdx === -1) return { heavy: idxs[0], light: idxs[1] };
      const lightIdx = idxs.findIndex(n => mol.atoms[n.idx].el === "H");
      return { heavy: idxs[heavyIdx], light: idxs[lightIdx === -1 ? 1 - heavyIdx : lightIdx] };
    };
    const h1 = heavy(els1, subs1);
    const h2 = heavy(els2, subs2);
    const atoms: Atom[] = [
      { el: "C", pos: [-0.67, 0, 0] },
      { el: "C", pos: [0.67, 0, 0] },
      // C1 substituents
      { el: mol.atoms[h1.heavy.idx].el, pos: [-1.3, 0.92, 0] },          // up-left
      { el: mol.atoms[h1.light.idx].el, pos: [-1.3, -0.92, 0] },         // down-left
      // C2 substituents — cis = heavy on same side (up), trans = opposite
      { el: mol.atoms[h2.heavy.idx].el, pos: [1.3, mode === "cis" ? 0.92 : -0.92, 0] },
      { el: mol.atoms[h2.light.idx].el, pos: [1.3, mode === "cis" ? -0.92 : 0.92, 0] },
    ];
    const bonds = [
      { a: 0, b: 1, order: 2 as const },
      { a: 0, b: 2, order: 1 as const },
      { a: 0, b: 3, order: 1 as const },
      { a: 1, b: 4, order: 1 as const },
      { a: 1, b: 5, order: 1 as const },
    ];
    return {
      id: `${mol.id}-${mode}`,
      name: `${mode}-${mol.name}`,
      formula: mol.formula,
      group: "Geometrical isomer",
      description: `${mode === "cis" ? "Cis" : "Trans"} isomer — substituents on ${mode === "cis" ? "same" : "opposite"} side of C=C.`,
      atoms, bonds,
    };
  };
  return { cis: make("cis"), trans: make("trans") };
}

/** Mirror molecule across the YZ plane (x → -x). */
function buildEnantiomer(mol: Molecule): Molecule {
  return {
    ...mol,
    id: `${mol.id}-mirror`,
    name: `${mol.name} (mirror)`,
    group: "Enantiomer",
    description: "Non-superimposable mirror image — opposite stereochemistry.",
    atoms: mol.atoms.map(a => ({ ...a, pos: [-a.pos[0], a.pos[1], a.pos[2]] })),
  };
}

type RingForm = "chair" | "boat" | "twist-boat" | "half-chair";

function MiniViewer({
  mol,
  mirrorPlane = false,
  syncRotationY,
}: {
  mol: Molecule;
  mirrorPlane?: boolean;
  /** When provided, disables orbit rotation and rotates the molecule group by this Y angle (rad). */
  syncRotationY?: number;
}) {
  const synced = syncRotationY !== undefined;
  return (
    <Canvas camera={{ position: [0, 0, 7], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <color attach="background" args={["#05060d"]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={1.1} />
      <pointLight position={[-5, -3, 4]} intensity={0.5} color="#7af6ff" />
      <Suspense fallback={null}>
        <group rotation={[0, syncRotationY ?? 0, 0]}>
          <Molecule3D
            molecule={mol}
            spaceFilling={false}
            autoRotate={!synced}
            selected={null}
            onSelect={() => {}}
          />
        </group>
        {mirrorPlane && (
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[5, 5]} />
            <meshBasicMaterial color="#7af6ff" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
        <Environment preset="city" />
      </Suspense>
      <OrbitControls
        enableDamping dampingFactor={0.08}
        minDistance={3} maxDistance={14}
        enableRotate={!synced}
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        makeDefault
      />
    </Canvas>
  );
}

export default function IsomerismLab({ molecule, onClose, initialTab = "geometric" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dihedral, setDihedral] = useState(60);
  const [bondIdx, setBondIdx] = useState(0);
  const [ringForm, setRingForm] = useState<RingForm>("chair");
  const [confMode, setConfMode] = useState<"bond" | "ring">("bond");
  const [compare, setCompare] = useState(false);
  const [syncRot, setSyncRot] = useState(0);

  const geom = useMemo(() => buildGeometricIsomers(molecule), [molecule]);
  const stereo = useMemo(() => stereocentres(molecule), [molecule]);
  const enant = useMemo(() => buildEnantiomer(molecule), [molecule]);

  const rotBonds = useMemo(() => rotatableBonds(molecule), [molecule]);
  const cyclohex = useMemo(() => findCyclohexane(molecule), [molecule]);
  const safeBondIdx = Math.min(bondIdx, Math.max(0, rotBonds.length - 1));
  const activeBond: RotatableBond | undefined = rotBonds[safeBondIdx];
  const rotated = useMemo(
    () => activeBond ? rotateAroundBond(molecule, activeBond, dihedral) : molecule,
    [molecule, activeBond, dihedral]
  );
  const energyInfo = useMemo(
    () => activeBond ? torsionalEnergy(rotated, activeBond) : null,
    [rotated, activeBond]
  );
  const ringMol = useMemo(() => cyclohex ? cyclohexaneConformer(ringForm) : null, [cyclohex, ringForm]);

  // Default to ring mode if molecule has cyclohexane and no good rotatable bonds
  useEffect(() => {
    if (cyclohex && rotBonds.length === 0) setConfMode("ring");
    else if (!cyclohex) setConfMode("bond");
  }, [cyclohex, rotBonds.length]);

  // Reset bond index / dihedral when molecule changes
  useEffect(() => {
    setBondIdx(0);
    setDihedral(60);
  }, [molecule.id]);

  const hasConformation = rotBonds.length > 0 || !!cyclohex;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass relative w-full max-w-5xl h-[92vh] sm:h-[88vh] rounded-2xl border border-white/10 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">Isomerism Lab</div>
              <div className="text-sm font-semibold">{molecule.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100 p-2">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 sm:px-5 py-2 border-b border-white/5 overflow-x-auto">
          <div className="flex gap-1 flex-1">
          {([
            ["geometric", "Geometrical (cis/trans)"],
            ["optical", "Optical (enantiomer)"],
            ["conformation", "Conformation"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "text-[11px] sm:text-xs px-3 py-1.5 rounded-lg whitespace-nowrap transition",
                tab === k
                  ? "bg-[hsl(var(--neon-cyan))]/15 border border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                  : "border border-white/10 text-foreground/70 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
          </div>
          {tab !== "conformation" && (
            <button
              onClick={() => setCompare(v => !v)}
              className={cn(
                "text-[10px] sm:text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap transition flex items-center gap-1.5 border",
                compare
                  ? "bg-[hsl(var(--neon-cyan))]/15 border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                  : "border-white/10 text-foreground/70 hover:text-foreground"
              )}
              title="Synchronize rotation across both viewers"
            >
              {compare ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
              Compare
            </button>
          )}
        </div>

        {compare && tab !== "conformation" && (
          <div className="px-4 sm:px-6 py-2 border-b border-white/5 flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-widest text-foreground/50 whitespace-nowrap">Sync rotate</span>
            <input
              type="range" min={0} max={360} step={1}
              value={(syncRot * 180 / Math.PI) | 0}
              onChange={(e) => setSyncRot((+e.target.value * Math.PI) / 180)}
              className="flex-1 accent-[hsl(var(--neon-cyan))]"
            />
            <span className="text-[10px] font-mono text-foreground/60 w-10 text-right">{((syncRot * 180 / Math.PI) | 0)}°</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5">
          {tab === "geometric" && (
            geom.reason ? (
              <div className="text-center text-sm text-foreground/60 mt-12 px-6 leading-relaxed">
                {geom.reason}
                <div className="mt-2 text-xs text-foreground/40">Try a molecule like 2-butene, but-2-ene, or any disubstituted alkene.</div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-full">
                {[geom.cis!, geom.trans!].map((m) => (
                  <div key={m.id} className="rounded-xl overflow-hidden border border-white/10 bg-black/40 flex flex-col">
                    <div className="px-3 py-2 border-b border-white/10">
                      <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">{m.group}</div>
                      <div className="font-semibold">{m.name}</div>
                    </div>
                    <div className="flex-1 min-h-[260px]"><MiniViewer mol={m} syncRotationY={compare ? syncRot : undefined} /></div>
                    <div className="px-3 py-2 text-[11px] text-foreground/70">{m.description}</div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "optical" && (
            <div>
              <div className="text-xs text-foreground/70 mb-3">
                {stereo.length === 0
                  ? "No stereocentres detected — molecule is achiral. Mirror image shown for comparison."
                  : `${stereo.length} stereocentre${stereo.length > 1 ? "s" : ""} detected. Mirror image shown across the symmetry plane.`}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-[calc(100%-3rem)]">
                {[molecule, enant].map((m, i) => (
                  <div key={m.id} className="rounded-xl overflow-hidden border border-white/10 bg-black/40 flex flex-col">
                    <div className="px-3 py-2 border-b border-white/10">
                      <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">
                        {i === 0 ? "Original" : "Enantiomer"}
                      </div>
                      <div className="font-semibold">{m.name}</div>
                    </div>
                    <div className="flex-1 min-h-[260px]">
                      <MiniViewer mol={m} mirrorPlane={i === 1} syncRotationY={compare ? syncRot : undefined} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "conformation" && (
            <div className="flex flex-col h-full">
              {!hasConformation ? (
                <div className="text-center text-sm text-foreground/60 mt-12 px-6 leading-relaxed">
                  Conformational isomerism is not significant for <span className="text-foreground">{molecule.name}</span>.
                  <div className="mt-2 text-xs text-foreground/40">
                    The molecule has no freely rotatable σ bonds (bonds are terminal, multiple, or locked in a rigid/aromatic ring).
                    Try a flexible alkane (butane, pentane), an alcohol, or cyclohexane.
                  </div>
                </div>
              ) : (
                <>
                  {/* Mode toggle when both options exist */}
                  {cyclohex && rotBonds.length > 0 && (
                    <div className="flex gap-1 mb-2">
                      {(["bond", "ring"] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setConfMode(m)}
                          className={cn(
                            "text-[10px] sm:text-[11px] px-2.5 py-1 rounded-md border transition",
                            confMode === m
                              ? "bg-[hsl(var(--neon-cyan))]/15 border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                              : "border-white/10 text-foreground/60 hover:text-foreground"
                          )}
                        >
                          {m === "bond" ? "Bond rotation" : "Ring conformers"}
                        </button>
                      ))}
                    </div>
                  )}

                  {confMode === "bond" && activeBond && (
                    <>
                      <div className="text-xs text-foreground/70 mb-2">
                        Rotating <span className="text-foreground font-medium">{activeBond.label}</span> in {molecule.name}.
                        Staggered/anti = low energy; eclipsed = high (torsional strain).
                      </div>

                      {rotBonds.length > 1 && (
                        <div className="mb-2 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] uppercase tracking-widest text-foreground/50">Bond</span>
                          {rotBonds.map((rb, i) => (
                            <button
                              key={i}
                              onClick={() => { setBondIdx(i); setDihedral(60); }}
                              className={cn(
                                "text-[10px] px-2 py-1 rounded border transition",
                                i === safeBondIdx
                                  ? "bg-[hsl(var(--neon-cyan))]/15 border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                                  : "border-white/10 text-foreground/60 hover:text-foreground"
                              )}
                            >
                              {rb.label}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex-1 min-h-[260px] rounded-xl overflow-hidden border border-white/10 bg-black/40 mb-3">
                        <MiniViewer mol={rotated} />
                      </div>
                      <div className="px-1">
                        <div className="flex justify-between text-[10px] text-foreground/60 mb-1">
                          <span>Rotation: {dihedral}°</span>
                          <span className="text-foreground/80">{energyInfo?.label}</span>
                        </div>
                        <input
                          type="range" min={0} max={360} step={1}
                          value={dihedral}
                          onChange={(e) => setDihedral(+e.target.value)}
                          className="w-full accent-[hsl(var(--neon-cyan))]"
                        />
                        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${(energyInfo?.score ?? 0) * 100}%`,
                              background: `linear-gradient(90deg, hsl(var(--neon-cyan)), #ff6bf2)`,
                            }}
                          />
                        </div>
                        <div className="text-[10px] text-foreground/50 mt-1">
                          Relative torsional energy · principal dihedral {energyInfo?.primaryDihedral.toFixed(0)}°
                        </div>
                      </div>
                    </>
                  )}

                  {confMode === "ring" && ringMol && (
                    <>
                      <div className="text-xs text-foreground/70 mb-2">
                        6-membered carbocyclic ring detected. Compare canonical cyclohexane conformations.
                      </div>
                      <div className="mb-2 flex items-center gap-1.5 flex-wrap">
                        {(["chair", "twist-boat", "boat", "half-chair"] as RingForm[]).map(f => (
                          <button
                            key={f}
                            onClick={() => setRingForm(f)}
                            className={cn(
                              "text-[10px] px-2.5 py-1 rounded border transition capitalize",
                              ringForm === f
                                ? "bg-[hsl(var(--neon-cyan))]/15 border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                                : "border-white/10 text-foreground/60 hover:text-foreground"
                            )}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                      <div className="flex-1 min-h-[260px] rounded-xl overflow-hidden border border-white/10 bg-black/40 mb-3">
                        <MiniViewer mol={ringMol} />
                      </div>
                      <div className="px-1 text-[11px] text-foreground/70">
                        {ringForm === "chair" && "Chair — all bonds staggered, lowest energy (~0 kJ/mol)."}
                        {ringForm === "twist-boat" && "Twist-boat — partial relief from eclipsing (~23 kJ/mol)."}
                        {ringForm === "boat" && "Boat — flagpole H repulsion + eclipsing (~29 kJ/mol)."}
                        {ringForm === "half-chair" && "Half-chair — transition state between chair and twist-boat (~45 kJ/mol)."}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}