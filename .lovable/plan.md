# Phase 1B — Real Chemistry Correctness Engine

Replace the current heuristic stereochemistry (Morgan-depth-2, naive 2^n, mirror-plane meso guess) with a **real RDKit-JS** engine. No UI redesign — only the minimum wiring needed so the existing Stereo Lab, Isomerism Lab, and viewers reflect exact engine output for the **currently selected compound**.

## Architecture

New chemistry service layer (lazy, client-only, cached):

```text
src/services/chemistry/
  rdkit.ts              # Lazy WASM loader, single cached instance
  smiles.ts             # Molecule <-> SMILES bridge (uses existing IUPAC->SDF + RDKit)
  stereochemistry.ts    # Real analysis: chirality, E/Z, meso, totals
  isomerGenerator.ts    # Real enumeration of stereoisomers as Molecule[]
  index.ts              # Public API surface
```

Existing `src/lib/stereochem.ts` and `src/lib/chem-analysis.ts` are kept only as a graceful fallback when RDKit is still loading or fails on a given structure (with an explicit "approximate" badge — never silently faked).

## RDKit integration (B2.0)

- Add `@rdkit/rdkit` dependency. Copy `RDKit_minimal.wasm` to `public/wasm/` via a postinstall step or a one-shot script; load via `initRDKitModule({ locateFile: () => '/wasm/RDKit_minimal.wasm' })`.
- `getRDKit()` returns a cached `Promise<RDKitModule>`. Never imported from server code (client-only guard: `if (typeof window === 'undefined') throw`).
- All callers `await getRDKit()` inside event handlers / effects, not at module scope. Viewer/app startup stays unblocked.

## Molecule bridging (B2.1)

The app already has two molecule sources: built-in `MOLECULES` (with 3D coords) and the IUPAC->CACTUS SDF path (`src/lib/iupac.ts`). Both produce the internal `Molecule` shape.

- New `moleculeToSmiles(mol)`: write the internal `Molecule` to a MOL block (atoms + bonds we already have) → `RDKit.get_mol(molblock)` → `mol.get_smiles()`. Cache per molecule id.
- New `smilesToMolecule(smiles, name)`: `RDKit.get_mol(smiles)` → `get_new_coords(true)` → MOL block → reuse existing `parseSDF` to produce a `Molecule` with 3D positions.
- Every analysis/enumeration call takes the **exact current `Molecule`** the UI is showing. No fallback to demo structures anywhere.

## Real stereochemistry (B2.2)

`analyzeStereochemistry(mol): StereoReport` using RDKit:

- `Chem.FindMolChiralCenters(mol, includeUnassigned=true, useLegacyImplementation=false)` for tetrahedral stereocenters (count + atom indices + R/S when assignable).
- `Chem.FindPotentialStereoBonds` + iterate bonds for E/Z double bonds and ring-restricted geometric isomerism (skip small rings where E is impossible — RDKit already filters).
- Meso detection: enumerate stereoisomers (see B2.3) with `StereoEnumerationOptions(onlyUnassigned=false, unique=true)`; if `centers > 0` and unique enumerated count < 2^centers and the canonical SMILES of the molecule equals that of its mirror image, classify as **meso**.
- Classification: `achiral | chiral-single | chiral-multi | meso`.
- Totals: `opticalIsomers = uniqueEnumeratedCount` (post meso reduction); `geometricIsomers = 2^validEZBonds`; `total = product` with meso reduction already baked in. No naive 2^n.

## Real isomer enumeration (B2.3)

`enumerateStereoisomers(mol, { kind: 'optical' | 'geometric' | 'all', max = 16 }): Molecule[]`

- Use RDKit's `EnumerateStereoisomers` (exposed in JS build via `mol.get_stereo_isomers()` where available; otherwise fall back to manual flag flipping over detected centers/bonds and dedupe by canonical SMILES).
- Each enumerated SMILES is converted back to a full 3D `Molecule` via `smilesToMolecule` so the existing `Molecule3D` viewer renders **the actual isomer**, not a placeholder.
- Hard cap at `max` to keep the viewer responsive; surface "Showing N of M" when truncated.

## Wire into existing UI (B2.5, B2.6)

Minimum-touch edits:

- `src/components/chem/StereoLab.tsx` — read counts/classification from `analyzeStereochemistry`. Drop heuristic `approximate` flag unless RDKit failed.
- `src/components/chem/IsomerismLab.tsx` — replace any demo/placeholder isomer list with `enumerateStereoisomers(currentMolecule, …)`. If enumeration unavailable for this structure, render the empty state: **"Exact stereoisomer generation unavailable for this structure."** No fake fallback.
- `src/components/chem/Viewer.tsx` / `Molecule3D.tsx` — only ensure the selected isomer prop is the enumerated `Molecule`, not an index into demo data.
- `src/lib/stereochem.ts` — kept; new `stereochemSummary` becomes a thin adapter that prefers the RDKit report and only falls back to the old heuristic with an `approximate: true` badge if RDKit threw.

No visual redesign, no new panels.

## Validation suite (B2.7)

Add `src/services/chemistry/__tests__/stereochemistry.test.ts` (Vitest) with expected outputs:

| Compound | centers | E/Z | optical | geometric | total | class |
|---|---|---|---|---|---|---|
| methane | 0 | 0 | 0 | 0 | 0 | achiral |
| benzene | 0 | 0 | 0 | 0 | 0 | achiral |
| 2-butanol | 1 | 0 | 2 | 0 | 2 | chiral-single |
| lactic acid | 1 | 0 | 2 | 0 | 2 | chiral-single |
| tartaric acid | 2 | 0 | 2 (+1 meso) | 0 | 3 | meso present |
| cis/trans-2-butene | 0 | 1 | 0 | 2 | 2 | achiral |
| 1,2-dichloroethene | 0 | 1 | 0 | 2 | 2 | achiral |
| cyclohexene | 0 | 0 | 0 | 0 | 0 | achiral |
| cyclooctene | 0 | 1 (E/Z both stable in C8 ring) | 0 | 2 | 2 | achiral |

Tests load RDKit once in a `beforeAll`, run each compound through `analyzeStereochemistry` + `enumerateStereoisomers`, and assert exact counts. Run via `bunx vitest run`.

## Performance

- Single cached `Promise<RDKitModule>`; never re-init.
- Enumeration capped, memoized per canonical SMILES.
- Wasm copy lives in `public/wasm/` so Vite serves it with `application/wasm`; no SSR/Worker import.

## Acceptance

- Cyclooctene shows real E/Z forms only.
- Optical counts are RDKit-derived; never silently 0 when centers exist.
- Every analysis call uses the exact current `Molecule`.
- No placeholder/demo molecules anywhere in isomer viewers.
- Meso detection correct for tartaric acid.
- Stereo Lab numbers === engine output.
- Vitest suite passes for all listed compounds.
- App startup unaffected (RDKit lazy).
