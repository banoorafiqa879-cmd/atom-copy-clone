import { Atom, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background flex items-center justify-center">
      <div className="absolute inset-0 grid-bg opacity-50" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "var(--gradient-glow)" }}
      />
      {/* floating atoms */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${20 + Math.random() * 60}px`,
              height: `${20 + Math.random() * 60}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              background: `radial-gradient(circle, hsl(${
                Math.random() > 0.5 ? "180 100% 60%" : "270 95% 70%"
              } / 0.35), transparent 70%)`,
              animation: `pulse ${3 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center px-6 max-w-2xl animate-fade-in">
        <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 mb-8">
          <Atom
            className="h-4 w-4 text-[hsl(var(--neon-cyan))]"
            style={{ animation: "spin 8s linear infinite" }}
          />
          <span className="text-xs uppercase tracking-[0.3em] text-foreground/70">
            Chemistry · 3D · Interactive
          </span>
        </div>
        <h1 className="text-5xl md:text-7xl font-black tracking-tight">
          <span className="neon-text">3D Organic</span>
          <br />
          <span className="text-foreground">Chemistry Explorer</span>
        </h1>
        <p className="mt-6 text-foreground/70 text-lg max-w-lg mx-auto">
          Visualize molecules, stereochemistry, symmetry and isomerism in real
          3D. Rotate, zoom, and explore the building blocks of organic chemistry.
        </p>

        <div className="mt-10 flex justify-center">
          <Button
            onClick={onStart}
            className="h-12 px-8 text-base font-semibold neon-glow bg-gradient-to-r from-[hsl(var(--neon-violet))] to-[hsl(var(--neon-cyan))] text-background hover:opacity-90"
          >
            Launch Explorer
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

      </div>
    </div>
  );
}
