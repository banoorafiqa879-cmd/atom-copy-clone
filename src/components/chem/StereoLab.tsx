import { useEffect, useRef } from "react";
import { Atom as AtomIcon, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  classificationLabel,
  type StereoSummary,
} from "@/lib/stereochem";

interface Props {
  open: boolean;
  onClose: () => void;
  summary: StereoSummary;
  onOpenIsomers: (tab: "geometric" | "optical") => void;
  onHighlightStereo: () => void;
  highlightActive: boolean;
}

/**
 * Stereochemistry Lab panel — focused, science-correct summary of the
 * currently displayed molecule. Complements the Symmetry Lab; this panel
 * answers "what stereoisomers actually exist for THIS compound?".
 */
export default function StereoLab({
  open,
  onClose,
  summary,
  onOpenIsomers,
  onHighlightStereo,
  highlightActive,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      // Don't close when clicking the launcher (handled by parent toggle)
      if ((t as HTMLElement)?.closest?.("[data-stereolab-launcher]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const accentByClass: Record<string, string> = {
    achiral: "#7af6ff",
    "chiral-single": "#ffd84d",
    "chiral-multi": "#ff6bf2",
    meso: "#a78bff",
  };
  const accent = accentByClass[summary.classification];

  return (
    <div
      ref={panelRef}
      className="absolute right-3 sm:right-6 bottom-48 md:bottom-44 z-[60] w-[300px] max-w-[92vw] glass rounded-2xl p-4 animate-scale-in border border-white/10"
      style={{ boxShadow: `0 0 40px ${accent}33` }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))] flex items-center gap-1">
          <AtomIcon className="h-3 w-3" /> Stereo Lab
        </div>
        {summary.approximate && (
          <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-md border border-white/10 text-foreground/50">
            Approx.
          </span>
        )}
      </div>

      {/* Classification banner */}
      <div
        className="rounded-xl px-3 py-2 mb-3 border"
        style={{
          background: `${accent}14`,
          borderColor: `${accent}55`,
        }}
      >
        <div className="text-[10px] uppercase tracking-widest text-foreground/50">
          Classification
        </div>
        <div className="text-sm font-semibold" style={{ color: accent }}>
          {classificationLabel(summary.classification)}
        </div>
      </div>

      {/* Counts grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Stat label="Stereocentres" value={summary.centres.length} />
        <Stat label="C=C sites (E/Z)" value={summary.geomSites} />
        <Stat
          label="Optical isomers"
          value={summary.opticalIsomers}
          accent="#ff6bf2"
        />
        <Stat
          label="Geometric isomers"
          value={summary.geometricIsomers}
          accent="#7af6ff"
        />
      </div>

      <div
        className="rounded-xl px-3 py-2 mb-3 border border-white/10 bg-white/[0.03]"
      >
        <div className="text-[10px] uppercase tracking-widest text-foreground/50">
          Total stereoisomers
        </div>
        <div className="text-2xl font-bold neon-text leading-tight">
          {summary.totalStereoisomers}
        </div>
        <div className="text-[10px] text-foreground/50 mt-0.5">
          {summary.isMeso
            ? "Meso reduction applied"
            : summary.opticalIsomers && summary.geometricIsomers
              ? "Optical × geometric (independent)"
              : summary.opticalIsomers
                ? "Optical only"
                : summary.geometricIsomers
                  ? "Geometric only"
                  : "No stereoisomers possible"}
        </div>
      </div>

      <div className="space-y-1.5 mb-3">
        <button
          onClick={onHighlightStereo}
          disabled={summary.centres.length === 0}
          className={cn(
            "w-full text-left rounded-xl px-3 py-2 text-xs border border-white/10 hover:border-[#ffd84d]/60 transition flex items-center justify-between",
            highlightActive && "border-[#ffd84d]/80",
            summary.centres.length === 0 && "opacity-40 cursor-not-allowed",
          )}
          style={highlightActive ? { boxShadow: "0 0 20px #ffd84daa" } : undefined}
        >
          <span className="font-semibold">Highlight stereocentres</span>
          <span className="text-[10px] text-foreground/50">
            {summary.centres.length}
          </span>
        </button>
        <button
          onClick={() => onOpenIsomers("optical")}
          disabled={summary.opticalIsomers <= 1}
          className={cn(
            "w-full text-left rounded-xl px-3 py-2 text-xs border border-white/10 hover:border-[#ff6bf2]/60 transition flex items-center justify-between",
            summary.opticalIsomers <= 1 && "opacity-40 cursor-not-allowed",
          )}
        >
          <span className="font-semibold">View enantiomers</span>
          <span className="text-[10px] text-foreground/50">→</span>
        </button>
        <button
          onClick={() => onOpenIsomers("geometric")}
          disabled={summary.geometricIsomers === 0}
          className={cn(
            "w-full text-left rounded-xl px-3 py-2 text-xs border border-white/10 hover:border-[#7af6ff]/60 transition flex items-center justify-between",
            summary.geometricIsomers === 0 && "opacity-40 cursor-not-allowed",
          )}
        >
          <span className="font-semibold">View cis/trans (E/Z)</span>
          <span className="text-[10px] text-foreground/50">→</span>
        </button>
      </div>

      {summary.notes.length > 0 && (
        <div className="rounded-xl p-3 bg-white/5 border border-white/10">
          <div className="text-[10px] uppercase tracking-widest text-foreground/50 flex items-center gap-1 mb-1">
            <Info className="h-3 w-3" /> Notes
          </div>
          <ul className="space-y-1">
            {summary.notes.map((n, i) => (
              <li key={i} className="text-[11px] text-foreground/75 leading-relaxed flex gap-1.5">
                <Sparkles className="h-3 w-3 mt-0.5 shrink-0 text-[hsl(var(--neon-cyan))]" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl px-3 py-2 border border-white/10 bg-white/[0.03]">
      <div className="text-[9px] uppercase tracking-widest text-foreground/50 leading-tight">
        {label}
      </div>
      <div
        className="text-lg font-semibold font-mono"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
