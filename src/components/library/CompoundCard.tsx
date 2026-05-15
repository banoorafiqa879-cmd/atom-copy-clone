import { useMemo } from "react";
import { Star, Trash2, Eye, Atom as AtomIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedCompound } from "@/types/library";

interface Props {
  compound: SavedCompound;
  onOpen: (c: SavedCompound) => void;
  onDelete: (c: SavedCompound) => void;
  onToggleFavorite: (c: SavedCompound) => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function CompoundCard({ compound, onOpen, onDelete, onToggleFavorite }: Props) {
  const { atoms, bonds } = compound.structureData;
  const elementSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of atoms) counts[a.el] = (counts[a.el] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [atoms]);

  return (
    <div className="group relative glass rounded-2xl p-4 sm:p-5 border border-white/10 hover:border-[hsl(var(--neon-cyan))]/40 transition-all hover:-translate-y-0.5 animate-fade-in flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">
            {compound.structureData.group ?? "Compound"}
          </div>
          <h3 className="mt-0.5 text-lg sm:text-xl font-bold neon-text leading-tight truncate">
            {compound.moleculeName}
          </h3>
          <div className="mt-0.5 text-sm font-mono text-foreground/80 truncate">
            {compound.formula}
          </div>
        </div>
        <button
          onClick={() => onToggleFavorite(compound)}
          className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center transition hover:bg-white/5",
            compound.favorite ? "text-[hsl(var(--neon-pink))]" : "text-foreground/40 hover:text-foreground/70",
          )}
          title={compound.favorite ? "Unfavorite" : "Mark as favorite"}
          aria-pressed={compound.favorite}
        >
          <Star className={cn("h-4 w-4", compound.favorite && "fill-current")} />
        </button>
      </div>

      {/* Mini structure preview */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 flex items-center gap-2">
        <AtomIcon className="h-3.5 w-3.5 text-[hsl(var(--neon-violet))] shrink-0" />
        <div className="flex flex-wrap gap-1">
          {elementSummary.map(([el, n]) => (
            <span
              key={el}
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--neon-cyan))]/10 border border-[hsl(var(--neon-cyan))]/20 text-[hsl(var(--neon-cyan))]"
            >
              {el}
              <sub>{n}</sub>
            </span>
          ))}
        </div>
        <div className="ml-auto text-[10px] text-foreground/40 shrink-0">
          {atoms.length}a · {bonds.length}b
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-foreground/50">Saved {formatDate(compound.timestamp)}</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onDelete(compound)}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-foreground/60 hover:text-[hsl(var(--neon-pink))] hover:bg-white/5 transition"
            title="Remove from library"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onOpen(compound)}
            className="glass neon-glow h-8 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-semibold hover:scale-105 transition"
            title="Open in 3D viewer"
          >
            <Eye className="h-3.5 w-3.5 text-[hsl(var(--neon-cyan))]" />
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
