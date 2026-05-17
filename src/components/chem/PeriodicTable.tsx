import { useMemo, useState } from "react";
import { X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ELEMENT_DATA, type Element } from "@/data/molecules";

// (symbol, name, period, group, category)
type Cat = "nonmetal" | "halogen" | "noble" | "alkali" | "alkaline" | "metalloid" | "metal" | "transition" | "lanthanide" | "actinide";
interface Cell { z: number; sym: string; name: string; period: number; group: number; cat: Cat }

const ELEMENTS: Cell[] = [
  { z: 1, sym: "H",  name: "Hydrogen",   period: 1, group: 1,  cat: "nonmetal" },
  { z: 2, sym: "He", name: "Helium",     period: 1, group: 18, cat: "noble" },
  { z: 3, sym: "Li", name: "Lithium",    period: 2, group: 1,  cat: "alkali" },
  { z: 4, sym: "Be", name: "Beryllium",  period: 2, group: 2,  cat: "alkaline" },
  { z: 5, sym: "B",  name: "Boron",      period: 2, group: 13, cat: "metalloid" },
  { z: 6, sym: "C",  name: "Carbon",     period: 2, group: 14, cat: "nonmetal" },
  { z: 7, sym: "N",  name: "Nitrogen",   period: 2, group: 15, cat: "nonmetal" },
  { z: 8, sym: "O",  name: "Oxygen",     period: 2, group: 16, cat: "nonmetal" },
  { z: 9, sym: "F",  name: "Fluorine",   period: 2, group: 17, cat: "halogen" },
  { z: 10, sym: "Ne", name: "Neon",      period: 2, group: 18, cat: "noble" },
  { z: 11, sym: "Na", name: "Sodium",    period: 3, group: 1,  cat: "alkali" },
  { z: 12, sym: "Mg", name: "Magnesium", period: 3, group: 2,  cat: "alkaline" },
  { z: 13, sym: "Al", name: "Aluminium", period: 3, group: 13, cat: "metal" },
  { z: 14, sym: "Si", name: "Silicon",   period: 3, group: 14, cat: "metalloid" },
  { z: 15, sym: "P",  name: "Phosphorus", period: 3, group: 15, cat: "nonmetal" },
  { z: 16, sym: "S",  name: "Sulfur",    period: 3, group: 16, cat: "nonmetal" },
  { z: 17, sym: "Cl", name: "Chlorine",  period: 3, group: 17, cat: "halogen" },
  { z: 18, sym: "Ar", name: "Argon",     period: 3, group: 18, cat: "noble" },
  { z: 19, sym: "K",  name: "Potassium", period: 4, group: 1,  cat: "alkali" },
  { z: 20, sym: "Ca", name: "Calcium",   period: 4, group: 2,  cat: "alkaline" },
  { z: 26, sym: "Fe", name: "Iron",      period: 4, group: 8,  cat: "transition" },
  { z: 29, sym: "Cu", name: "Copper",    period: 4, group: 11, cat: "transition" },
  { z: 30, sym: "Zn", name: "Zinc",      period: 4, group: 12, cat: "transition" },
  { z: 35, sym: "Br", name: "Bromine",   period: 4, group: 17, cat: "halogen" },
  { z: 36, sym: "Kr", name: "Krypton",   period: 4, group: 18, cat: "noble" },
  { z: 47, sym: "Ag", name: "Silver",    period: 5, group: 11, cat: "transition" },
  { z: 53, sym: "I",  name: "Iodine",    period: 5, group: 17, cat: "halogen" },
  { z: 79, sym: "Au", name: "Gold",      period: 6, group: 11, cat: "transition" },
  { z: 80, sym: "Hg", name: "Mercury",   period: 6, group: 12, cat: "transition" },
];

