import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  X, Undo2, Redo2, Trash2, Eraser, MousePointer2, Sparkles, Loader2,
  Hexagon, Pentagon, Triangle, Square, Hand, Atom as AtomIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import PeriodicTable from "./PeriodicTable";
import { ELEMENT_DATA, type Element, type Molecule } from "@/data/molecules";
import { build3D, describeBuilderGraph, validateBuilderState, type BuilderGraphDebug } from "@/lib/builderGraph";

type BondOrder = 1 | 2 | 3;
type RingSpec = { sides: 3 | 4 | 5 | 6 | 7 | 8; aromatic?: boolean };
type Tool =
  | { kind: "atom"; el: Element }
  | { kind: "bond"; order: BondOrder; aromatic?: boolean }
  | { kind: "ring"; spec: RingSpec }
  | { kind: "select" }
  | { kind: "erase" };

interface NodeA { id: number; el: Element; x: number; y: number }
interface EdgeB { id: number; a: number; b: number; order: BondOrder; aromatic?: boolean }
interface State { nodes: NodeA[]; edges: EdgeB[] }

const ATOMS: Element[] = ["C", "H", "O", "N", "Cl", "Br", "F", "S"];
const VALENCE: Record<Element, number> = { H: 1, C: 4, N: 3, O: 2, F: 1, Cl: 1, Br: 1, S: 2 };
const BOND_LEN = 46;
// Touch-friendly hit radii — large enough for finger taps without
// causing wrong-atom selection in dense ring structures.
const SNAP = 32;
const EDGE_HIT = 22;
const NODE_HIT = 22;

let _id = 1;
const nid = () => _id++;

function clone(s: State): State {
  return { nodes: s.nodes.map(n => ({ ...n })), edges: s.edges.map(e => ({ ...e })) };
}

function formula(state: State): string {
  const counts: Partial<Record<Element, number>> = {};
  for (const n of state.nodes) counts[n.el] = (counts[n.el] || 0) + 1;
  let implicitH = 0;
  for (const n of state.nodes) {
    if (n.el === "H") continue;
    let used = 0;
    for (const e of state.edges) if (e.a === n.id || e.b === n.id) used += e.order;
    implicitH += Math.max(0, VALENCE[n.el] - used);
  }
  counts.H = (counts.H || 0) + implicitH;
  const order: Element[] = ["C", "H", "N", "O", "F", "Cl", "Br", "S"];
  return order.filter(e => counts[e]).map(e => (counts[e]! > 1 ? `${e}${counts[e]}` : e)).join("");
}

