import { useEffect, useRef, useState } from "react";
import {
  Wand2, Pencil, FlaskConical, Microscope, BookmarkPlus, BookmarkCheck,
  Library as LibraryIcon, Play, Pause, Boxes, Crosshair, Presentation,
  Maximize2, MoreHorizontal,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface Props {
  iupacOpen: boolean;
  stereoLabOpen: boolean;
  alreadySaved: boolean;
  autoRotate: boolean;
  spaceFilling: boolean;
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

const PRIMARY_BTN = "shrink-0 glass h-12 min-w-[64px] px-3 rounded-xl flex flex-col items-center justify-center gap-0.5 active:scale-95 transition text-[10px] font-semibold";

export default function MobileToolbar(p: Props) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: PointerEvent) => {
      if (overflowRef.current?.contains(e.target as Node)) return;
      setOverflowOpen(false);
    };
    const id = window.setTimeout(() => window.addEventListener("pointerdown", onDown), 50);
    return () => { window.clearTimeout(id); window.removeEventListener("pointerdown", onDown); };
  }, [overflowOpen]);

  return (
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
        <Link to="/library" className={PRIMARY_BTN} aria-label="Library">
          <LibraryIcon className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
          <span>Library</span>
        </Link>

        {/* Overflow */}
        <div ref={overflowRef} className="relative shrink-0">
          <button
            onClick={() => setOverflowOpen(v => !v)}
            className={cn(PRIMARY_BTN, "min-w-[48px] px-2", overflowOpen && "neon-glow")}
            aria-label="More"
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span>More</span>
          </button>
          {overflowOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] glass rounded-2xl border border-white/10 p-2 w-56 shadow-2xl backdrop-blur-xl bg-background/90 animate-fade-in">
              <OverflowItem
                icon={p.alreadySaved ? <BookmarkCheck className="h-4 w-4 text-[hsl(var(--neon-cyan))]" /> : <BookmarkPlus className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />}
                label={p.alreadySaved ? "Saved to Library" : "Save to Library"}
                onClick={() => { setOverflowOpen(false); p.onSave(); }}
                active={p.alreadySaved}
              />
              <OverflowItem
                icon={p.autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                label={p.autoRotate ? "Pause rotation" : "Auto-rotate"}
                onClick={() => { setOverflowOpen(false); p.onAutoRotate(); }}
              />
              <OverflowItem
                icon={<Boxes className="h-4 w-4" />}
                label="Space-filling model"
                onClick={() => { setOverflowOpen(false); p.onSpaceFill(); }}
                active={p.spaceFilling}
              />
              <OverflowItem
                icon={<Crosshair className="h-4 w-4" />}
                label="Fit / Recenter"
                onClick={() => { setOverflowOpen(false); p.onFit(); }}
              />
              <OverflowItem
                icon={<Presentation className="h-4 w-4" />}
                label="Presentation mode"
                onClick={() => { setOverflowOpen(false); p.onPresentation(); }}
              />
              <OverflowItem
                icon={<Maximize2 className="h-4 w-4" />}
                label="Fullscreen"
                onClick={() => { setOverflowOpen(false); p.onFullscreen(); }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverflowItem({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition active:scale-[0.98]",
        active ? "bg-[hsl(var(--neon-cyan))]/15 text-[hsl(var(--neon-cyan))]" : "hover:bg-white/5 text-foreground/80"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="text-left">{label}</span>
    </button>
  );
}
