import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Wand2, Pencil, FlaskConical, Microscope, BookmarkPlus, BookmarkCheck,
  Library as LibraryIcon, Play, Pause, Boxes, Crosshair, Presentation,
  Maximize2, MoreHorizontal, X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface Props {
  iupacOpen: boolean;
  stereoLabOpen: boolean;
  alreadySaved: boolean;
  autoRotate: boolean;
  spaceFilling: boolean;
  rotateSpeed: number;
  onRotateSpeed: (v: number) => void;
  onIUPAC: () => void;
  onBuild: () => void;
  onIsomers: () => void;
  onStereo: () => void;
  onSave: () => void;
  onAutoRotate: () => void;
  onSpaceFill: () => void;
  onFit: () => void;
  onPresentation: () => void;
  onFullscreen: () => void;
}

const PRIMARY_BTN = "shrink-0 glass h-12 min-w-[60px] px-2.5 rounded-xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition text-[10px] font-semibold";

export default function MobileToolbar(p: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (!overflowOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [overflowOpen]);

  // Escape to close
  useEffect(() => {
    if (!overflowOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOverflowOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overflowOpen]);

  return (
    <>
      <div className="sm:hidden absolute top-14 left-0 right-0 z-20 px-3 animate-fade-in">
        <div
          className="flex gap-2 overflow-x-auto pb-1 scroll-smooth"
          style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
        >
          <button onClick={p.onIUPAC} className={cn(PRIMARY_BTN, p.iupacOpen && "neon-glow")} aria-label="IUPAC">
            <Wand2 className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>IUPAC</span>
          </button>
          <button onClick={p.onBuild} className={PRIMARY_BTN} aria-label="Build">
            <Pencil className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>Build</span>
          </button>
          <button onClick={p.onIsomers} className={PRIMARY_BTN} aria-label="Isomers">
            <FlaskConical className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>Isomers</span>
          </button>
          <button
            data-stereolab-launcher
            onClick={p.onStereo}
            className={cn(PRIMARY_BTN, p.stereoLabOpen && "neon-glow")}
            aria-label="Stereo"
          >
            <Microscope className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>Stereo</span>
          </button>
          <button
            onClick={p.onSave}
            className={cn(PRIMARY_BTN, p.alreadySaved && "neon-glow")}
            aria-label={p.alreadySaved ? "Saved" : "Save"}
            aria-pressed={p.alreadySaved}
          >
            {p.alreadySaved
              ? <BookmarkCheck className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
              : <BookmarkPlus className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />}
            <span>{p.alreadySaved ? "Saved" : "Save"}</span>
          </button>
          <button
            onClick={p.onAutoRotate}
            className={cn(PRIMARY_BTN, p.autoRotate && "neon-glow")}
            aria-label="Auto-rotate"
            aria-pressed={p.autoRotate}
          >
            {p.autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{p.autoRotate ? "Pause" : "Rotate"}</span>
          </button>
          <Link to="/library" className={PRIMARY_BTN} aria-label="Library">
            <LibraryIcon className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>Library</span>
          </Link>
          <button
            onClick={() => setOverflowOpen(true)}
            className={cn(PRIMARY_BTN, "min-w-[56px]")}
            aria-label="More controls"
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>More</span>
          </button>
        </div>
      </div>

      {/* Bottom sheet — rendered to body to escape scroll clipping */}
      {overflowOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] sm:hidden animate-fade-in">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOverflowOpen(false)}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            className="absolute left-0 right-0 bottom-0 glass border-t border-white/10 rounded-t-3xl p-4 pb-7 max-h-[80vh] overflow-y-auto animate-slide-up bg-background/95 backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">
                Viewer controls
              </div>
              <button
                onClick={() => setOverflowOpen(false)}
                className="h-9 w-9 rounded-full glass flex items-center justify-center active:scale-95"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Rotation speed slider — full parity with desktop */}
            <div className="rounded-2xl border border-white/10 p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold flex items-center gap-2">
                  {p.autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  Auto-rotation
                </div>
                <button
                  onClick={p.onAutoRotate}
                  className={cn(
                    "h-7 px-3 rounded-full text-[10px] font-bold tracking-wider transition",
                    p.autoRotate
                      ? "bg-[hsl(var(--neon-cyan))]/20 text-[hsl(var(--neon-cyan))] border border-[hsl(var(--neon-cyan))]/50"
                      : "bg-white/5 text-foreground/60 border border-white/10"
                  )}
                  aria-pressed={p.autoRotate}
                >
                  {p.autoRotate ? "ON" : "OFF"}
                </button>
              </div>
              <div className="flex items-center justify-between text-[10px] text-foreground/50 mb-1">
                <span>Speed</span>
                <span className="font-mono text-foreground/80">{p.rotateSpeed.toFixed(1)}×</span>
              </div>
              <input
                type="range" min={0.1} max={2} step={0.1}
                value={p.rotateSpeed}
                onChange={(e) => p.onRotateSpeed(parseFloat(e.target.value))}
                className="w-full accent-[hsl(var(--neon-cyan))]"
              />
              <div className="flex justify-between text-[9px] text-foreground/40 mt-0.5">
                <span>Slow</span><span>Fast</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <SheetItem
                icon={p.alreadySaved ? <BookmarkCheck className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> : <BookmarkPlus className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />}
                label={p.alreadySaved ? "Saved to Library" : "Save to Library"}
                onClick={() => { setOverflowOpen(false); p.onSave(); }}
                active={p.alreadySaved}
              />
              <SheetItem
                icon={<Boxes className="h-4 w-4" />}
                label="Space-filling"
                onClick={() => { setOverflowOpen(false); p.onSpaceFill(); }}
                active={p.spaceFilling}
              />
              <SheetItem
                icon={<Crosshair className="h-4 w-4" />}
                label="Fit / Recenter"
                onClick={() => { setOverflowOpen(false); p.onFit(); }}
              />
              <SheetItem
                icon={<Presentation className="h-4 w-4" />}
                label="Presentation"
                onClick={() => { setOverflowOpen(false); p.onPresentation(); }}
              />
              <SheetItem
                icon={<Maximize2 className="h-4 w-4" />}
                label="Fullscreen"
                onClick={() => { setOverflowOpen(false); p.onFullscreen(); }}
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function SheetItem({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-3 rounded-xl text-xs font-medium transition active:scale-[0.97] border",
        active
          ? "bg-[hsl(var(--neon-cyan))]/15 text-[hsl(var(--neon-cyan))] border-[hsl(var(--neon-cyan))]/40"
          : "hover:bg-white/5 text-foreground/85 border-white/10"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-left leading-tight">{label}</span>
    </button>
  );
}
