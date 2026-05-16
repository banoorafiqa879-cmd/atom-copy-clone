import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { TOUCH } from "three";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Boxes,
  Maximize2,
  Presentation,
  Sparkles,
  Dot,
  RotateCcw,
  Info,
  Wand2,
  Loader2,
  X,
  Pencil,
  Crosshair,
  FlaskConical,
  Atom as AtomIcon,
  BookmarkPlus,
  BookmarkCheck,
  Library as LibraryIcon,
  Microscope,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MOLECULES, type Molecule } from "@/data/molecules";
import { useLibrary } from "@/hooks/useLibrary";
import { toast } from "@/hooks/use-toast";
import Molecule3D from "./Molecule3D";
import ParticleField from "./ParticleField";
import { detectPlanes, detectCentre } from "./Symmetry";
import { iupacToMolecule } from "@/lib/iupac";
import { cn } from "@/lib/utils";
import Builder from "./Builder";
import IsomerismLab from "./IsomerismLab";
import StereoLab from "./StereoLab";
import MobileToolbar from "./MobileToolbar";
import {
  molecularFormula,
  molecularMass,
  dominantHybridization,
  functionalGroups,
  ringCount,
  stereocentres,
  detectAxes,
  geometricIsomerInfo,
  opticalIsomerInfo,
} from "@/lib/chem-analysis";
import { stereochemSummary, stereochemSummaryAsync, type StereoSummary } from "@/lib/stereochem";

interface ViewerProps {
  initialMolecule?: Molecule;
}

