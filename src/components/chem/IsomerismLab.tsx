import { useEffect, useMemo, useState, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { TOUCH } from "three";
import * as THREE from "three";
import { X, FlaskConical, Link2, Link2Off, Info } from "lucide-react";
import { type Molecule, type Atom, ELEMENT_DATA } from "@/data/molecules";
import Molecule3D from "./Molecule3D";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { analyzeStereochemistry, type StereoAnalysis } from "@/lib/stereochemistryEngine";
import { cn } from "@/lib/utils";

type Tab = "geometric" | "optical" | "conformation";

interface Props {
  molecule: Molecule;
  onClose: () => void;
  initialTab?: Tab;
  analysis?: StereoAnalysis;
  /** Authoritative stereo report from the RDKit engine (preferred over local heuristics). */
  stereoCenters?: number;
  isMeso?: boolean;
  classification?: "achiral" | "chiral-single" | "chiral-multi" | "meso";
  /** Engine's geometric isomer count (for cross-module consistency with Stereo Lab). */
  engineGeometricCount?: number;
  /** Engine's count of stereogenic C=C sites. */
  engineGeomSites?: number;
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
function buildGeometricIsomers(mol: Molecule, analysis: StereoAnalysis): { cis?: Molecule; trans?: Molecule; reason?: string; ringConstrained?: boolean } {
  const site = analysis.geometricSites.find((s) => s.renderable) ?? analysis.geometricSites[0];
  const dblIdx = site?.bondIndex ?? mol.bonds.findIndex(b => b.order === 2 && mol.atoms[b.a].el === "C" && mol.atoms[b.b].el === "C");
  if (dblIdx === -1) {
    return { reason: "Geometrical (cis–trans / E–Z) isomerism requires a restricted rotation, typically an acyclic C=C double bond whose sp² carbons each carry two different substituents. This molecule has no such bond." };
  }
  const dbl = mol.bonds[dblIdx];
  if (site?.ringConstrained || isRingBond(mol, dblIdx)) {
    return { reason: "The C=C double bond itself is part of a ring. Ring-constrained geometric isomers exist in principle, but exact 3D enumeration is not available in this viewer — the Stereo Lab counts above remain accurate.", ringConstrained: true };
  }
  const c1 = dbl.a, c2 = dbl.b;
  const subs1 = neighbors(mol, c1).filter(n => n.idx !== c2);
  const subs2 = neighbors(mol, c2).filter(n => n.idx !== c1);
  if (subs1.length < 2 || subs2.length < 2) {
    return { reason: "Each sp² carbon of the C=C bond must carry two substituents to define a geometry — this alkene is terminal." };
  }
  const els1 = subs1.map(n => mol.atoms[n.idx].el);
  const els2 = subs2.map(n => mol.atoms[n.idx].el);
  if (new Set(els1).size < 2 || new Set(els2).size < 2) {
    return { reason: "Both alkene carbons must carry two different substituents to produce distinct cis/trans (E/Z) isomers. At least one carbon has identical groups." };
  }
  const make = (mode: "cis" | "trans"): Molecule => {
    const pick = (idxs: typeof subs1, ligands = site?.ligandsA) => {
      const priority = ligands?.find(l => l.atomIndex !== null)?.atomIndex;
      const high = idxs.find(n => n.idx === priority) ?? idxs.find(n => mol.atoms[n.idx].el !== "H") ?? idxs[0];
      const low = idxs.find(n => n.idx !== high.idx) ?? high;
      return { high, low };
    };
    const h1 = pick(subs1, site?.ligandsA);
    const h2 = pick(subs2, site?.ligandsB);
    const atoms: Atom[] = mol.atoms.map((atom) => ({ ...atom, pos: [...atom.pos] as [number, number, number] }));
    atoms[c1].pos = [-0.67, 0, 0];
    atoms[c2].pos = [0.67, 0, 0];

    const branchAtoms = (root: number, blocked: number) => {
      const seen = new Set<number>([blocked]);
      const out: number[] = [];
      const queue = [root];
      while (queue.length) {
        const cur = queue.shift()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        out.push(cur);
        for (const n of neighbors(mol, cur)) if (!seen.has(n.idx)) queue.push(n.idx);
      }
      return out;
    };
    const placeBranch = (root: number, center: number, target: [number, number, number]) => {
      const sourceCenter = new THREE.Vector3(...mol.atoms[center].pos);
      const sourceRoot = new THREE.Vector3(...mol.atoms[root].pos);
      const targetCenter = new THREE.Vector3(...atoms[center].pos);
      const targetRoot = new THREE.Vector3(...target);
      const from = sourceRoot.clone().sub(sourceCenter);
      const to = targetRoot.clone().sub(targetCenter);
      if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return;
      const scale = to.length() / from.length();
      const quat = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
      for (const idx of branchAtoms(root, center)) {
        const p = new THREE.Vector3(...mol.atoms[idx].pos).sub(sourceCenter).multiplyScalar(scale).applyQuaternion(quat).add(targetCenter);
        atoms[idx].pos = [p.x, p.y, p.z];
      }
    };
    placeBranch(h1.high.idx, c1, [-1.3, 0.92, 0]);
    placeBranch(h1.low.idx, c1, [-1.3, -0.92, 0]);
    placeBranch(h2.high.idx, c2, [1.3, mode === "cis" ? 0.92 : -0.92, 0]);
    placeBranch(h2.low.idx, c2, [1.3, mode === "cis" ? -0.92 : 0.92, 0]);
    return {
      id: `${mol.id}-${mode}`,
      name: `${mode}-${mol.name}`,
      formula: mol.formula,
      group: "Geometrical isomer",
      description: mode === "cis"
        ? "cis (Z) — higher-priority substituents on the same side of the C=C plane."
        : "trans (E) — higher-priority substituents on opposite sides of the C=C plane.",
      atoms, bonds: mol.bonds.map((bond) => ({ ...bond })),
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
    description: "Non-superimposable mirror image — opposite stereochemistry at every chiral centre.",
    atoms: mol.atoms.map(a => ({ ...a, pos: [-a.pos[0], a.pos[1], a.pos[2]] })),
  };
}

type RingForm = "chair" | "boat" | "twist-boat" | "half-chair";

/** Compute the ideal camera distance to fit the molecule's bounding sphere. */
function moleculeFitDistance(mol: Molecule, fovDeg = 45, paddingFactor = 1.6): number {
  if (mol.atoms.length === 0) return 7;
  const center = new THREE.Vector3();
  mol.atoms.forEach(a => center.add(new THREE.Vector3(...a.pos)));
  center.divideScalar(mol.atoms.length);
  let r = 0;
  mol.atoms.forEach(a => {
    const radius = ELEMENT_DATA[a.el]?.radius ?? 0.3;
    const d = new THREE.Vector3(...a.pos).distanceTo(center) + radius;
    if (d > r) r = d;
  });
  const fov = (fovDeg * Math.PI) / 180;
  const dist = (r * paddingFactor) / Math.sin(fov / 2);
  return Math.max(3.2, Math.min(dist, 22));
}

/** Camera fitter — re-fits whenever the molecule changes. */
function CameraFit({ molecule }: { molecule: Molecule }) {
  const { camera } = useThree();
  useEffect(() => {
    const dist = moleculeFitDistance(molecule);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [molecule.id, camera]);
  return null;
}

function MiniViewer({
  mol,
  syncRotationY,
  highlightStereo = false,
}: {
  mol: Molecule;
  syncRotationY?: number;
  highlightStereo?: boolean;
}) {
  const synced = syncRotationY !== undefined;
  const stereoIdx = useMemo(() => (highlightStereo ? stereocentres(mol) : []), [mol, highlightStereo]);
  const initialDist = useMemo(() => moleculeFitDistance(mol), [mol]);
  return (
    <Canvas key={`${mol.id}-${highlightStereo ? "stereo" : "plain"}`} camera={{ position: [0, 0, initialDist], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      <color attach="background" args={["#05060d"]} />
      <CameraFit molecule={mol} />
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
            stereoIndices={stereoIdx}
          />
        </group>
        <Environment preset="city" />
      </Suspense>
      <OrbitControls
        enableDamping dampingFactor={0.08}
        minDistance={2.5} maxDistance={28}
        enableRotate={!synced}
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        makeDefault
      />
    </Canvas>
  );
}

/** Heuristic R/S labels for single-stereocentre molecules. Falls back to A/B otherwise. */
function enantiomerLabels(centers: number): { a: string; b: string; aSub: string; bSub: string } {
  if (centers === 1) {
    return { a: "Enantiomer A", b: "Enantiomer B", aSub: "(R) configuration", bSub: "(S) configuration" };
  }
  return { a: "Enantiomer A", b: "Enantiomer B", aSub: `${centers} stereocentres`, bSub: "all inverted" };
}

export default function IsomerismLab({ molecule, onClose, initialTab = "geometric", analysis: providedAnalysis, stereoCenters, isMeso, classification, engineGeometricCount, engineGeomSites }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dihedral, setDihedral] = useState(60);
  const [bondIdx, setBondIdx] = useState(0);
  const [ringForm, setRingForm] = useState<RingForm>("chair");
  const [confMode, setConfMode] = useState<"bond" | "ring">("bond");
  const [compare, setCompare] = useState(false);
  const [syncRot, setSyncRot] = useState(0);
  const [mobileSide, setMobileSide] = useState<"a" | "b">("a"); // mobile cis/trans + A/B switcher
  const isMobile = useIsMobile();

  const analysis = useMemo(() => providedAnalysis ?? analyzeStereochemistry(molecule), [molecule, providedAnalysis]);
  const geom = useMemo(() => buildGeometricIsomers(molecule, analysis), [molecule, analysis]);
  const stereo = useMemo(() => analysis.stereocentres, [analysis]);
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

  useEffect(() => {
    if (cyclohex && rotBonds.length === 0) setConfMode("ring");
    else if (!cyclohex) setConfMode("bond");
  }, [cyclohex, rotBonds.length]);

  useEffect(() => {
    setBondIdx(0);
    setDihedral(60);
    setMobileSide("a");
  }, [molecule.id]);

  const hasConformation = rotBonds.length > 0 || !!cyclohex;

  return (
    <div
      className="fixed inset-0 z-[120] bg-background/98 backdrop-blur-2xl flex items-stretch sm:items-center justify-center p-0 sm:p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
          className="glass relative w-full sm:max-w-5xl h-[100dvh] sm:h-[88vh] sm:rounded-2xl border-0 sm:border border-white/10 overflow-hidden flex flex-col bg-background/95"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FlaskConical className="h-4 w-4 text-[hsl(var(--neon-cyan))] shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">Isomerism Lab</div>
              <div className="text-sm font-semibold truncate">{molecule.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 p-2 -mr-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sticky tabs */}
        <div className="sticky top-0 z-10 flex items-center gap-1 px-3 sm:px-5 py-2 border-b border-white/5 bg-background/70 backdrop-blur-md shrink-0 overflow-x-auto">
          <div className="flex gap-1 flex-1">
          {([
            ["geometric", "Geometrical"],
            ["optical", "Optical"],
            ["conformation", "Conformation"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "text-[11px] sm:text-xs px-3 py-2 rounded-lg whitespace-nowrap transition min-h-[40px]",
                tab === k
                  ? "bg-[hsl(var(--neon-cyan))]/15 border border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                  : "border border-white/10 text-foreground/70 hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
          </div>
          {tab !== "conformation" && !isMobile && (
            <button
              onClick={() => setCompare(v => !v)}
              className={cn(
                "text-[11px] px-2.5 py-1.5 rounded-lg whitespace-nowrap transition flex items-center gap-1.5 border",
                compare
                  ? "bg-[hsl(var(--neon-cyan))]/15 border-[hsl(var(--neon-cyan))]/50 text-[hsl(var(--neon-cyan))]"
                  : "border-white/10 text-foreground/70 hover:text-foreground"
              )}
              title="Synchronize rotation across both viewers"
            >
              {compare ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
              Sync rotate
            </button>
          )}
        </div>

        {compare && tab !== "conformation" && !isMobile && (
          <div className="px-4 sm:px-6 py-2 border-b border-white/5 flex items-center gap-3 shrink-0">
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 flex flex-col">
          {tab === "geometric" && (() => {
            // Unified consistency: Stereo Lab and Isomerism Lab must agree.
            // If the engine reports 0 geometric isomers, never render isomers
            // regardless of what the local builder produces. If the engine
            // reports >0 but the local 3D builder can't enumerate (e.g. ring
            // alkene), show a consistent fallback that cites the engine count.
            const engineCount = engineGeometricCount;
            const engineSites = engineGeomSites;
            const engineSaysNone = engineCount !== undefined && engineCount === 0;
            const engineSaysSome = engineCount !== undefined && engineCount > 0;
            const builderHasIsomers = !geom.reason && !!geom.cis && !!geom.trans;

            if (engineSaysNone) {
              return (
                <div className="m-auto max-w-md w-full px-2">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                    <Info className="h-5 w-5 mx-auto mb-2 text-[hsl(var(--neon-cyan))]" />
                    <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50 mb-2">No geometrical isomers</div>
                    <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                      {geom.reason ?? `The stereochemistry engine found no stereogenic C=C sites in ${molecule.name}, so no cis/trans (E/Z) isomers exist.`}
                    </p>
                    <div className="mt-3 text-[11px] text-foreground/50">Try 2-butene, stilbene, or 1,2-dichloroethene.</div>
                  </div>
                </div>
              );
            }

            if (engineSaysSome && !builderHasIsomers) {
              return (
                <div className="m-auto max-w-md w-full px-2">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                    <Info className="h-5 w-5 mx-auto mb-2 text-[hsl(var(--neon-cyan))]" />
                    <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50 mb-2">
                      Ring-constrained stereochemistry
                    </div>
                    <div className="text-base font-semibold mb-2">
                      {engineCount} geometrical isomer{engineCount === 1 ? "" : "s"} predicted
                    </div>
                    <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                      The engine detected {engineSites ?? "ring-bound"} stereogenic C=C site{engineSites === 1 ? "" : "s"} that contribute to geometrical isomerism, but full 3D enumeration of ring-constrained stereoisomers is not yet supported in this viewer. The counts shown in the Stereo Lab remain accurate.
                    </p>
                    <div className="mt-3 text-[11px] text-foreground/50">Acyclic alkenes (e.g. 2-butene) render full 3D cis/trans pairs.</div>
                  </div>
                </div>
              );
            }

            return geom.reason ? (
              <div className="m-auto max-w-md w-full px-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                  <Info className="h-5 w-5 mx-auto mb-2 text-[hsl(var(--neon-cyan))]" />
                  <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50 mb-2">No geometrical isomers</div>
                  <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">{geom.reason}</p>
                  <div className="mt-3 text-[11px] text-foreground/50">Try 2-butene, stilbene, or 1,2-dichloroethene.</div>
                </div>
              </div>
            ) : isMobile ? (
              <div className="flex flex-col gap-3 flex-1">
                {/* Mobile tabs */}
                <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                  {([["a", `cis (Z)`], ["b", `trans (E)`]] as const).map(([k, lbl]) => (
                    <button
                      key={k}
                      onClick={() => setMobileSide(k)}
                      className={cn(
                        "flex-1 text-xs py-2 rounded-lg transition font-medium",
                        mobileSide === k
                          ? "bg-[hsl(var(--neon-cyan))]/20 text-[hsl(var(--neon-cyan))]"
                          : "text-foreground/60"
                      )}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {(() => {
                  const m = mobileSide === "a" ? geom.cis! : geom.trans!;
                  return (
                    <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-white/10 bg-black/40">
                      <div className="px-3 py-2 border-b border-white/10">
                        <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">{mobileSide === "a" ? "cis · Z isomer" : "trans · E isomer"}</div>
                        <div className="font-semibold text-sm">{m.name}</div>
                      </div>
                      <div className="flex-1 min-h-[320px]"><MiniViewer mol={m} /></div>
                      <div className="px-3 py-2 text-[11px] text-foreground/70 leading-relaxed border-t border-white/5">
                        {m.description}
                      </div>
                    </div>
                  );
                })()}
                <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-foreground/60">
                  <span className="text-[hsl(var(--neon-cyan))] font-medium">Z/E rule:</span> when the two higher-CIP-priority groups lie on the same side, the alkene is Z (cis); on opposite sides, it is E (trans).
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                {[geom.cis!, geom.trans!].map((m, i) => (
                  <div key={m.id} className="rounded-xl overflow-hidden border border-white/10 bg-black/40 flex flex-col">
                    <div className="px-3 py-2 border-b border-white/10">
                      <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">
                        {i === 0 ? "cis · Z isomer" : "trans · E isomer"}
                      </div>
                      <div className="font-semibold">{m.name}</div>
                    </div>
                    <div className="flex-1 min-h-[280px]"><MiniViewer mol={m} syncRotationY={compare ? syncRot : undefined} /></div>
                    <div className="px-3 py-2 text-[11px] text-foreground/70">{m.description}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {tab === "optical" && (() => {
            const centers = stereoCenters ?? stereo.length;
            const meso = isMeso ?? false;
            const cls = classification ?? (centers === 0 ? "achiral" : "chiral-single");
            const showMirror = centers > 0 && !meso;

            if (!showMirror) {
              const reason = centers === 0
                ? `${molecule.name} contains no stereogenic centres — it is achiral. Its mirror image is superimposable on the original, so no enantiomer exists.`
                : `${molecule.name} has stereocentres but is meso: an internal mirror plane makes the molecule identical to its mirror image. The compound is optically inactive overall.`;
              return (
                <div className="m-auto max-w-md w-full px-2">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                    <Info className="h-5 w-5 mx-auto mb-2 text-[hsl(var(--neon-cyan))]" />
                    <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50 mb-2">No optical isomerism</div>
                    <div className="text-base font-semibold mb-2">
                      {cls === "meso" ? "Meso compound" : "Achiral molecule"}
                    </div>
                    <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">{reason}</p>
                    <div className="mt-3 text-[11px] text-foreground/50">
                      Try a chiral compound: 2-butanol, lactic acid, alanine, or 2-chlorobutane.
                    </div>
                  </div>
                </div>
              );
            }

            const labels = enantiomerLabels(centers);
            const pair = [
              { mol: molecule, label: labels.a, sub: labels.aSub, mirror: false },
              { mol: enant, label: labels.b, sub: labels.bSub, mirror: true },
            ];

            return (
              <div className="flex flex-col flex-1">
                <div className="text-[11px] sm:text-xs text-foreground/70 mb-3 leading-relaxed">
                  <span className="text-[hsl(var(--neon-cyan))] font-medium">{centers} stereocentre{centers > 1 ? "s" : ""}</span> detected.
                  Enantiomers are non-superimposable mirror images that rotate plane-polarized light in opposite directions.
                </div>

                {isMobile ? (
                  <>
                    <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10 mb-3">
                      {(["a", "b"] as const).map((k, i) => (
                        <button
                          key={k}
                          onClick={() => setMobileSide(k)}
                          className={cn(
                            "flex-1 text-xs py-2 rounded-lg transition font-medium",
                            mobileSide === k
                              ? "bg-[hsl(var(--neon-cyan))]/20 text-[hsl(var(--neon-cyan))]"
                              : "text-foreground/60"
                          )}
                        >
                          {pair[i].label}
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const p = pair[mobileSide === "a" ? 0 : 1];
                      return (
                        <div className="flex-1 flex flex-col rounded-xl overflow-hidden border border-white/10 bg-black/40">
                          <div className="px-3 py-2 border-b border-white/10">
                            <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">{p.label}</div>
                            <div className="font-semibold text-sm">{p.sub}</div>
                          </div>
                          <div className="flex-1 min-h-[320px]">
                            <MiniViewer mol={p.mol} highlightStereo />
                          </div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                    {pair.map((p, i) => (
                      <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-black/40 flex flex-col">
                        <div className="px-3 py-2 border-b border-white/10">
                          <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">{p.label}</div>
                          <div className="font-semibold text-sm">{p.sub}</div>
                        </div>
                        <div className="flex-1 min-h-[280px]">
                          <MiniViewer mol={p.mol} syncRotationY={compare ? syncRot : undefined} highlightStereo />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {tab === "conformation" && (
            <div className="flex flex-col flex-1">
              {!hasConformation ? (
                <div className="m-auto max-w-md w-full px-2">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center">
                    <Info className="h-5 w-5 mx-auto mb-2 text-[hsl(var(--neon-cyan))]" />
                    <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50 mb-2">No conformational isomerism</div>
                    <p className="text-xs sm:text-sm text-foreground/80 leading-relaxed">
                      <span className="text-foreground font-medium">{molecule.name}</span> has no freely rotatable σ bonds — every bond is terminal, multiple, or locked in a rigid/aromatic ring.
                    </p>
                    <div className="mt-3 text-[11px] text-foreground/50">Try butane, pentane, ethanol, or cyclohexane.</div>
                  </div>
                </div>
              ) : (
                <>
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
                        Rotating <span className="text-foreground font-medium">{activeBond.label}</span>. Staggered/anti = low energy; eclipsed = high (torsional strain).
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

                      <div className="flex-1 min-h-[300px] rounded-xl overflow-hidden border border-white/10 bg-black/40 mb-3">
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
                      <div className="flex-1 min-h-[300px] rounded-xl overflow-hidden border border-white/10 bg-black/40 mb-3">
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
