/**
 * Lazy, cached, client-only RDKit-JS loader.
 * Never import this module from server code.
 */
import type { RDKitModule } from "@rdkit/rdkit";

let pending: Promise<RDKitModule> | null = null;

export function getRDKit(): Promise<RDKitModule> {
  if (pending) return pending;
  pending = (async () => {
    if (typeof window === "undefined") {
      throw new Error("RDKit-JS is client-only and cannot run on the server.");
    }
    // Dynamic import keeps the 7 MB WASM out of the initial bundle.
    const mod = await import("@rdkit/rdkit/dist/RDKit_minimal.js" as string);
    const init = (mod as { default?: unknown; initRDKitModule?: unknown })
      .default ?? (mod as { initRDKitModule?: unknown }).initRDKitModule
      ?? (window as unknown as { initRDKitModule?: unknown }).initRDKitModule;
    if (typeof init !== "function") {
      throw new Error("Could not locate initRDKitModule entrypoint");
    }
    const rdkit = await (init as (opts?: { locateFile?: () => string }) => Promise<RDKitModule>)({
      locateFile: () => "/wasm/RDKit_minimal.wasm",
    });
    return rdkit;
  })().catch((err) => {
    pending = null; // allow retry on next call
    throw err;
  });
  return pending;
}

/** Resets the cached instance — primarily for tests. */
export function _resetRDKit() {
  pending = null;
}