const CAT_COLOR: Record<Cat, string> = {
  nonmetal:   "from-cyan-400/30 to-cyan-600/10 border-cyan-400/40",
  halogen:    "from-emerald-400/30 to-emerald-600/10 border-emerald-400/40",
  noble:      "from-violet-400/30 to-violet-600/10 border-violet-400/40",
  alkali:     "from-rose-400/30 to-rose-600/10 border-rose-400/40",
  alkaline:   "from-orange-400/30 to-orange-600/10 border-orange-400/40",
  metalloid:  "from-amber-400/30 to-amber-600/10 border-amber-400/40",
  metal:      "from-slate-400/30 to-slate-600/10 border-slate-400/40",
  transition: "from-fuchsia-400/30 to-fuchsia-600/10 border-fuchsia-400/40",
  lanthanide: "from-teal-400/30 to-teal-600/10 border-teal-400/40",
  actinide:   "from-pink-400/30 to-pink-600/10 border-pink-400/40",
};

interface Props {
  current: Element;
  onSelect: (el: Element) => void;
  onClose: () => void;
}

export default function PeriodicTable({ current, onSelect, onClose }: Props) {
  const [q, setQ] = useState("");
  const supported = useMemo(() => new Set(Object.keys(ELEMENT_DATA) as Element[]), []);
  const filtered = useMemo(() => {
    if (!q.trim()) return ELEMENTS;
    const s = q.trim().toLowerCase();
    return ELEMENTS.filter(e =>
      e.sym.toLowerCase().includes(s) || e.name.toLowerCase().includes(s) || String(e.z) === s
    );
  }, [q]);
  const filteredSet = useMemo(() => new Set(filtered.map(e => e.sym)), [filtered]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-xl" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[92vh] glass rounded-3xl border border-white/10 shadow-[0_0_60px_hsl(var(--neon-cyan)/0.25)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">Element Picker</div>
            <div className="text-lg font-bold neon-text">Periodic Table</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/50" />
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search element…"
                className="glass h-9 pl-7 pr-3 rounded-xl text-xs w-40 sm:w-56 outline-none focus:ring-1 focus:ring-[hsl(var(--neon-cyan))]/50"
              />
            </div>
            <button onClick={onClose} className="h-9 w-9 rounded-xl glass flex items-center justify-center active:scale-95">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-3 sm:p-5 overflow-auto">
          <div
            className="grid gap-1 min-w-[640px]"
            style={{ gridTemplateColumns: "repeat(18, minmax(34px, 1fr))" }}
          >
            {ELEMENTS.map(e => {
              const isSup = supported.has(e.sym as Element);
              const isCur = isSup && (e.sym as Element) === current;
              const inSearch = filteredSet.has(e.sym);
              return (
                <button
                  key={e.z}
                  disabled={!isSup}
                  onClick={() => isSup && onSelect(e.sym as Element)}
                  title={isSup ? `${e.name} (Z=${e.z})` : `${e.name} — coming soon`}
                  style={{ gridColumnStart: e.group, gridRowStart: e.period }}
                  className={cn(
                    "aspect-square rounded-md border bg-gradient-to-br p-1 flex flex-col items-center justify-center text-[10px] transition relative",
                    CAT_COLOR[e.cat],
                    isSup ? "active:scale-95 hover:scale-105 hover:z-10 cursor-pointer" : "opacity-25 cursor-not-allowed grayscale",
                    isCur && "ring-2 ring-[hsl(var(--neon-cyan))] shadow-[0_0_18px_hsl(var(--neon-cyan)/0.6)]",
                    !inSearch && q && "opacity-15"
                  )}
                >
                  <span className="text-[8px] text-foreground/50 leading-none">{e.z}</span>
                  <span className="font-bold text-[13px] sm:text-[14px] leading-none mt-0.5"
                    style={isSup ? { color: ELEMENT_DATA[e.sym as Element].color } : undefined}>{e.sym}</span>
                  <span className="text-[7px] text-foreground/60 leading-none truncate w-full text-center mt-0.5">{e.name}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[10px]">
            {(["nonmetal","halogen","noble","alkali","alkaline","metalloid","metal","transition"] as Cat[]).map(c => (
              <span key={c} className={cn("px-2 py-0.5 rounded-full border bg-gradient-to-r capitalize", CAT_COLOR[c])}>{c}</span>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-foreground/50 leading-relaxed">
            Active elements <span className="text-foreground/80 font-semibold">H, C, N, O, F, S, Cl, Br</span> are fully supported in the 3D engine. Greyed elements are exposed for educational reference — full geometry/valence support for the remaining periodic table is being added in a future release.
          </p>
        </div>
      </div>
    </div>
  );
}
