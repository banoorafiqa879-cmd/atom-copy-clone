import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Sparkles, FlaskConical } from "lucide-react";
import { useLibrary } from "@/hooks/useLibrary";
import { toast } from "@/hooks/use-toast";
import type { SavedCompound } from "@/types/library";
import SearchBar from "@/components/library/SearchBar";
import CompoundCard from "@/components/library/CompoundCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const OPEN_KEY = "atom-forge:open-compound";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { compounds, loading, remove, toggleFavorite } = useLibrary();
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedCompound | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return compounds;
    return compounds.filter(
      (c) =>
        c.moleculeName.toLowerCase().includes(q) ||
        c.formula.toLowerCase().includes(q) ||
        // Strip subscript digits to allow plain "C6H6" matches
        c.formula.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (d) =>
          String("₀₁₂₃₄₅₆₇₈₉".indexOf(d)),
        ).toLowerCase().includes(q),
    );
  }, [compounds, query]);

  const handleOpen = (c: SavedCompound) => {
    try {
      sessionStorage.setItem(OPEN_KEY, JSON.stringify(c.structureData));
      toast({ title: `Loading ${c.moleculeName}...`, description: "Restoring your saved structure in the 3D viewer." });
      navigate({ to: "/" });
    } catch (e) {
      toast({
        title: "Could not open compound",
        description: e instanceof Error ? e.message : "Failed to restore the saved structure.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const ok = await remove(pendingDelete.id);
    if (ok) {
      toast({ title: "Compound removed successfully", description: `${pendingDelete.moleculeName} was deleted from your library.` });
    } else {
      toast({ title: "Could not remove compound", variant: "destructive" });
    }
    setPendingDelete(null);
  };

  const handleToggleFav = async (c: SavedCompound) => {
    await toggleFavorite(c.id);
  };

  return (
    <div
      className="fixed inset-0 overflow-y-auto overflow-x-hidden bg-background overscroll-contain"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {/* Background atmosphere — fixed so it stays during scroll */}
      <div className="fixed inset-0 grid-bg opacity-40 pointer-events-none" />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: "var(--gradient-glow)" }}
      />

      <div className="relative z-10 min-h-full max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6 sm:mb-8 animate-fade-in">
          <Link
            to="/"
            className="glass h-10 px-3 rounded-xl flex items-center gap-2 text-xs font-semibold hover:scale-105 transition"
          >
            <ArrowLeft className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
            <span className="hidden sm:inline">Back to Explorer</span>
          </Link>
          <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">
            Your saved chemistry
          </div>
        </div>

        <div className="mb-8 animate-fade-in">
          <div className="text-[10px] sm:text-xs uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))] flex items-center gap-2">
            <Sparkles className="h-3 w-3" /> Personal Collection
          </div>
          <h1 className="mt-2 text-4xl sm:text-5xl font-bold neon-text leading-tight">
            My Library
          </h1>
          <p className="mt-2 text-sm text-foreground/60 max-w-xl">
            All the compounds you've saved while exploring. Search, favorite, and reopen
            them in the 3D viewer at any time.
          </p>
        </div>

        {/* Search */}
        {compounds.length > 0 && (
          <div className="mb-6 max-w-xl">
            <SearchBar value={query} onChange={setQuery} />
            <div className="mt-2 text-[11px] text-foreground/40">
              {filtered.length} of {compounds.length}{" "}
              {compounds.length === 1 ? "compound" : "compounds"}
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="glass rounded-2xl h-44 animate-pulse border border-white/5"
              />
            ))}
          </div>
        ) : compounds.length === 0 ? (
          <EmptyState onExplore={() => navigate({ to: "/" })} />
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-10 text-center border border-white/10">
            <p className="text-foreground/70">No compounds match "{query}".</p>
            <button
              onClick={() => setQuery("")}
              className="mt-3 text-xs text-[hsl(var(--neon-cyan))] hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <CompoundCard
                key={c.id}
                compound={c}
                onOpen={handleOpen}
                onDelete={setPendingDelete}
                onToggleFavorite={handleToggleFav}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="glass border border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this compound from your library?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.moleculeName} (${pendingDelete.formula}) will be permanently deleted from your saved compounds.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-[hsl(var(--neon-pink))]/80 hover:bg-[hsl(var(--neon-pink))] text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onExplore }: { onExplore: () => void }) {
  return (
    <div className="glass rounded-3xl p-10 sm:p-16 text-center border border-white/10 animate-fade-in">
      <div className="mx-auto h-16 w-16 rounded-2xl glass neon-glow flex items-center justify-center mb-5">
        <FlaskConical className="h-8 w-8 text-[hsl(var(--neon-cyan))]" />
      </div>
      <h2 className="text-2xl sm:text-3xl font-bold neon-text">No saved compounds yet</h2>
      <p className="mt-2 text-sm text-foreground/60 max-w-md mx-auto">
        Explore and save compounds to build your chemistry library.
      </p>
      <button
        onClick={onExplore}
        className="mt-6 glass neon-glow h-11 px-5 rounded-xl inline-flex items-center gap-2 text-sm font-semibold hover:scale-105 transition"
      >
        <Sparkles className="h-4 w-4 text-[hsl(var(--neon-cyan))]" />
        Explore Molecules
      </button>
    </div>
  );
}