function nodeAt(state: State, x: number, y: number, r = SNAP) {
  let best: NodeA | null = null;
  let bestD = r;
  for (const n of state.nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function edgeAt(state: State, x: number, y: number, r = EDGE_HIT) {
  for (const e of state.edges) {
    const a = state.nodes.find(n => n.id === e.a);
    const b = state.nodes.find(n => n.id === e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
    const px = a.x + dx * t, py = a.y + dy * t;
    if (Math.hypot(px - x, py - y) < r) return e;
  }
  return null;
}

interface Props {
  onClose: () => void;
  onGenerate: (mol: Molecule) => void;
}

export default function Builder({ onClose, onGenerate }: Props) {
  const [tool, setTool] = useState<Tool>({ kind: "atom", el: "C" });
  const [state, setState] = useState<State>({ nodes: [], edges: [] });
  const [history, setHistory] = useState<State[]>([]);
  const [future, setFuture] = useState<State[]>([]);
  const [busy, setBusy] = useState(false);
  const [ptOpen, setPtOpen] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<
    | { kind: "node"; id: number; ox: number; oy: number }
    | { kind: "bond-from"; id: number; tx: number; ty: number }
    | { kind: "atom-attach"; anchorId: number; tx: number; ty: number; el: Element }
    | { kind: "ring-preview"; x: number; y: number }
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | null
  >(null);
  const [warn, setWarn] = useState<string | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (msg: string) => {
    setWarn(msg);
    if (warnTimer.current) clearTimeout(warnTimer.current);
    warnTimer.current = setTimeout(() => setWarn(null), 1800);
  };
  const usedValence = (s: State, nodeId: number) => {
    let u = 0;
    for (const e of s.edges) if (e.a === nodeId || e.b === nodeId) u += e.order;
    return u;
  };
  const [selected, setSelected] = useState<{ kind: "node" | "edge"; id: number } | null>(null);
  // Two-step bond mode: first tap stores source atom id; second tap on
  // another atom creates the bond. Reliable on mobile vs. drag accuracy.
  const [pendingBond, setPendingBond] = useState<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d: number; k: number; cx: number; cy: number; vx: number; vy: number } | null>(null);

  const f = useMemo(() => formula(state), [state]);
  const heavyCount = state.nodes.filter(n => n.el !== "H").length;
  const graphDebug: BuilderGraphDebug = useMemo(() => describeBuilderGraph(state), [state]);

  // One-tap QA / teaching presets
  const loadPreset = (name: "ethanol" | "acetic-acid" | "2-butanol" | "benzene" | "chlorobenzene" | "cyclohexene") => {
    const cx = 200, cy = 200;
    const mk = (el: Element, x: number, y: number): NodeA => ({ id: nid(), el, x, y });
    let nodes: NodeA[] = [];
    const edges: EdgeB[] = [];
    if (name === "ethanol") {
      const a = [mk("C", cx - BOND_LEN, cy), mk("C", cx, cy), mk("O", cx + BOND_LEN, cy)];
      nodes = a;
      edges.push({ id: nid(), a: a[0].id, b: a[1].id, order: 1 });
      edges.push({ id: nid(), a: a[1].id, b: a[2].id, order: 1 });
    } else if (name === "acetic-acid") {
      const a = [mk("C", cx - BOND_LEN, cy), mk("C", cx, cy),
                 mk("O", cx + BOND_LEN * 0.5, cy - BOND_LEN * 0.86), mk("O", cx + BOND_LEN, cy)];
      nodes = a;
      edges.push({ id: nid(), a: a[0].id, b: a[1].id, order: 1 });
      edges.push({ id: nid(), a: a[1].id, b: a[2].id, order: 2 });
      edges.push({ id: nid(), a: a[1].id, b: a[3].id, order: 1 });
    } else if (name === "2-butanol") {
      const a = [mk("C", cx - BOND_LEN * 1.5, cy), mk("C", cx - BOND_LEN * 0.5, cy),
                 mk("C", cx + BOND_LEN * 0.5, cy), mk("C", cx + BOND_LEN * 1.5, cy),
                 mk("O", cx - BOND_LEN * 0.5, cy - BOND_LEN)];
      nodes = a;
      edges.push({ id: nid(), a: a[0].id, b: a[1].id, order: 1 });
      edges.push({ id: nid(), a: a[1].id, b: a[2].id, order: 1 });
      edges.push({ id: nid(), a: a[2].id, b: a[3].id, order: 1 });
      edges.push({ id: nid(), a: a[1].id, b: a[4].id, order: 1 });
    } else {
      const r = (BOND_LEN / 2) / Math.sin(Math.PI / 6);
      const ring: NodeA[] = [];
      for (let i = 0; i < 6; i++) {
        const ang = -Math.PI / 2 + (i / 6) * Math.PI * 2;
        ring.push(mk("C", cx + Math.cos(ang) * r, cy + Math.sin(ang) * r));
      }
      nodes = [...ring];
      const aromatic = name === "benzene" || name === "chlorobenzene";
      for (let i = 0; i < 6; i++) {
        let order: BondOrder = 1;
        if (aromatic) order = i % 2 === 0 ? 2 : 1;
        else if (name === "cyclohexene" && i === 0) order = 2;
        edges.push({ id: nid(), a: ring[i].id, b: ring[(i + 1) % 6].id, order });
      }
      if (name === "chlorobenzene") {
        const a0 = -Math.PI / 2;
        const cl = mk("Cl", cx + Math.cos(a0) * (r + BOND_LEN), cy + Math.sin(a0) * (r + BOND_LEN));
        nodes.push(cl);
        edges.push({ id: nid(), a: ring[0].id, b: cl.id, order: 1 });
      }
    }
    commit({ nodes, edges });
  };

  const commit = useCallback((next: State, options: { validateChemistry?: boolean } = {}) => {
    if (options.validateChemistry) {
      const validation = validateBuilderState(next);
      if (!validation.valid) {
        console.warn("Builder chemistry validation blocked graph mutation", validation.errors, next);
        flash("This bond arrangement is chemically invalid.");
        return false;
      }
    }
    setHistory(h => [...h.slice(-50), state]);
    setFuture([]);
    setState(next);
    return true;
  }, [state]);

  const undo = () => {
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture(fu => [state, ...fu]);
      setState(prev);
      return h.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture(fu => {
      if (!fu.length) return fu;
      const nx = fu[0];
      setHistory(h => [...h, state]);
      setState(nx);
      return fu.slice(1);
    });
  };
  const clear = () => commit({ nodes: [], edges: [] });

  // Convert client coords to SVG world coords (account for pan/zoom)
  const toWorld = (cx: number, cy: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((cx - rect.left) / rect.width) * 400;
    const sy = ((cy - rect.top) / rect.height) * 400;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  };

  // ---- Ring placement (handles fusion if dropped on atom or edge) ----
  const placeRing = (cx: number, cy: number, spec: RingSpec, anchorEdge?: EdgeB | null, anchorNode?: NodeA | null) => {
    const next = clone(state);
    const r = (BOND_LEN / 2) / Math.sin(Math.PI / spec.sides);

    // ---- Edge fusion: share two atoms + the bond ----
    if (anchorEdge) {
      const a = next.nodes.find(n => n.id === anchorEdge.a)!;
      const b = next.nodes.find(n => n.id === anchorEdge.b)!;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      // perpendicular outward (away from center of mass)
      let nx = -dy / L, ny = dx / L;
      const cmx = next.nodes.reduce((s, n) => s + n.x, 0) / next.nodes.length;
      const cmy = next.nodes.reduce((s, n) => s + n.y, 0) / next.nodes.length;
      if ((mx - cmx) * nx + (my - cmy) * ny < 0) { nx = -nx; ny = -ny; }
      const apo = (BOND_LEN / 2) / Math.tan(Math.PI / spec.sides);
      const ringCx = mx + nx * apo;
      const ringCy = my + ny * apo;
      const startAng = Math.atan2(a.y - ringCy, a.x - ringCx);
      const ids: number[] = [a.id];
      for (let i = 1; i < spec.sides; i++) {
        const ang = startAng - (i / spec.sides) * Math.PI * 2;
        if (i === spec.sides - 1) { ids.push(b.id); break; }
        const px = ringCx + Math.cos(ang) * r, py = ringCy + Math.sin(ang) * r;
        // Auto-merge: if a new ring vertex coincides with an existing atom,
        // reuse it instead of creating a duplicate (multi-atom fusion).
        const overlap = nodeAt(next, px, py, SNAP * 0.8);
        if (overlap && !ids.includes(overlap.id)) {
          ids.push(overlap.id);
        } else {
          const id = nid();
          ids.push(id);
          next.nodes.push({ id, el: "C", x: px, y: py });
        }
      }
      for (let i = 0; i < spec.sides; i++) {
        const A = ids[i], B = ids[(i + 1) % spec.sides];
        if (A === B) continue;
        const exists = next.edges.some(ed =>
          (ed.a === A && ed.b === B) || (ed.b === A && ed.a === B));
        if (exists) continue;
        const order: BondOrder = spec.aromatic && i % 2 === 1 ? 2 : 1;
        next.edges.push({ id: nid(), a: A, b: B, order });
      }
      commit(next, { validateChemistry: true });
      return;
    }

    let startAngle = -Math.PI / 2;
    let ringCx = cx, ringCy = cy;
    const ids: number[] = [];

    // ---- Spiro / atom fusion: share the anchor atom, orient away from its neighbours ----
    if (anchorNode) {
      let nx = 0, ny = 0, count = 0;
      for (const ed of next.edges) {
        const other = ed.a === anchorNode.id ? next.nodes.find(n => n.id === ed.b)
                   : ed.b === anchorNode.id ? next.nodes.find(n => n.id === ed.a) : null;
        if (other) { nx += anchorNode.x - other.x; ny += anchorNode.y - other.y; count++; }
      }
      let dirX = 0, dirY = -1;
      if (count > 0) {
        const dL = Math.hypot(nx, ny);
        if (dL > 0.01) { dirX = nx / dL; dirY = ny / dL; }
      }
      ringCx = anchorNode.x + dirX * r;
      ringCy = anchorNode.y + dirY * r;
      startAngle = Math.atan2(anchorNode.y - ringCy, anchorNode.x - ringCx);
      ids.push(anchorNode.id);
    }

    for (let i = ids.length; i < spec.sides; i++) {
      const ang = startAngle + (i / spec.sides) * Math.PI * 2;
      const px = ringCx + Math.cos(ang) * r, py = ringCy + Math.sin(ang) * r;
      // Auto-merge any vertex that lands on an existing atom (fusion).
      const overlap = nodeAt(next, px, py, SNAP * 0.8);
      if (overlap && !ids.includes(overlap.id)) {
        ids.push(overlap.id);
      } else {
        const id = nid();
        ids.push(id);
        next.nodes.push({ id, el: "C", x: px, y: py });
      }
    }
    for (let i = 0; i < spec.sides; i++) {
      const A = ids[i], B = ids[(i + 1) % spec.sides];
      if (A === B) continue;
      const exists = next.edges.some(ed =>
        (ed.a === A && ed.b === B) || (ed.b === A && ed.a === B));
      if (exists) continue;
      const order: BondOrder = spec.aromatic && i % 2 === 0 ? 2 : 1;
      next.edges.push({ id: nid(), a: A, b: B, order });
    }
    commit(next, { validateChemistry: true });
  };

  // ---- Pointer handling on SVG ----
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointerStart.current = { x: e.clientX, y: e.clientY };

    if (pointers.current.size === 2) {
      // start pinch
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      pinchRef.current = {
        d: Math.hypot(dx, dy),
        k: view.k,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        vx: view.x, vy: view.y,
      };
      setDrag(null);
      return;
    }

    const w = toWorld(e.clientX, e.clientY);
    const hitNode = nodeAt(state, w.x, w.y);
    const hitEdge = !hitNode ? edgeAt(state, w.x, w.y) : null;

    if (tool.kind === "select") {
      if (hitNode) {
        setSelected({ kind: "node", id: hitNode.id });
        setDrag({ kind: "node", id: hitNode.id, ox: w.x - hitNode.x, oy: w.y - hitNode.y });
      } else if (hitEdge) {
        setSelected({ kind: "edge", id: hitEdge.id });
      } else {
        setSelected(null);
        setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      }
      return;
    }

    if (tool.kind === "erase") {
      if (hitNode) {
        const next = clone(state);
        next.nodes = next.nodes.filter(n => n.id !== hitNode.id);
        next.edges = next.edges.filter(ed => ed.a !== hitNode.id && ed.b !== hitNode.id);
        commit(next);
      } else if (hitEdge) {
        const next = clone(state);
        next.edges = next.edges.filter(ed => ed.id !== hitEdge.id);
        commit(next);
      }
      return;
    }

    if (tool.kind === "atom") {
      // Resolve a snap anchor: existing atom > bond endpoint > nearest atom within 2× radius.
      let anchor: NodeA | null = hitNode;
      if (!anchor && hitEdge) {
        const a = state.nodes.find(n => n.id === hitEdge.a)!;
        const b = state.nodes.find(n => n.id === hitEdge.b)!;
        anchor = Math.hypot(a.x - w.x, a.y - w.y) < Math.hypot(b.x - w.x, b.y - w.y) ? a : b;
      }
      if (!anchor) anchor = nodeAt(state, w.x, w.y, SNAP * 2.2);

      if (anchor) {
        // Reject if anchor valence is already saturated
        if (usedValence(state, anchor.id) >= VALENCE[anchor.el]) {
          flash(`${anchor.el} already at full valence (${VALENCE[anchor.el]})`);
          return;
        }
        setDrag({ kind: "atom-attach", anchorId: anchor.id, tx: w.x, ty: w.y, el: tool.el });
      } else if (state.nodes.length === 0) {
        // Seed the first atom on an empty canvas
        const next = clone(state);
        const id = nid();
        next.nodes.push({ id, el: tool.el, x: w.x, y: w.y });
        commit(next);
      } else {
        flash("Tap on or near an existing atom to attach");
      }
      return;
    }

    if (tool.kind === "bond") {
      if (hitEdge) {
        // cycle bond order
        const next = clone(state);
        const ed = next.edges.find(x => x.id === hitEdge.id)!;
        ed.order = ((ed.order % 3) + 1) as BondOrder;
        commit(next);
        return;
      }
      let from = hitNode;
      if (!from) {
        const next = clone(state);
        const id = nid();
        next.nodes.push({ id, el: "C", x: w.x, y: w.y });
        setState(next); // tentative; commit on pointerup
        from = next.nodes[next.nodes.length - 1];
      }
      setDrag({ kind: "bond-from", id: from.id, tx: w.x, ty: w.y });
      return;
    }

    if (tool.kind === "ring") {
      setDrag({ kind: "ring-preview", x: w.x, y: w.y });
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchRef.current) {
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      const d = Math.hypot(dx, dy);
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      const ratio = d / pinchRef.current.d;
      const newK = Math.max(0.4, Math.min(4, pinchRef.current.k * ratio));
      const rect = svgRef.current!.getBoundingClientRect();
      const px = ((pinchRef.current.cx - rect.left) / rect.width) * 400;
      const py = ((pinchRef.current.cy - rect.top) / rect.height) * 400;
      const npx = ((cx - rect.left) / rect.width) * 400;
      const npy = ((cy - rect.top) / rect.height) * 400;
      // keep pinch center stable
      const wx = (px - pinchRef.current.vx) / pinchRef.current.k;
      const wy = (py - pinchRef.current.vy) / pinchRef.current.k;
      setView({ k: newK, x: npx - wx * newK, y: npy - wy * newK });
      return;
    }

    if (!drag) return;
    if (drag.kind === "pan") {
      const rect = svgRef.current!.getBoundingClientRect();
      const sx = ((e.clientX - drag.sx) / rect.width) * 400;
      const sy = ((e.clientY - drag.sy) / rect.height) * 400;
      setView(v => ({ ...v, x: drag.vx + sx, y: drag.vy + sy }));
      return;
    }
    const w = toWorld(e.clientX, e.clientY);

    if (drag.kind === "node") {
      setState(s => {
        const ns = clone(s);
        const n = ns.nodes.find(n => n.id === drag.id);
        if (n) { n.x = w.x - drag.ox; n.y = w.y - drag.oy; }
        return ns;
      });
    } else if (drag.kind === "bond-from") {
      setDrag({ ...drag, tx: w.x, ty: w.y });
    } else if (drag.kind === "atom-attach") {
      setDrag({ ...drag, tx: w.x, ty: w.y });
    } else if (drag.kind === "ring-preview") {
      setDrag({ kind: "ring-preview", x: w.x, y: w.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;

    if (!drag) return;
    if (drag.kind === "pan") { setDrag(null); return; }

    const w = toWorld(e.clientX, e.clientY);

    if (drag.kind === "node") {
      // snap to history (commit moved position)
      commit(state);
      setDrag(null);
      return;
    }

    if (drag.kind === "bond-from" && tool.kind === "bond") {
      const next = clone(state);
      const fromNode = next.nodes.find(n => n.id === drag.id);
      if (!fromNode) { setDrag(null); return; }

      // Detect "tap, no drag" so we can offer two-step tap-to-bond on mobile.
      const startPx = pointerStart.current;
      const movedPx = startPx ? Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y) : 0;
      const isTap = movedPx < 6;

      let target = nodeAt(next, w.x, w.y);
      if (target && target.id === fromNode.id) target = null;

      if (isTap && !target) {
        // First tap on an atom → arm pending bond. Second tap on another atom completes it.
        if (pendingBond !== null && pendingBond !== fromNode.id) {
          const src = next.nodes.find(n => n.id === pendingBond);
          if (src) {
            const existing = next.edges.find(
              ed => (ed.a === src.id && ed.b === fromNode.id) || (ed.b === src.id && ed.a === fromNode.id),
            );
            if (existing) existing.order = tool.order;
            else next.edges.push({ id: nid(), a: src.id, b: fromNode.id, order: tool.order });
            commit(next);
            setPendingBond(null);
            setDrag(null);
            return;
          }
        }
        setPendingBond(fromNode.id);
        setDrag(null);
        return;
      }

      // Any committing action clears pending state.
      setPendingBond(null);

      if (!target) {
        // Place new C atom at end. If user just tapped (no drag) so L≈0,
        // pick a direction that avoids overlapping existing neighbours.
        const dx = w.x - fromNode.x, dy = w.y - fromNode.y;
        const L = Math.hypot(dx, dy);
        let ux: number, uy: number, dist: number;
        if (L < 6) {
          let nbx = 0, nby = 0, count = 0;
          for (const ed of next.edges) {
            const other = ed.a === fromNode.id ? next.nodes.find(n => n.id === ed.b)
                       : ed.b === fromNode.id ? next.nodes.find(n => n.id === ed.a) : null;
            if (other) { nbx += other.x - fromNode.x; nby += other.y - fromNode.y; count++; }
          }
          if (count === 0) { ux = 1; uy = 0; }
          else {
            const ang = Math.atan2(-nby, -nbx);
            ux = Math.cos(ang); uy = Math.sin(ang);
          }
          dist = BOND_LEN;
        } else {
          ux = dx / L; uy = dy / L;
          dist = Math.max(BOND_LEN, L);
        }
        const id = nid();
        next.nodes.push({ id, el: "C", x: fromNode.x + ux * dist, y: fromNode.y + uy * dist });
        target = next.nodes[next.nodes.length - 1];
      }
      const existing = next.edges.find(
        e => (e.a === fromNode.id && e.b === target!.id) || (e.b === fromNode.id && e.a === target!.id),
      );
      if (existing) existing.order = tool.order;
      else next.edges.push({ id: nid(), a: fromNode.id, b: target.id, order: tool.order });
      commit(next);
      setDrag(null);
      return;
    }

    if (drag.kind === "atom-attach" && tool.kind === "atom") {
      const next = clone(state);
      const anchor = next.nodes.find(n => n.id === drag.anchorId);
      if (!anchor) { setDrag(null); return; }
      if (usedValence(next, anchor.id) >= VALENCE[anchor.el]) {
        flash(`${anchor.el} already at full valence`);
        setDrag(null);
        return;
      }
      // Direction: pointer drag direction, else away from existing neighbours.
      const dx = w.x - anchor.x, dy = w.y - anchor.y;
      const L = Math.hypot(dx, dy);
      let ux: number, uy: number;
      if (L > 8) {
        ux = dx / L; uy = dy / L;
      } else {
        let nbx = 0, nby = 0, count = 0;
        for (const ed of next.edges) {
          const other = ed.a === anchor.id ? next.nodes.find(n => n.id === ed.b)
                     : ed.b === anchor.id ? next.nodes.find(n => n.id === ed.a) : null;
          if (other) { nbx += other.x - anchor.x; nby += other.y - anchor.y; count++; }
        }
        if (count === 0) { ux = 1; uy = 0; }
        else {
          const ang = Math.atan2(-nby, -nbx);
          // Stagger by neighbour count so 2nd/3rd attachments don't overlap
          const used = usedValence(next, anchor.id);
          const off = (used % 2 === 0 ? 1 : -1) * (used * 0.5);
          ux = Math.cos(ang + off); uy = Math.sin(ang + off);
        }
      }
      const id = nid();
      const nx = anchor.x + ux * BOND_LEN;
      const ny = anchor.y + uy * BOND_LEN;
      // Snap to an existing distant atom if we landed on one (extend ring/bridge)
      const landing = nodeAt(next, nx, ny, SNAP * 0.7);
      if (landing && landing.id !== anchor.id) {
        const exists = next.edges.find(ed =>
          (ed.a === anchor.id && ed.b === landing.id) || (ed.b === anchor.id && ed.a === landing.id));
        if (!exists) next.edges.push({ id: nid(), a: anchor.id, b: landing.id, order: 1 });
      } else {
        next.nodes.push({ id, el: drag.el, x: nx, y: ny });
        next.edges.push({ id: nid(), a: anchor.id, b: id, order: 1 });
      }
      commit(next);
      setDrag(null);
      return;
    }

    if (drag.kind === "ring-preview" && tool.kind === "ring") {
      const hitNode = nodeAt(state, w.x, w.y);
      const hitEdge = !hitNode ? edgeAt(state, w.x, w.y) : null;
      placeRing(w.x, w.y, tool.spec, hitEdge, hitNode);
      setDrag(null);
      return;
    }

    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * 400;
    const sy = ((e.clientY - rect.top) / rect.height) * 400;
    const wx = (sx - view.x) / view.k;
    const wy = (sy - view.y) / view.k;
    const nk = Math.max(0.4, Math.min(4, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView({ k: nk, x: sx - wx * nk, y: sy - wy * nk });
  };

  // Delete via keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selected) return;
        const next = clone(state);
        if (selected.kind === "node") {
          next.nodes = next.nodes.filter(n => n.id !== selected.id);
          next.edges = next.edges.filter(ed => ed.a !== selected.id && ed.b !== selected.id);
        } else {
          next.edges = next.edges.filter(ed => ed.id !== selected.id);
        }
        commit(next);
        setSelected(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, state]);

  const generate = async () => {
    if (state.nodes.length === 0) return;
    const validation = validateBuilderState(state);
    if (!validation.valid) {
      flash(validation.errors[0] ?? "Invalid molecular graph");
      return;
    }
    setBusy(true);
    try {
      await new Promise(r => setTimeout(r, 120));
      const mol = build3D(state, `Custom ${f}`);
      onGenerate(mol);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not generate this molecular graph");
    } finally {
      setBusy(false);
    }
  };

  // ---- Render helpers ----
  const renderEdges = () => state.edges.map(e => {
    const a = state.nodes.find(n => n.id === e.a);
    const b = state.nodes.find(n => n.id === e.b);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const offsets = e.order === 1 ? [0] : e.order === 2 ? [-3.2, 3.2] : [-5, 0, 5];
    const isSel = selected?.kind === "edge" && selected.id === e.id;
    return (
      <g key={e.id}>
        {/* hit area */}
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={22} />
        {offsets.map((o, i) => (
          <line key={i}
            x1={a.x + nx * o} y1={a.y + ny * o}
            x2={b.x + nx * o} y2={b.y + ny * o}
            stroke={isSel ? "hsl(var(--neon-cyan))" : "rgba(255,255,255,0.85)"}
            strokeWidth={isSel ? 2.4 : 1.8} strokeLinecap="round"
          />
        ))}
      </g>
    );
  });

  const renderNodes = () => state.nodes.map(n => {
    const showLabel = n.el !== "C" || state.edges.filter(e => e.a === n.id || e.b === n.id).length === 0;
    const isSel = selected?.kind === "node" && selected.id === n.id;
    const isBondSource = drag?.kind === "bond-from" && drag.id === n.id;
    const isPendingBond = pendingBond === n.id;
    const ringStroke = isSel ? "hsl(var(--neon-cyan))"
      : isBondSource || isPendingBond ? "hsl(var(--neon-magenta))"
      : null;
    const color = ELEMENT_DATA[n.el].color;
    return (
      <g key={n.id} style={{ cursor: "grab" }}>
        {(isBondSource || isPendingBond) && (
          <circle cx={n.x} cy={n.y} r={16} fill="none" stroke="hsl(var(--neon-magenta))" strokeWidth={1.4} strokeDasharray="3 3" opacity={0.8} />
        )}
        {showLabel ? (
          <>
            <circle cx={n.x} cy={n.y} r={11} fill="#0b0d18" stroke={ringStroke ?? color} strokeWidth={ringStroke ? 2.4 : 1.4} />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={n.el.length > 1 ? 10 : 12} fontWeight={700} fill={color}>
              {n.el}
            </text>
          </>
        ) : (
          <circle cx={n.x} cy={n.y} r={isSel ? 5 : 2.5} fill={ringStroke ?? "transparent"} />
        )}
        {/* enlarged touch hit area */}
        <circle cx={n.x} cy={n.y} r={NODE_HIT} fill="transparent" />
      </g>
    );
  });

  const renderRingPreview = () => {
    if (!drag || drag.kind !== "ring-preview" || tool.kind !== "ring") return null;
    const spec = tool.spec;
    const r = (BOND_LEN / 2) / Math.sin(Math.PI / spec.sides);
    const pts: string[] = [];
    for (let i = 0; i < spec.sides; i++) {
      const ang = -Math.PI / 2 + (i / spec.sides) * Math.PI * 2;
      pts.push(`${drag.x + Math.cos(ang) * r},${drag.y + Math.sin(ang) * r}`);
    }
    const hitNode = nodeAt(state, drag.x, drag.y);
    const hitEdge = !hitNode ? edgeAt(state, drag.x, drag.y) : null;
    const hint = hitEdge ? "Fuse" : hitNode ? "Spiro" : "Place";
    return (
      <g pointerEvents="none">
        <polygon points={pts.join(" ")} fill="hsl(var(--neon-cyan) / 0.08)" stroke="hsl(var(--neon-cyan) / 0.7)" strokeDasharray="4 3" strokeWidth={1.4} />
        <text x={drag.x} y={drag.y - r - 6} textAnchor="middle" fontSize={10} fill="hsl(var(--neon-cyan))">{hint}</text>
      </g>
    );
  };

  const renderBondDrag = () => {
    if (!drag) return null;
    if (drag.kind === "bond-from") {
      const from = state.nodes.find(n => n.id === drag.id);
      if (!from) return null;
      return (
        <line x1={from.x} y1={from.y} x2={drag.tx} y2={drag.ty} stroke="hsl(var(--neon-cyan))" strokeWidth={1.6} strokeDasharray="4 3" pointerEvents="none" />
      );
    }
    if (drag.kind === "atom-attach") {
      const anchor = state.nodes.find(n => n.id === drag.anchorId);
      if (!anchor) return null;
      const dx = drag.tx - anchor.x, dy = drag.ty - anchor.y;
      const L = Math.hypot(dx, dy);
      const ux = L > 8 ? dx / L : 1, uy = L > 8 ? dy / L : 0;
      const gx = anchor.x + ux * BOND_LEN, gy = anchor.y + uy * BOND_LEN;
      const color = ELEMENT_DATA[drag.el].color;
      return (
        <g pointerEvents="none">
          <circle cx={anchor.x} cy={anchor.y} r={18} fill="none" stroke="hsl(var(--neon-magenta))" strokeWidth={1.4} strokeDasharray="3 3" opacity={0.9} />
          <line x1={anchor.x} y1={anchor.y} x2={gx} y2={gy} stroke="hsl(var(--neon-cyan))" strokeWidth={1.6} strokeDasharray="4 3" />
          <circle cx={gx} cy={gy} r={12} fill="#0b0d18" stroke={color} strokeWidth={1.8} opacity={0.85} />
          <text x={gx} y={gy + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={color} opacity={0.9}>{drag.el}</text>
        </g>
      );
    }
    return null;
  };

  const RingBtn = ({ sides, label, Icon }: { sides: 3 | 4 | 5 | 6 | 7 | 8; label: string; Icon?: React.ComponentType<{ className?: string }> }) => (
    <button
      onClick={() => setTool({ kind: "ring", spec: { sides } })}
      className={cn("h-9 rounded-lg border border-white/10 flex items-center justify-center gap-1 text-[10px] hover:scale-105 transition",
        tool.kind === "ring" && tool.spec.sides === sides && !tool.spec.aromatic && "neon-glow border-[hsl(var(--neon-cyan))]/60")}
      title={label}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {sides}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" onClick={onClose} />
      <div className="relative w-full max-w-6xl max-h-[96vh] glass rounded-3xl border border-white/10 shadow-[0_0_60px_hsl(var(--neon-cyan)/0.25)] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--neon-cyan))]">Lab · Workspace</div>
            <div className="text-lg font-bold neon-text">Molecule Builder</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setView({ x: 0, y: 0, k: 1 })} className="h-9 px-2 rounded-xl glass text-[11px] flex items-center gap-1 hover:scale-105 transition" title="Reset view">
              <Hand className="h-3.5 w-3.5" /> Reset
            </button>
            <button onClick={onClose} className="h-9 w-9 rounded-xl glass flex items-center justify-center hover:scale-105 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[230px_1fr] gap-0 flex-1 min-h-0">
          {/* Sidebar */}
          <div className="p-3 border-b md:border-b-0 md:border-r border-white/10 space-y-3 max-h-[34vh] md:max-h-none overflow-y-auto">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[9px] uppercase tracking-widest text-foreground/50">Atoms</div>
                <button
                  onClick={() => setPtOpen(true)}
                  className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-[hsl(var(--neon-cyan))]/40 text-[hsl(var(--neon-cyan))] hover:bg-[hsl(var(--neon-cyan))]/10 active:scale-95 transition flex items-center gap-1"
                  title="Open periodic table"
                >
                  <AtomIcon className="h-3 w-3" /> Table
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {ATOMS.map(el => (
                  <button key={el} onClick={() => setTool({ kind: "atom", el })}
                    className={cn("h-10 rounded-lg text-xs font-bold border border-white/10 transition active:scale-95 hover:scale-105",
                      tool.kind === "atom" && tool.el === el && "neon-glow border-[hsl(var(--neon-cyan))]/60")}
                    style={{ color: ELEMENT_DATA[el].color }} title={ELEMENT_DATA[el].name}>{el}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-foreground/50 mb-1.5">Bonds (drag, or tap A then tap B)</div>
              <div className="grid grid-cols-4 gap-1.5">
                {([1, 2, 3] as BondOrder[]).map(o => (
                  <button key={o} onClick={() => setTool({ kind: "bond", order: o })}
                    className={cn("h-9 rounded-lg text-xs font-bold border border-white/10 transition hover:scale-105",
                      tool.kind === "bond" && tool.order === o && "neon-glow border-[hsl(var(--neon-cyan))]/60")}
                    title={`Order ${o} — tap a bond to cycle`}>
                    {o === 1 ? "—" : o === 2 ? "═" : "≡"}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-foreground/40 mt-1">Tap an existing bond to cycle 1 → 2 → 3</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-foreground/50 mb-1.5">Rings (drop on atom/edge to fuse)</div>
              <div className="grid grid-cols-3 gap-1.5">
                <RingBtn sides={3} label="Triangle" Icon={Triangle} />
                <RingBtn sides={4} label="Square" Icon={Square} />
                <RingBtn sides={5} label="Pentagon" Icon={Pentagon} />
                <RingBtn sides={6} label="Hexagon" Icon={Hexagon} />
                <RingBtn sides={7} label="Heptagon" />
                <RingBtn sides={8} label="Octagon" />
              </div>
              <button
                onClick={() => setTool({ kind: "ring", spec: { sides: 6, aromatic: true } })}
                className={cn("mt-1.5 w-full h-9 rounded-lg text-[11px] font-bold border border-white/10 hover:scale-105 transition",
                  tool.kind === "ring" && tool.spec.sides === 6 && tool.spec.aromatic && "neon-glow border-[hsl(var(--neon-cyan))]/60")}
              >
                Benzene (Aromatic)
              </button>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-foreground/50 mb-1.5">Tools</div>
              <div className="grid grid-cols-4 gap-1.5">
                <button onClick={() => setTool({ kind: "select" })} className={cn("h-9 rounded-lg border border-white/10 flex items-center justify-center hover:scale-105 transition", tool.kind === "select" && "neon-glow")} title="Select / move"><MousePointer2 className="h-4 w-4" /></button>
                <button onClick={() => setTool({ kind: "erase" })} className={cn("h-9 rounded-lg border border-white/10 flex items-center justify-center hover:scale-105 transition", tool.kind === "erase" && "neon-glow")} title="Erase"><Eraser className="h-4 w-4" /></button>
                <button onClick={undo} className="h-9 rounded-lg border border-white/10 flex items-center justify-center hover:scale-105 transition" title="Undo"><Undo2 className="h-4 w-4" /></button>
                <button onClick={redo} className="h-9 rounded-lg border border-white/10 flex items-center justify-center hover:scale-105 transition" title="Redo"><Redo2 className="h-4 w-4" /></button>
              </div>
              <button onClick={clear} className="mt-1.5 w-full h-9 rounded-lg border border-white/10 flex items-center justify-center gap-1.5 text-[11px] hover:border-red-400/40 hover:text-red-300 transition">
                <Trash2 className="h-3.5 w-3.5" /> Clear canvas
              </button>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-foreground/50 mb-1.5">Presets (QA / teaching)</div>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  ["ethanol", "Ethanol"],
                  ["acetic-acid", "Acetic acid"],
                  ["2-butanol", "2-Butanol"],
                  ["benzene", "Benzene"],
                  ["chlorobenzene", "Chlorobenzene"],
                  ["cyclohexene", "Cyclohexene"],
                ] as const).map(([k, label]) => (
                  <button key={k}
                    onClick={() => loadPreset(k)}
                    className="h-8 rounded-lg border border-white/10 text-[10px] hover:border-[hsl(var(--neon-cyan))]/50 hover:scale-105 active:scale-95 transition">
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-foreground/40 leading-relaxed border-t border-white/5 pt-2">
              <b>Tips:</b> <b>Atom tool</b> — tap on/near an existing atom to attach (drag to set direction). First atom on an empty canvas seeds the structure. <b>Bond tool</b> — drag A→B, or tap A then tap B. Tap a bond to cycle 1→2→3. Drop a ring on an edge to fuse. Pinch to zoom.
            </div>
            <details className="text-[10px] text-foreground/50 leading-relaxed border-t border-white/5 pt-2" open>
              <summary className="cursor-pointer text-[9px] uppercase tracking-widest text-[hsl(var(--neon-cyan))]">Graph Debug</summary>
              <div className="mt-2 space-y-1 font-mono break-words max-h-48 overflow-y-auto pr-1">
                <div>atoms: {graphDebug.atomCount} · bonds: {graphDebug.bondCount} · rings: {graphDebug.ringCount}</div>
                <div>rings: {graphDebug.rings.length ? graphDebug.rings.map((ring, i) => `R${i + 1}[${ring.join("-")}]`).join(" ") : "—"}</div>
                <div>atom rings: {Object.entries(graphDebug.atomRingMembership).map(([id, rings]) => `${id}:${rings.length ? rings.join("/") : "—"}`).join(" ") || "—"}</div>
                <div>bond rings: {Object.entries(graphDebug.bondRingMembership).map(([id, rings]) => `${id}:${rings.length ? rings.join("/") : "—"}`).join(" ") || "—"}</div>
                <div>adjacency: {graphDebug.adjacencyList.join(" | ") || "—"}</div>
                {[...graphDebug.errors, ...graphDebug.warnings].map((msg) => <div key={msg} className="text-amber-200">{msg}</div>)}
              </div>
            </details>
          </div>

          {/* Canvas */}
          <div className="relative flex-1 min-h-[55vh]">
            {warn && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-lg glass border border-amber-400/40 text-[11px] text-amber-200 shadow-lg pointer-events-none animate-fade-in">
                {warn}
              </div>
            )}
            <svg
              ref={svgRef}
              viewBox="0 0 400 400"
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              className="w-full h-full bg-[radial-gradient(circle_at_center,hsl(var(--neon-cyan)/0.06),transparent_60%)] touch-none select-none"
              style={{ display: "block" }}
            >
              <defs>
                <pattern id="bgrid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="400" height="400" fill="url(#bgrid)" />
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {renderEdges()}
                {renderNodes()}
                {renderRingPreview()}
                {renderBondDrag()}
                {state.nodes.length === 0 && (
                  <text x="200" y="200" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="13">
                    Tap to place atom · Drag from atom (bond tool) · Drop a ring anywhere
                  </text>
                )}
              </g>
            </svg>

            <div className="absolute left-3 bottom-3 right-3 flex items-center justify-between gap-2 glass rounded-xl px-3 py-2">
              <div className="text-[11px] flex items-center gap-3 min-w-0 flex-1 truncate">
                <span><span className="text-foreground/50 uppercase tracking-widest text-[9px] mr-2">Formula</span><span className="font-mono">{f || "—"}</span></span>
                <span className="text-foreground/40 text-[10px]">{heavyCount} heavy · {state.edges.length} bond{state.edges.length === 1 ? "" : "s"}</span>
              </div>
              <button onClick={generate} disabled={busy || state.nodes.length === 0}
                className="rounded-lg px-3 py-1.5 text-[11px] font-semibold bg-[hsl(var(--neon-cyan))]/15 border border-[hsl(var(--neon-cyan))]/40 hover:bg-[hsl(var(--neon-cyan))]/25 transition flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate 3D
              </button>
            </div>
          </div>
        </div>
      </div>
      {ptOpen && (
        <PeriodicTable
          current={tool.kind === "atom" ? tool.el : "C"}
          onSelect={(el) => { setTool({ kind: "atom", el }); setPtOpen(false); }}
          onClose={() => setPtOpen(false)}
        />
      )}
    </div>
  );
}
