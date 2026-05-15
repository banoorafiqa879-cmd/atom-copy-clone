import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Intro from "@/components/chem/Intro";
import Viewer from "@/components/chem/Viewer";
import type { Molecule } from "@/data/molecules";

const OPEN_KEY = "atom-forge:open-compound";
const IN_EXPLORER_KEY = "atom-forge:in-explorer";

type Phase = "checking" | "intro" | "viewer";

const Index = () => {
  const [phase, setPhase] = useState<Phase>("checking");
  const [pendingMolecule, setPendingMolecule] = useState<Molecule | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPhase("intro");
      return;
    }
    try {
      // 1. A user reopening a saved compound from /library.
      const raw = sessionStorage.getItem(OPEN_KEY);
      if (raw) {
        sessionStorage.removeItem(OPEN_KEY);
        const mol = JSON.parse(raw) as Molecule;
        if (mol && Array.isArray(mol.atoms) && Array.isArray(mol.bonds)) {
          setPendingMolecule(mol);
          setPhase("viewer");
          return;
        }
      }
      // 2. A user navigating back from /library to "/" — they've already
      //    entered the explorer this session, so skip the intro.
      if (sessionStorage.getItem(IN_EXPLORER_KEY) === "1") {
        setPhase("viewer");
        return;
      }
    } catch {
      /* ignore storage errors */
    }
    setPhase("intro");
  }, []);

  if (phase === "checking") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
        <div className="relative flex items-center gap-2 text-foreground/60 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--neon-cyan))]" />
          Loading…
        </div>
      </div>
    );
  }

  if (phase === "viewer") {
    return <Viewer initialMolecule={pendingMolecule ?? undefined} />;
  }

  return <Intro onStart={() => setPhase("viewer")} />;
};

export default Index;