export default function Viewer({ initialMolecule }: ViewerProps = {}) {
  const [molecules, setMolecules] = useState<Molecule[]>(() =>
    initialMolecule ? [...MOLECULES, initialMolecule] : MOLECULES,
  );
  const [index, setIndex] = useState(() =>
    initialMolecule ? MOLECULES.length : 0,
  );
  const [autoRotate, setAutoRotate] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return sessionStorage.getItem("atom-forge:auto-rotate") === "1"; } catch { return false; }
  });
  const [rotateSpeed, setRotateSpeed] = useState<number>(() => {
    if (typeof window === "undefined") return 0.4;
    try {
      const v = parseFloat(sessionStorage.getItem("atom-forge:rotate-speed") ?? "0.4");
      return isFinite(v) && v >= 0 ? v : 0.4;
    } catch { return 0.4; }
  });
  useEffect(() => {
    try { sessionStorage.setItem("atom-forge:auto-rotate", autoRotate ? "1" : "0"); } catch { /* ignore */ }
  }, [autoRotate]);
  useEffect(() => {
    try { sessionStorage.setItem("atom-forge:rotate-speed", String(rotateSpeed)); } catch { /* ignore */ }
  }, [rotateSpeed]);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [spaceFilling, setSpaceFilling] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [presentation, setPresentation] = useState(false);
  const [showPOS, setShowPOS] = useState(false);
  const [showCOS, setShowCOS] = useState(false);
  const [planeIdx, setPlaneIdx] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [iupacOpen, setIupacOpen] = useState(false);
  const [iupacName, setIupacName] = useState("");
  const [iupacLoading, setIupacLoading] = useState(false);
  const [iupacError, setIupacError] = useState<string | null>(null);
  const [symOpen, setSymOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [isoOpen, setIsoOpen] = useState(false);
  const [isoTab, setIsoTab] = useState<"geometric" | "optical" | "conformation">("geometric");
  const [infoOpen, setInfoOpen] = useState(false);
  const [axisIdx, setAxisIdx] = useState<number | null>(null);
  const [showStereo, setShowStereo] = useState(false);
  const [stereoLabOpen, setStereoLabOpen] = useState(false);
  const symPanelRef = useRef<HTMLDivElement>(null);
  const symButtonRef = useRef<HTMLButtonElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const idleTimer = useRef<number | null>(null);

  const mol = molecules[index];

  const planes = useMemo(() => detectPlanes(mol), [mol]);
  const hasCOS = useMemo(() => detectCentre(mol), [mol]);
  const activePlane = planes[planeIdx] ?? null;
  const axes = useMemo(() => detectAxes(mol), [mol]);
  const activeAxis = axisIdx !== null ? axes[axisIdx] ?? null : null;
  const stereoIdx = useMemo(() => stereocentres(mol), [mol]);
  const geomInfo = useMemo(() => geometricIsomerInfo(mol), [mol]);
  const optInfo = useMemo(() => opticalIsomerInfo(mol), [mol]);
  const heuristicSummary = useMemo(
    () => stereochemSummary(mol, planes.length),
    [mol, planes.length],
  );
  const [stereoSummary, setStereoSummary] = useState<StereoSummary>(heuristicSummary);
  useEffect(() => {
    setStereoSummary(heuristicSummary);
    let cancelled = false;
    stereochemSummaryAsync(mol)
      .then((real) => { if (!cancelled) setStereoSummary(real); })
      .catch(() => { /* keep heuristic fallback */ });
    return () => { cancelled = true; };
  }, [mol, heuristicSummary]);
  const info = useMemo(() => ({
    formula: molecularFormula(mol),
    mass: molecularMass(mol),
    hybrid: dominantHybridization(mol),
    groups: functionalGroups(mol),
    rings: ringCount(mol),
    atoms: mol.atoms.length,
    bonds: mol.bonds.length,
    stereo: stereoIdx.length,
  }), [mol, stereoIdx]);

  // Compound library (saved structures)
  const { save: saveCompound, isSaved } = useLibrary();
  const alreadySaved = isSaved(mol.name, info.formula);
  const handleSaveToLibrary = async () => {
    const result = await saveCompound({
      moleculeName: mol.name,
      formula: info.formula,
      structureData: mol,
    });
    if (result.ok) {
      toast({ title: "Compound saved successfully", description: `${mol.name} added to your library.` });
    } else if (result.reason === "duplicate") {
      toast({ title: "Already in your library", description: `${mol.name} is already saved.` });
    } else {
      toast({ title: "Could not save compound", description: result.message, variant: "destructive" });
    }
  };

  // reset symmetry overlays when molecule changes
  useEffect(() => {
    setShowPOS(false);
    setShowCOS(false);
    setPlaneIdx(0);
    setAxisIdx(null);
    setShowStereo(false);
    setStereoLabOpen(false);
  }, [index]);

  // Persist "user is in the explorer" so navigating back from /library
  // returns to the viewer (not the intro). Cleared via session lifetime.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem("atom-forge:in-explorer", "1");
    } catch {
      /* storage disabled — degrade silently */
    }
  }, []);

  // Auto-collapse Symmetry Lab when interacting with molecule
  const scheduleCollapse = () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setSymOpen(false), 2500);
  };

  // Click outside to collapse
  useEffect(() => {
    if (!symOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (symPanelRef.current?.contains(t)) return;
      if (symButtonRef.current?.contains(t)) return;
      setSymOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [symOpen]);

  // click outside for info panel
  useEffect(() => {
    if (!infoOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (infoPanelRef.current?.contains(t)) return;
      if (infoButtonRef.current?.contains(t)) return;
      setInfoOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [infoOpen]);

  const next = () => {
    setSelected(null);
    setIndex((i) => (i + 1) % molecules.length);
  };
  const prev = () => {
    setSelected(null);
    setIndex((i) => (i - 1 + molecules.length) % molecules.length);
  };

  const handleGenerate = async () => {
    setIupacError(null);
    setIupacLoading(true);
    try {
      const newMol = await iupacToMolecule(iupacName);
      setMolecules((prev) => {
        const next = [...prev, newMol];
        setIndex(next.length - 1);
        return next;
      });
      setSelected(null);
      setResetKey((k) => k + 1);
      setIupacOpen(false);
      setIupacName("");
    } catch (e: unknown) {
      setIupacError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIupacLoading(false);
    }
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") setAutoRotate((v) => !v);
      else if (e.key.toLowerCase() === "p") setPresentation((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Presentation auto-advance
  useEffect(() => {
    if (!presentation) return;
    const t = setInterval(next, 6000);
    return () => clearInterval(t);
  }, [presentation, molecules.length]);

  const fullScreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background touch-none">
      {/* Background grid + glow */}
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "var(--gradient-glow)" }}
      />

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, 7], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onPointerDown={scheduleCollapse}
      >
        <color attach="background" args={["#05060d"]} />
        <fog attach="fog" args={["#05060d", 12, 28]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <pointLight position={[-5, -3, 4]} intensity={0.6} color="#7af6ff" />
        <pointLight position={[5, 4, -3]} intensity={0.6} color="#c77bff" />

        <Suspense fallback={null}>
          <ParticleField />
          <Molecule3D
            key={resetKey}
            molecule={mol}
            spaceFilling={spaceFilling}
            autoRotate={autoRotate}
            rotateSpeed={rotateSpeed}
            selected={selected}
            onSelect={setSelected}
            showPOS={showPOS}
            activePlane={activePlane}
            showCOS={showCOS}
            hasCOS={hasCOS}
            activeAxis={activeAxis}
            stereoIndices={showStereo ? stereoIdx : []}
          />
          <Environment preset="city" />
        </Suspense>

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          minDistance={3}
          maxDistance={18}
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.85}
          zoomSpeed={0.75}
          panSpeed={0.6}
          touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
          makeDefault
        />
      </Canvas>

      {/* Top progress bars */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10 px-4">
        {molecules.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 w-8 rounded-full transition-all",
              i === index ? "bg-white w-12" : "bg-white/25"
            )}
          />
        ))}
      </div>

      {/* Top-center header */}
      {!presentation && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 animate-fade-in">
          <h1 className="text-xs sm:text-sm font-medium tracking-[0.25em] text-foreground/50 uppercase whitespace-nowrap">
            Interactive Molecular Structure Explorer
          </h1>
        </div>
      )}

      {/* Top-right controls — desktop: wrapped grid; mobile: horizontal scroll strip */}
      {!presentation && (
        <>
          {/* Desktop toolbar */}
          <div className="hidden sm:flex absolute top-6 right-6 z-10 flex-wrap justify-end gap-2 animate-fade-in">
            <button
              onClick={() => setIupacOpen((v) => !v)}
              className={cn(
                "glass h-10 px-3 rounded-xl flex items-center gap-2 hover:scale-105 transition text-xs font-semibold",
                iupacOpen && "neon-glow"
              )}
              title="Generate from IUPAC name"
            >
              <Wand2 className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> IUPAC
            </button>
            <button onClick={() => setBuilderOpen(true)} className="glass h-10 px-3 rounded-xl flex items-center gap-2 hover:scale-105 transition text-xs font-semibold" title="Open Molecule Builder">
              <Pencil className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> Build
            </button>
            <button onClick={() => { setIsoTab("geometric"); setIsoOpen(true); }} className="glass h-10 px-3 rounded-xl flex items-center gap-2 hover:scale-105 transition text-xs font-semibold" title="Isomerism Lab">
              <FlaskConical className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> Isomers
            </button>
            <button
              data-stereolab-launcher
              onClick={() => setStereoLabOpen((v) => !v)}
              className={cn("glass h-10 px-3 rounded-xl flex items-center gap-2 hover:scale-105 transition text-xs font-semibold", stereoLabOpen && "neon-glow")}
              title="Stereochemistry Lab"
            >
              <Microscope className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> Stereo
            </button>
            <button
              onClick={handleSaveToLibrary}
              className={cn("glass h-10 px-3 rounded-xl flex items-center gap-2 hover:scale-105 transition text-xs font-semibold", alreadySaved && "neon-glow")}
              title={alreadySaved ? "Already in your library" : "Add to Library"}
              aria-pressed={alreadySaved}
            >
              {alreadySaved ? <BookmarkCheck className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> : <BookmarkPlus className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />}
              {alreadySaved ? "Saved" : "Save"}
            </button>
            <Link to="/library" className="glass h-10 px-3 rounded-xl flex items-center gap-2 hover:scale-105 transition text-xs font-semibold" title="Open My Library">
              <LibraryIcon className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> Library
            </Link>
            <div className="relative">
              <button
                onClick={() => setAutoRotate((v) => !v)}
                onContextMenu={(e) => { e.preventDefault(); setSpeedOpen((v) => !v); }}
                className={cn(
                  "glass h-10 px-3 rounded-xl flex items-center gap-1.5 hover:scale-105 transition text-[11px] font-semibold",
                  autoRotate && "neon-glow",
                )}
                title={autoRotate ? "Auto-rotate ON (right-click for speed)" : "Auto-rotate OFF"}
                aria-pressed={autoRotate}
              >
                {autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{autoRotate ? "ON" : "OFF"}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setSpeedOpen((v) => !v); }}
                  className="ml-0.5 opacity-60 hover:opacity-100 text-[9px]"
                  aria-label="Rotation speed"
                  type="button"
                >
                  ▾
                </button>
              </button>
              {speedOpen && (
                <div className="absolute top-[calc(100%+8px)] right-0 glass rounded-xl border border-white/10 p-3 w-56 z-30 animate-fade-in">
                  <div className="text-[10px] uppercase tracking-widest text-foreground/50 mb-1.5 flex items-center justify-between">
                    <span>Rotation speed</span>
                    <span className="font-mono text-foreground/70">{rotateSpeed.toFixed(1)}×</span>
                  </div>
                  <input
                    type="range" min={0.1} max={2} step={0.1}
                    value={rotateSpeed}
                    onChange={(e) => setRotateSpeed(parseFloat(e.target.value))}
                    className="w-full accent-[hsl(var(--neon-cyan))]"
                  />
                  <div className="flex justify-between text-[9px] text-foreground/40 mt-1">
                    <span>Slow</span><span>Fast</span>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => setSpaceFilling((v) => !v)} className={cn("glass h-10 w-10 rounded-xl flex items-center justify-center hover:scale-105 transition", spaceFilling && "neon-glow")} title="Space-filling model">
              <Boxes className="h-4 w-4" />
            </button>
            <button onClick={() => setResetKey((k) => k + 1)} className="glass h-10 w-10 rounded-xl flex items-center justify-center hover:scale-105 transition" title="Fit Molecule">
              <Crosshair className="h-4 w-4" />
            </button>
            <button onClick={() => setPresentation(true)} className="glass h-10 w-10 rounded-xl flex items-center justify-center hover:scale-105 transition" title="Presentation mode">
              <Presentation className="h-4 w-4" />
            </button>
            <button onClick={fullScreen} className="glass h-10 w-10 rounded-xl flex items-center justify-center hover:scale-105 transition" title="Fullscreen">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile command strip — primary actions inline + overflow menu */}
          <MobileToolbar
            iupacOpen={iupacOpen}
            stereoLabOpen={stereoLabOpen}
            alreadySaved={alreadySaved}
            autoRotate={autoRotate}
            spaceFilling={spaceFilling}
            onIUPAC={() => setIupacOpen((v) => !v)}
            onBuild={() => setBuilderOpen(true)}
            onIsomers={() => { setIsoTab("geometric"); setIsoOpen(true); }}
            onStereo={() => setStereoLabOpen((v) => !v)}
            onSave={handleSaveToLibrary}
            onAutoRotate={() => setAutoRotate((v) => !v)}
            onSpaceFill={() => setSpaceFilling((v) => !v)}
            onFit={() => setResetKey((k) => k + 1)}
            onPresentation={() => setPresentation(true)}
            onFullscreen={fullScreen}
          />
        </>
      )}

      {/* Side nav buttons */}
      <button
        onClick={prev}
        className="absolute left-4 top-1/2 -translate-y-1/2 glass h-12 w-12 rounded-full flex items-center justify-center hover:scale-110 transition z-10"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={next}
        className="absolute right-4 top-1/2 -translate-y-1/2 glass h-12 w-12 rounded-full flex items-center justify-center hover:scale-110 transition z-10"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* Compact name card (left) */}
      {!presentation && (
        <div
          key={mol.id}
          className="absolute left-3 sm:left-6 bottom-32 md:bottom-28 z-10 max-w-[78vw] sm:max-w-sm glass rounded-2xl p-3 sm:p-4 animate-fade-in"
        >
          <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">
            {mol.group}
          </div>
          <h2 className="mt-0.5 text-xl sm:text-2xl font-bold neon-text leading-tight">{mol.name}</h2>
          <div className="mt-0.5 text-sm font-mono text-foreground/80">{info.formula}</div>
          <button
            ref={infoButtonRef}
            onClick={() => setInfoOpen((v) => !v)}
            className="mt-2 inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] text-foreground/60 hover:text-foreground transition"
          >
            <AtomIcon className="h-3 w-3" />
            {infoOpen ? "Hide details" : "Smart info"}
          </button>
        </div>
      )}

      {/* Smart Info Panel (collapsible) */}
      {!presentation && infoOpen && (
        <div
          ref={infoPanelRef}
          className="absolute left-3 sm:left-6 bottom-56 md:bottom-52 z-30 max-w-[80vw] sm:max-w-sm w-[300px] glass rounded-2xl p-4 animate-scale-in border border-white/10"
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))] mb-2 flex items-center gap-1">
            <AtomIcon className="h-3 w-3" /> Molecule Profile
          </div>
          <p className="text-[11px] text-foreground/70 leading-relaxed mb-3">{mol.description}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
            <dt className="text-foreground/50">Formula</dt><dd className="font-mono text-foreground/90">{info.formula}</dd>
            <dt className="text-foreground/50">Mass</dt><dd className="font-mono">{info.mass.toFixed(2)} g/mol</dd>
            <dt className="text-foreground/50">Hybridization</dt><dd>{info.hybrid}</dd>
            <dt className="text-foreground/50">Atoms</dt><dd>{info.atoms}</dd>
            <dt className="text-foreground/50">Bonds</dt><dd>{info.bonds}</dd>
            <dt className="text-foreground/50">Rings</dt><dd>{info.rings}</dd>
            <dt className="text-foreground/50">Stereocentres</dt><dd>{info.stereo}</dd>
          </dl>
          {info.groups.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-widest text-foreground/50 mb-1">Functional groups</div>
              <div className="flex flex-wrap gap-1">
                {info.groups.map((g) => (
                  <span key={g} className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--neon-cyan))]/10 border border-[hsl(var(--neon-cyan))]/30 text-[hsl(var(--neon-cyan))]">
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Symmetry Lab (collapsible) */}
      {!presentation && (
        <>
          <button
            ref={symButtonRef}
            onClick={() => setSymOpen((v) => !v)}
            className={cn(
              "absolute right-6 bottom-32 md:bottom-28 z-20 glass rounded-full px-4 h-11 flex items-center gap-2 hover:scale-105 transition",
              symOpen && "neon-glow",
            )}
            title="Symmetry Lab"
          >
            <Sparkles className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span className="text-xs font-semibold tracking-wide">Symmetry Lab</span>
          </button>
        </>
      )}

      {!presentation && symOpen && (
        <div
          ref={symPanelRef}
          className="absolute right-6 bottom-48 md:bottom-44 z-30 w-[260px] glass rounded-2xl p-4 animate-scale-in border border-[hsl(var(--neon-cyan))]/20 shadow-[0_0_40px_hsl(var(--neon-cyan)/0.2)]"
        >
          <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))] mb-3 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Symmetry Lab
          </div>

          {/* POS toggle */}
          <button
            disabled={planes.length === 0}
            onClick={() => setShowPOS((v) => !v)}
            title="A plane that divides the molecule into two mirror halves."
            className={cn(
              "w-full text-left rounded-xl px-3 py-2 mb-2 transition flex items-center justify-between",
              "border border-white/10 hover:border-[hsl(var(--neon-cyan))]/60",
              showPOS && "neon-glow border-[hsl(var(--neon-cyan))]/80",
              planes.length === 0 && "opacity-40 cursor-not-allowed"
            )}
          >
            <div>
              <div className="text-xs font-semibold">Plane of Symmetry</div>
              <div className="text-[10px] text-foreground/50">
                {planes.length === 0
                  ? "Not present in this molecule"
                  : `${planes.length} plane${planes.length > 1 ? "s" : ""} found`}
              </div>
            </div>
            <div
              className={cn(
                "h-4 w-7 rounded-full transition",
                showPOS ? "bg-[hsl(var(--neon-cyan))]" : "bg-white/15"
              )}
            >
              <div
                className={cn(
                  "h-4 w-4 rounded-full bg-white transition",
                  showPOS && "translate-x-3"
                )}
              />
            </div>
          </button>

          {/* Plane selector */}
          {showPOS && planes.length > 1 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {planes.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setPlaneIdx(i)}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded-md border border-white/10 hover:border-white/30 transition",
                    i === planeIdx && "bg-[hsl(var(--neon-cyan))]/20 border-[hsl(var(--neon-cyan))]/60"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* COS toggle */}
          <button
            disabled={!hasCOS}
            onClick={() => setShowCOS((v) => !v)}
            title="A central point through which every atom has an identical partner on the opposite side."
            className={cn(
              "w-full text-left rounded-xl px-3 py-2 mb-2 transition flex items-center justify-between",
              "border border-white/10 hover:border-[#ff6bf2]/60",
              showCOS && "border-[#ff6bf2]/80",
              !hasCOS && "opacity-40 cursor-not-allowed"
            )}
            style={showCOS ? { boxShadow: "0 0 24px #ff6bf2aa" } : undefined}
          >
            <div>
              <div className="text-xs font-semibold flex items-center gap-1">
                <Dot className="h-4 w-4 -ml-1 text-[#ff6bf2]" />
                Centre of Symmetry
              </div>
              <div className="text-[10px] text-foreground/50">
                {hasCOS ? "Present in this molecule" : "Not present"}
              </div>
            </div>
            <div
              className={cn(
                "h-4 w-7 rounded-full transition",
                showCOS ? "bg-[#ff6bf2]" : "bg-white/15"
              )}
            >
              <div
                className={cn(
                  "h-4 w-4 rounded-full bg-white transition",
                  showCOS && "translate-x-3"
                )}
              />
            </div>
          </button>

          {/* Axis of Symmetry */}
          <button
            disabled={axes.length === 0}
            onClick={() => setAxisIdx((v) => (v === null ? 0 : null))}
            title="Rotation axis (Cn): rotating by 360°/n maps the molecule onto itself."
            className={cn(
              "w-full text-left rounded-xl px-3 py-2 mb-2 transition flex items-center justify-between",
              "border border-white/10 hover:border-[#a78bff]/60",
              axisIdx !== null && "border-[#a78bff]/80",
              axes.length === 0 && "opacity-40 cursor-not-allowed",
            )}
            style={axisIdx !== null ? { boxShadow: "0 0 24px #a78bffaa" } : undefined}
          >
            <div>
              <div className="text-xs font-semibold">Axis of Symmetry</div>
              <div className="text-[10px] text-foreground/50">
                {axes.length === 0
                  ? "No rotational axis detected"
                  : `Highest: ${axes[0].label}${axes.length > 1 ? ` (+${axes.length - 1})` : ""}`}
              </div>
            </div>
            <div className={cn("h-4 w-7 rounded-full transition", axisIdx !== null ? "bg-[#a78bff]" : "bg-white/15")}>
              <div className={cn("h-4 w-4 rounded-full bg-white transition", axisIdx !== null && "translate-x-3")} />
            </div>
          </button>
          {axisIdx !== null && axes.length > 1 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {axes.map((a, i) => (
                <button
                  key={i}
                  onClick={() => setAxisIdx(i)}
                  className={cn(
                    "text-[10px] px-2 py-1 rounded-md border border-white/10 hover:border-white/30 transition",
                    i === axisIdx && "bg-[#a78bff]/20 border-[#a78bff]/60"
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* Stereocentres */}
          <button
            disabled={stereoIdx.length === 0}
            onClick={() => setShowStereo((v) => !v)}
            title="Chiral carbon: sp³ C bonded to 4 different groups."
            className={cn(
              "w-full text-left rounded-xl px-3 py-2 mb-2 transition flex items-center justify-between",
              "border border-white/10 hover:border-[#ffd84d]/60",
              showStereo && "border-[#ffd84d]/80",
              stereoIdx.length === 0 && "opacity-40 cursor-not-allowed",
            )}
            style={showStereo ? { boxShadow: "0 0 24px #ffd84daa" } : undefined}
          >
            <div>
              <div className="text-xs font-semibold">Stereocentres</div>
              <div className="text-[10px] text-foreground/50">
                {stereoIdx.length === 0 ? "None detected" : `${stereoIdx.length} chiral C found`}
              </div>
            </div>
            <div className={cn("h-4 w-7 rounded-full transition", showStereo ? "bg-[#ffd84d]" : "bg-white/15")}>
              <div className={cn("h-4 w-4 rounded-full bg-white transition", showStereo && "translate-x-3")} />
            </div>
          </button>

          {/* Geometrical Isomers */}
          <button
            disabled={!geomInfo.possible}
            onClick={() => { setIsoTab("geometric"); setIsoOpen(true); }}
            title="cis/trans (E/Z) isomerism — open comparison lab"
            className={cn(
              "w-full text-left rounded-xl px-3 py-2 mb-2 transition flex items-center justify-between",
              "border border-white/10 hover:border-[#7af6ff]/60",
              !geomInfo.possible && "opacity-40 cursor-not-allowed",
            )}
          >
            <div>
              <div className="text-xs font-semibold">Geometrical Isomers</div>
              <div className="text-[10px] text-foreground/50">
                {geomInfo.possible
                  ? `${geomInfo.count} possible (${geomInfo.sites} site${geomInfo.sites > 1 ? "s" : ""})`
                  : "0 possible — no eligible C=C"}
              </div>
            </div>
            <span className={cn(
              "text-[10px] font-mono px-2 py-0.5 rounded-md border",
              geomInfo.possible
                ? "border-[#7af6ff]/50 text-[#7af6ff] bg-[#7af6ff]/10"
                : "border-white/10 text-foreground/40"
            )}>{geomInfo.count}</span>
          </button>

          {/* Optical Isomers */}
          <button
            disabled={!optInfo.chiral}
            onClick={() => { setIsoTab("optical"); setIsoOpen(true); }}
            title="Enantiomer / mirror image — open comparison lab"
            className={cn(
              "w-full text-left rounded-xl px-3 py-2 mb-2 transition flex items-center justify-between",
              "border border-white/10 hover:border-[#ff6bf2]/60",
              !optInfo.chiral && "opacity-40 cursor-not-allowed",
            )}
          >
            <div>
              <div className="text-xs font-semibold">Optical Isomers</div>
              <div className="text-[10px] text-foreground/50">
                {optInfo.chiral
                  ? `${optInfo.count} possible (${optInfo.centres} chiral C)`
                  : "0 possible — achiral"}
              </div>
            </div>
            <span className={cn(
              "text-[10px] font-mono px-2 py-0.5 rounded-md border",
              optInfo.chiral
                ? "border-[#ff6bf2]/50 text-[#ff6bf2] bg-[#ff6bf2]/10"
                : "border-white/10 text-foreground/40"
            )}>{optInfo.count}</span>
          </button>

          {/* Reset */}
          <button
            onClick={() => {
              setShowPOS(false);
              setShowCOS(false);
              setSelected(null);
              setAxisIdx(null);
              setShowStereo(false);
              setResetKey((k) => k + 1);
            }}
            className="w-full text-xs rounded-xl px-3 py-2 border border-white/10 hover:border-white/30 transition flex items-center justify-center gap-2"
          >
            <RotateCcw className="h-3 w-3" /> Reset View
          </button>

          {/* Educational info */}
          {(showPOS || showCOS) && (
            <div className="mt-3 rounded-xl p-3 bg-white/5 border border-white/10 animate-fade-in">
              <div className="text-[10px] uppercase tracking-widest text-foreground/50 flex items-center gap-1 mb-1">
                <Info className="h-3 w-3" /> Did you know?
              </div>
              {showPOS && (
                <div className="text-[11px] text-foreground/80 leading-relaxed mb-2">
                  <b className="text-[hsl(var(--neon-cyan))]">Plane of Symmetry:</b>{" "}
                  An imaginary mirror that splits {mol.name} into two identical
                  halves — every atom on one side has a twin on the other.
                </div>
              )}
              {showCOS && (
                <div className="text-[11px] text-foreground/80 leading-relaxed">
                  <b className="text-[#ff6bf2]">Centre of Symmetry:</b> A central
                  point in {mol.name} where each atom has a matching partner
                  directly opposite at the same distance.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Presentation badge */}
      {presentation && (
        <div className="absolute top-6 right-6 z-10">
          <button
            onClick={() => setPresentation(false)}
            className="glass rounded-full px-4 py-2 text-xs uppercase tracking-widest hover:scale-105 transition"
          >
            Exit Presentation
          </button>
        </div>
      )}
      {presentation && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 text-center animate-fade-in" key={mol.id}>
          <div className="text-5xl md:text-7xl font-bold neon-text">{mol.name}</div>
          <div className="mt-2 text-2xl font-mono text-foreground/80">{mol.formula}</div>
        </div>
      )}

      {/* Thumbnail strip */}
      {!presentation && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-[95vw] overflow-x-auto">
          <div className="flex gap-2 px-2">
            {molecules.map((m, i) => (
              <button
                key={m.id}
                onClick={() => {
                  setSelected(null);
                  setIndex(i);
                }}
                className={cn(
                  "glass min-w-[110px] rounded-xl px-3 py-2 text-left transition hover:scale-105",
                  i === index && "neon-glow ring-1 ring-[hsl(var(--neon-cyan))]"
                )}
              >
                <div className="text-[9px] uppercase tracking-wider text-foreground/50">
                  {m.group}
                </div>
                <div className="text-xs font-semibold truncate">{m.name}</div>
                <div className="text-[10px] font-mono text-foreground/60">{m.formula}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* IUPAC panel */}
      {iupacOpen && !presentation && (
        <div className="absolute top-20 right-6 z-20 w-[320px] max-w-[92vw] glass rounded-2xl p-4 animate-fade-in border border-[hsl(var(--neon-cyan))]/30 shadow-[0_0_40px_hsl(var(--neon-cyan)/0.25)]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))] flex items-center gap-1">
              <Wand2 className="h-3 w-3" /> IUPAC → 3D
            </div>
            <button
              onClick={() => setIupacOpen(false)}
              className="opacity-60 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            value={iupacName}
            onChange={(e) => setIupacName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !iupacLoading && handleGenerate()}
            placeholder="e.g. methane, ethanol, 2-chloropropane"
            className="w-full bg-white/5 border border-white/10 focus:border-[hsl(var(--neon-cyan))]/60 outline-none rounded-xl px-3 py-2 text-sm placeholder:text-foreground/30"
            disabled={iupacLoading}
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={iupacLoading || !iupacName.trim()}
              className="flex-1 rounded-xl px-3 py-2 text-xs font-semibold bg-[hsl(var(--neon-cyan))]/15 border border-[hsl(var(--neon-cyan))]/40 hover:bg-[hsl(var(--neon-cyan))]/25 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {iupacLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" /> Generate Structure
                </>
              )}
            </button>
            <button
              onClick={() => {
                setIupacName("");
                setIupacError(null);
              }}
              className="rounded-xl px-3 py-2 text-xs border border-white/10 hover:border-white/30 transition"
            >
              Clear
            </button>
          </div>
          {iupacError && (
            <div className="mt-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1.5">
              {iupacError}
            </div>
          )}
          <div className="mt-2 text-[10px] text-foreground/50 leading-relaxed">
            Powered by NCI CACTUS. Symmetry planes &amp; centre are detected
            automatically. Use the Save button to add it to your library.
          </div>
        </div>
      )}

      {/* Molecule Builder modal */}
      {builderOpen && (
        <Builder
          onClose={() => setBuilderOpen(false)}
          onGenerate={(newMol) => {
            setMolecules((prev) => {
              const nx = [...prev, newMol];
              setIndex(nx.length - 1);
              return nx;
            });
            setSelected(null);
            setResetKey((k) => k + 1);
            setBuilderOpen(false);
          }}
        />
      )}

      {isoOpen && (
        <IsomerismLab
          molecule={mol}
          initialTab={isoTab}
          onClose={() => setIsoOpen(false)}
          stereoCenters={stereoSummary.centres.length}
          isMeso={stereoSummary.isMeso}
          classification={stereoSummary.classification}
        />
      )}

      <StereoLab
        open={stereoLabOpen && !presentation}
        onClose={() => setStereoLabOpen(false)}
        summary={stereoSummary}
        onOpenIsomers={(tab) => {
          setIsoTab(tab);
          setIsoOpen(true);
        }}
        onHighlightStereo={() => setShowStereo((v) => !v)}
        highlightActive={showStereo}
      />
    </div>
  );
}