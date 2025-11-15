import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Square,
  AlertCircle,
  Play,
  Trash2,
  Plus,
  RotateCcw,
  Save,
  Upload,
  Download,
  Image as ImageIcon,
  SunMedium,
  Moon,
  Info,
} from "lucide-react";

// ----------------------------
// Types
// ----------------------------
interface Proc {
  id: string;
  x: number;
  y: number;
  allocated: string[]; // resource ids
  requesting: string[]; // resource ids
}

interface Res {
  id: string;
  x: number;
  y: number;
  total: number;
  available: number;
}

type EdgeType = "request" | "allocation";

interface Edge {
  id: string;
  from: string; // node id
  to: string; // node id
  fromType: "process" | "resource";
  toType: "process" | "resource";
  type: EdgeType;
}

// ----------------------------
// Helpers
// ----------------------------
const dl = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const prettyDate = () =>
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// Control point for a nice curve between two points
const quadControl = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  // perpendicular offset
  const ox = (-dy / len) * 40;
  const oy = (dx / len) * 40;
  return { cx: mx + ox, cy: my + oy };
};

// ----------------------------
// Component
// ----------------------------
const DeadlockSimulator: React.FC = () => {
  const [processes, setProcesses] = useState<Proc[]>([]);
  const [resources, setResources] = useState<Res[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [selectedNode, setSelectedNode] = useState<
    | { node: Proc | Res; type: "process" | "resource" }
    | null
  >(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  const [connectingFrom, setConnectingFrom] = useState<
    { node: Proc | Res; type: "process" | "resource" } | undefined
  >();
  const [mode, setMode] = useState<"select" | "process" | "resource" | "connect">(
    "select"
  );

  const [deadlockDetected, setDeadlockDetected] = useState(false);
  const [cycleNodes, setCycleNodes] = useState<string[]>([]);
  const [safeSequence, setSafeSequence] = useState<string[]>([]);
  const [systemState, setSystemState] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [showResourceDialog, setShowResourceDialog] = useState(false);
  const [resourceInstances, setResourceInstances] = useState(1);
  const [pendingResourcePos, setPendingResourcePos] = useState<
    { x: number; y: number } | null
  >(null);

  const [showPreventionDialog, setShowPreventionDialog] = useState(false);
  const [preventionSuggestions, setPreventionSuggestions] = useState<
    { title: string; description: string; type: string; action?: () => void }[]
  >([]);

  const [dark, setDark] = useState(false);
  const [autosave, setAutosave] = useState(true);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ----------------------------
  // Persist / Restore (LocalStorage)
  // ----------------------------
  useEffect(() => {
    const saved = localStorage.getItem("dlsim_state_v2");
    if (saved) {
      try {
        const payload = JSON.parse(saved);
        setProcesses(payload.processes || []);
        setResources(payload.resources || []);
        setEdges(payload.edges || []);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!autosave) return;
    const payload = JSON.stringify({ processes, resources, edges });
    localStorage.setItem("dlsim_state_v2", payload);
  }, [processes, resources, edges, autosave]);

  // ----------------------------
  // Node helpers
  // ----------------------------
  const getNodePos = (id: string) => {
    const p = processes.find((x) => x.id === id);
    if (p) return { x: p.x, y: p.y };
    const r = resources.find((x) => x.id === id);
    if (r) return { x: r.x, y: r.y };
    return { x: 0, y: 0 };
  };

  const addProcess = (x: number, y: number) => {
    const id = "P" + (processes.length + 1);
    setProcesses((s) => [...s, { id, x, y, allocated: [], requesting: [] }]);
  };

  const addResource = (x: number, y: number) => {
    setPendingResourcePos({ x, y });
    setShowResourceDialog(true);
  };

  const confirmAddResource = () => {
    if (!pendingResourcePos) return;
    const id = "R" + (resources.length + 1);
    setResources((s) => [
      ...s,
      {
        id,
        x: pendingResourcePos.x,
        y: pendingResourcePos.y,
        total: resourceInstances,
        available: resourceInstances,
      },
    ]);
    setShowResourceDialog(false);
    setPendingResourcePos(null);
    setResourceInstances(1);
    setMode("select");
  };

  // ----------------------------
  // Canvas interactions
  // ----------------------------
  const draggingRef = useRef<
    | { node: Proc | Res; type: "process" | "resource"; ox: number; oy: number }
    | null
  >(null);

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (mode === "process") {
      addProcess(x, y);
      setMode("select");
    } else if (mode === "resource") {
      addResource(x, y);
    } else {
      setSelectedEdge(null);
      setSelectedNode(null);
    }
  };

  const onNodeMouseDown = (
    node: Proc | Res,
    type: "process" | "resource",
    e: React.MouseEvent
  ) => {
    if (mode !== "select") return;
    e.stopPropagation();
    draggingRef.current = {
      node,
      type,
      ox: e.clientX - node.x,
      oy: e.clientY - node.y,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const { node, type, ox, oy } = draggingRef.current;
      const x = e.clientX - ox;
      const y = e.clientY - oy;
      if (type === "process") {
        setProcesses((arr) =>
          arr.map((p) => (p.id === (node as Proc).id ? { ...p, x, y } : p))
        );
      } else {
        setResources((arr) =>
          arr.map((r) => (r.id === (node as Res).id ? { ...r, x, y } : r))
        );
      }
    };
    const onUp = () => (draggingRef.current = null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onNodeClick = (
    node: Proc | Res,
    type: "process" | "resource",
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    if (mode === "connect") {
      if (!connectingFrom) {
        setConnectingFrom({ node, type });
      } else if (connectingFrom.type !== type) {
        // Create edge
        const newEdge: Edge = {
          id: "E" + (edges.length + 1),
          from: connectingFrom.node.id,
          to: node.id,
          fromType: connectingFrom.type,
          toType: type,
          type: connectingFrom.type === "process" ? "request" : "allocation",
        };
        setEdges((s) => [...s, newEdge]);
        if (newEdge.type === "request") {
          setProcesses((arr) =>
            arr.map((p) =>
              p.id === newEdge.from
                ? { ...p, requesting: [...p.requesting, newEdge.to] }
                : p
            )
          );
        } else {
          setProcesses((arr) =>
            arr.map((p) =>
              p.id === newEdge.to
                ? { ...p, allocated: [...p.allocated, newEdge.from] }
                : p
            )
          );
          setResources((arr) =>
            arr.map((r) =>
              r.id === newEdge.from ? { ...r, available: Math.max(0, r.available - 1) } : r
            )
          );
        }
        setConnectingFrom(undefined);
        setMode("select");
      }
    } else {
      setSelectedNode({ node, type });
      setSelectedEdge(null);
    }
  };

  // ----------------------------
  // Deadlock detection & prevention
  // ----------------------------
  const calculateSafeSequence = () => {
    if (!processes.length) return [] as string[];
    const work: Record<string, number> = {};
    resources.forEach((r) => (work[r.id] = r.available));
    const finish: Record<string, boolean> = {};
    processes.forEach((p) => (finish[p.id] = false));

    const seq: string[] = [];
    let progressed = true;

    while (progressed && seq.length < processes.length) {
      progressed = false;
      for (const p of processes) {
        if (finish[p.id]) continue;
        const canFinish = p.requesting.every((rid) => (work[rid] || 0) > 0);
        if (canFinish) {
          p.allocated.forEach((rid) => (work[rid] = (work[rid] || 0) + 1));
          finish[p.id] = true;
          seq.push(p.id);
          progressed = true;
        }
      }
    }
    return seq.length === processes.length ? seq : [];
  };

  const detectDeadlock = () => {
    // Build WFG edges: P -> Q if P requests a resource held by Q
    const graph: Record<string, string[]> = {};
    processes.forEach((p) => (graph[p.id] = []));
    processes.forEach((p) => {
      p.requesting.forEach((rid) => {
        processes.forEach((q) => {
          if (q.id !== p.id && q.allocated.includes(rid)) graph[p.id].push(q.id);
        });
      });
    });

    const visited: Record<string, boolean> = {};
    const inStack: Record<string, boolean> = {};
    let cycle: string[] = [];

    const dfs = (v: string, path: string[]): boolean => {
      visited[v] = true;
      inStack[v] = true;
      path.push(v);
      for (const nb of graph[v] || []) {
        if (!visited[nb] && dfs(nb, path)) return true;
        else if (inStack[nb]) {
          const i = path.indexOf(nb);
          cycle = path.slice(i);
          return true;
        }
      }
      inStack[v] = false;
      path.pop();
      return false;
    };

    let found = false;
    for (const v of Object.keys(graph)) {
      if (!visited[v] && dfs(v, [])) {
        found = true;
        break;
      }
    }

    setDeadlockDetected(found);
    setCycleNodes(cycle);
    if (found) {
      setSystemState("unsafe");
      setStatusMessage(
        `DEADLOCK DETECTED • Cycle: ${cycle.join(" → ")}${cycle[0] ? " → " + cycle[0] : ""}`
      );
      setSafeSequence([]);
    } else {
      const seq = calculateSafeSequence();
      setSystemState("safe");
      setStatusMessage("No deadlock • System is SAFE");
      setSafeSequence(seq);
    }
  };

  const preventDeadlock = () => {
    if (!deadlockDetected) {
      setPreventionSuggestions([
        { title: "System is Safe", description: "No prevention needed.", type: "info" },
      ]);
      setShowPreventionDialog(true);
      return;
    }

    const suggestions: { title: string; description: string; type: string; action?: () => void }[] = [];
    const inCycle = cycleNodes;
    if (inCycle.length) {
      const victim = inCycle[0];
      const p = processes.find((x) => x.id === victim);
      const alloc = p?.allocated || [];

      if (alloc.length) {
        suggestions.push({
          title: "Resource Preemption",
          description: `Preempt resources from ${victim}: ${alloc.join(", ")}`,
          type: "preemption",
          action: () => {
            setEdges((es) => es.filter((e) => !(e.type === "allocation" && e.to === victim)));
            setProcesses((ps) => ps.map((x) => (x.id === victim ? { ...x, allocated: [] } : x)));
            setResources((rs) =>
              rs.map((r) => (alloc.includes(r.id) ? { ...r, available: r.available + 1 } : r))
            );
            setShowPreventionDialog(false);
            setDeadlockDetected(false);
            setCycleNodes([]);
            setStatusMessage("Deadlock resolved by preemption");
          },
        });
      }

      const victim2 = inCycle[inCycle.length - 1];
      suggestions.push({
        title: "Process Termination",
        description: `Terminate ${victim2} (release all its resources)`,
        type: "termination",
        action: () => {
          const t = processes.find((x) => x.id === victim2);
          if (!t) return;
          setResources((rs) =>
            rs.map((r) => (t.allocated.includes(r.id) ? { ...r, available: r.available + 1 } : r))
          );
          setProcesses((ps) => ps.filter((x) => x.id !== victim2));
          setEdges((es) => es.filter((e) => e.from !== victim2 && e.to !== victim2));
          setShowPreventionDialog(false);
          setDeadlockDetected(false);
          setCycleNodes([]);
          setStatusMessage("Deadlock resolved by termination");
        },
      });

      const requested = new Set<string>();
      inCycle.forEach((pid) => {
        const q = processes.find((x) => x.id === pid);
        q?.requesting.forEach((rid) => requested.add(rid));
      });
      if (requested.size) {
        suggestions.push({
          title: "Add More Resources",
          description: `Increase instances of: ${Array.from(requested).join(", ")}`,
          type: "resources",
          action: () => {
            setResources((rs) =>
              rs.map((r) => (requested.has(r.id) ? { ...r, total: r.total + 1, available: r.available + 1 } : r))
            );
            setShowPreventionDialog(false);
            setStatusMessage("Resources increased");
          },
        });
      }
    }

    setPreventionSuggestions(suggestions);
    setShowPreventionDialog(true);
  };

  const reset = () => {
    setProcesses([]);
    setResources([]);
    setEdges([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setConnectingFrom(undefined);
    setDeadlockDetected(false);
    setCycleNodes([]);
    setSystemState("");
    setStatusMessage("");
    setPreventionSuggestions([]);
    setSafeSequence([]);
  };

  // ----------------------------
  // Save / Load / Export
  // ----------------------------
  const saveJSON = () => {
    const blob = new Blob([
      JSON.stringify({ processes, resources, edges }, null, 2),
    ], { type: "application/json" });
    dl(blob, `deadlock-sim-${prettyDate()}.json`);
  };

  const triggerLoad = () => fileInputRef.current?.click();

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      setProcesses(data.processes || []);
      setResources(data.resources || []);
      setEdges(data.edges || []);
      setStatusMessage("Diagram loaded");
    } catch (err) {
      alert("Invalid file format");
    } finally {
      e.target.value = ""; // reset
    }
  };

  // Build a vector snapshot so we can export SVG/PNG without html2canvas
  const buildSVGString = () => {
    const width = canvasRef.current?.clientWidth || 1200;
    const height = canvasRef.current?.clientHeight || 700;

    const edgePaths = edges
      .map((e) => {
        const a = getNodePos(e.from);
        const b = getNodePos(e.to);
        const { cx, cy } = quadControl(a.x, a.y, b.x, b.y);
        const dash = e.type === "request" ? ' stroke-dasharray="8 6"' : "";
        const stroke = cycleNodes.includes(e.from) && cycleNodes.includes(e.to)
          ? "#ef4444"
          : "#6b7280";
        return `<path d="M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}" fill="none" stroke="${stroke}" stroke-width="2"${dash} marker-end="url(#arrow)" />`;
      })
      .join("\n");

    const nodes = [
      ...processes.map(
        (p) => `
        <g>
          <rect x="${p.x - 48}" y="${p.y - 28}" rx="12" ry="12" width="96" height="56" fill="#3b82f6" stroke="#2563eb" stroke-width="4" />
          <text x="${p.x}" y="${p.y - 2}" text-anchor="middle" font-size="12" font-family="Inter, Arial" fill="#fff" font-weight="bold">${p.id}</text>
          <text x="${p.x}" y="${p.y + 14}" text-anchor="middle" font-size="11" font-family="Inter, Arial" fill="#eef2ff">Process</text>
        </g>`
      ),
      ...resources.map(
        (r) => `
        <g>
          <circle cx="${r.x}" cy="${r.y}" r="36" fill="#facc15" stroke="#eab308" stroke-width="4"/>
          <text x="${r.x}" y="${r.y - 2}" text-anchor="middle" font-size="12" font-family="Inter, Arial" fill="#111827" font-weight="bold">${r.id}</text>
          <text x="${r.x}" y="${r.y + 14}" text-anchor="middle" font-size="11" font-family="Inter, Arial" fill="#374151">${r.available}/${r.total}</text>
        </g>`
      ),
    ].join("\n");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#6b7280"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#edf2f7"/>
  ${edgePaths}
  ${nodes}
</svg>`;

    return svg;
  };

  const exportSVG = () => {
    const svg = buildSVGString();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    dl(blob, `deadlock-sim-${prettyDate()}.svg`);
  };

  const exportPNG = () => {
    const svg = buildSVGString();
    const width = canvasRef.current?.clientWidth || 1200;
    const height = canvasRef.current?.clientHeight || 700;
    const img = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#edf2f7"; // match bg
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) dl(blob, `deadlock-sim-${prettyDate()}.png`);
        URL.revokeObjectURL(url);
      });
    };
    img.src = url;
  };

  // ----------------------------
  // Rendering
  // ----------------------------
  const counts = useMemo(
    () => ({ p: processes.length, r: resources.length, e: edges.length }),
    [processes.length, resources.length, edges.length]
  );

  return (
    <div className={`${dark ? "dark" : ""}`}>
      {/* tiny util styles for a couple of animations */}
      <style>{`
        .edge-flow { animation: edgeFlow 2s linear infinite; }
        @keyframes edgeFlow { to { stroke-dashoffset: -200; } }
        .pop { animation: pop 220ms ease-out both; }
        @keyframes pop { from { transform: scale(.85); opacity: .0 } to { transform: scale(1); opacity: 1 } }
      `}</style>

      <div className="w-full h-screen flex flex-col bg-gradient-to-br from-gray-100 to-gray-200 dark:from-slate-900 dark:to-slate-800">
        {/* Top toolbar */}
        <div className="backdrop-blur bg-white/70 dark:bg-slate-900/50 shadow-sm sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50">Deadlock Visual Simulator</h1>

            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => setMode("process")}
                className={`px-4 py-2 rounded-xl border transition pop flex items-center gap-2 ${
                  mode === "process"
                    ? "bg-blue-600 text-white border-blue-600 shadow"
                    : "bg-white/60 dark:bg-slate-800/60 text-gray-700 dark:text-gray-200 border-gray-300"
                }`}
                title="Add Process"
              >
                <Square size={18} /> Process
              </button>

              <button
                onClick={() => setMode("resource")}
                className={`px-4 py-2 rounded-xl border transition pop flex items-center gap-2 ${
                  mode === "resource"
                    ? "bg-yellow-500 text-white border-yellow-500 shadow"
                    : "bg-white/60 dark:bg-slate-800/60 text-gray-700 dark:text-gray-200 border-gray-300"
                }`}
                title="Add Resource"
              >
                <Circle size={18} /> Resource
              </button>

              <button
                onClick={() => setMode("connect")}
                className={`px-4 py-2 rounded-xl border transition pop flex items-center gap-2 ${
                  mode === "connect"
                    ? "bg-green-600 text-white border-green-600 shadow"
                    : "bg-white/60 dark:bg-slate-800/60 text-gray-700 dark:text-gray-200 border-gray-300"
                }`}
                title="Connect"
              >
                <Plus size={18} /> Connect
              </button>

              <div className="w-px h-6 bg-gray-300 mx-2" />

              <button
                onClick={detectDeadlock}
                className="px-4 py-2 rounded-xl bg-purple-600 text-white shadow hover:shadow-md transition flex items-center gap-2"
                title="Detect Deadlock"
              >
                <Play size={18} /> Detect
              </button>

              <button
                onClick={preventDeadlock}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white shadow hover:shadow-md transition flex items-center gap-2"
                title="Prevention Suggestions"
              >
                <AlertCircle size={18} /> Prevent
              </button>

              <button
                onClick={() => {
                  if (!selectedNode && !selectedEdge) return;
                  if (selectedNode) {
                    if (selectedNode.type === "process") {
                      setProcesses((ps) => ps.filter((p) => p.id !== (selectedNode.node as Proc).id));
                      setEdges((es) =>
                        es.filter((e) => e.from !== selectedNode.node.id && e.to !== selectedNode.node.id)
                      );
                    } else {
                      setResources((rs) => rs.filter((r) => r.id !== (selectedNode.node as Res).id));
                      setEdges((es) =>
                        es.filter((e) => e.from !== selectedNode.node.id && e.to !== selectedNode.node.id)
                      );
                    }
                    setSelectedNode(null);
                  } else if (selectedEdge) {
                    const edge = edges.find((e) => e.id === selectedEdge);
                    if (edge) {
                      if (edge.type === "request") {
                        setProcesses((ps) =>
                          ps.map((p) =>
                            p.id === edge.from
                              ? { ...p, requesting: p.requesting.filter((r) => r !== edge.to) }
                              : p
                          )
                        );
                      } else {
                        setProcesses((ps) =>
                          ps.map((p) =>
                            p.id === edge.to
                              ? { ...p, allocated: p.allocated.filter((r) => r !== edge.from) }
                              : p
                          )
                        );
                        setResources((rs) =>
                          rs.map((r) => (r.id === edge.from ? { ...r, available: r.available + 1 } : r))
                        );
                      }
                      setEdges((es) => es.filter((e) => e.id !== selectedEdge));
                      setSelectedEdge(null);
                    }
                  }
                }}
                disabled={!selectedNode && !selectedEdge}
                className="px-4 py-2 rounded-xl bg-rose-500 text-white shadow hover:shadow-md transition disabled:opacity-50 flex items-center gap-2"
                title="Delete Selected"
              >
                <Trash2 size={18} /> Delete
              </button>

              <button
                onClick={reset}
                className="px-4 py-2 rounded-xl bg-gray-700 text-white shadow hover:shadow-md transition flex items-center gap-2"
                title="Reset"
              >
                <RotateCcw size={18} /> Reset
              </button>

              <div className="ml-auto flex items-center gap-2">
                {/* Save / Load / Export */}
                <button
                  onClick={saveJSON}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:shadow-md transition flex items-center gap-2"
                  title="Save as JSON"
                >
                  <Save size={16} /> Save
                </button>
                <button
                  onClick={triggerLoad}
                  className="px-3 py-2 rounded-lg bg-sky-600 text-white hover:shadow-md transition flex items-center gap-2"
                  title="Load from file"
                >
                  <Upload size={16} /> Load
                </button>
                <button
                  onClick={exportSVG}
                  className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:shadow-md transition flex items-center gap-2"
                  title="Export SVG"
                >
                  <Download size={16} /> SVG
                </button>
                <button
                  onClick={exportPNG}
                  className="px-3 py-2 rounded-lg bg-gray-900 text-white hover:shadow-md transition flex items-center gap-2"
                  title="Export PNG"
                >
                  <ImageIcon size={16} /> PNG
                </button>

                {/* Autosave toggle */}
                <label className="ml-2 inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autosave}
                    onChange={(e) => setAutosave(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Autosave
                </label>

                <button
                  onClick={() => setDark((d) => !d)}
                  className="ml-2 p-2 rounded-lg border bg-white/60 dark:bg-slate-800/60 text-gray-700 dark:text-gray-200"
                  title="Toggle theme"
                >
                  {dark ? <SunMedium size={16} /> : <Moon size={16} />}
                </button>
              </div>
            </div>

            {statusMessage && (
              <div
                className={`ml-4 text-sm px-3 py-1 rounded-lg font-medium ${
                  systemState === "unsafe"
                    ? "bg-red-100 text-red-700"
                    : "bg-green-100 text-green-700"
                }`}
              >
                {statusMessage}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-12 gap-0">
          {/* Canvas */}
          <div
            ref={canvasRef}
            className="col-span-9 relative overflow-hidden"
            onClick={onCanvasClick}
          >
            {/* Edges (SVG layer) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {edges.map((edge) => {
                const a = getNodePos(edge.from);
                const b = getNodePos(edge.to);
                const { cx, cy } = quadControl(a.x, a.y, b.x, b.y);
                const inCycle = cycleNodes.includes(edge.from) && cycleNodes.includes(edge.to);
                const isSelected = selectedEdge === edge.id;
                const isReq = edge.type === "request";

                return (
                  <g
                    key={edge.id}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdge(edge.id);
                      setSelectedNode(null);
                    }}
                  >
                    <defs>
                      <marker id={`arrow-${edge.id}`} markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                        <path d="M0,0 L0,6 L9,3 z" fill={isSelected ? "#8b5cf6" : inCycle ? "#ef4444" : "#6b7280"} />
                      </marker>
                    </defs>
                    <path
                      d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                      stroke={isSelected ? "#8b5cf6" : inCycle ? "#ef4444" : "#6b7280"}
                      strokeWidth={isSelected ? 4 : inCycle ? 3 : 2}
                      fill="none"
                      className={isReq ? "edge-flow" : ""}
                      style={isReq ? ({ strokeDasharray: "10 6" } as React.CSSProperties) : undefined}
                      markerEnd={`url(#arrow-${edge.id})`}
                    />
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 6}
                      fill={isSelected ? "#8b5cf6" : inCycle ? "#ef4444" : "#374151"}
                      fontSize={12}
                      fontWeight={700}
                    >
                      {edge.type === "request" ? "REQ" : "ALLOC"}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Nodes */}
            {processes.map((p) => (
              <div
                key={p.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer select-none pop ${
                  cycleNodes.includes(p.id) ? "animate-pulse" : ""
                }`}
                style={{ left: p.x, top: p.y }}
                onClick={(e) => onNodeClick(p, "process", e)}
                onMouseDown={(e) => onNodeMouseDown(p, "process", e)}
              >
                <div
                  className={`w-28 h-16 rounded-xl flex flex-col items-center justify-center shadow-lg border-4 transition transform hover:-translate-y-0.5 hover:shadow-xl ${
                    selectedNode?.node.id === p.id
                      ? "border-blue-700 bg-blue-500"
                      : cycleNodes.includes(p.id)
                      ? "border-red-500 bg-red-400"
                      : "border-blue-500 bg-blue-500"
                  }`}
                >
                  <span className="text-white font-bold text-sm">{p.id}</span>
                  <span className="text-white/90 text-xs">Process</span>
                </div>
              </div>
            ))}

            {resources.map((r) => (
              <div
                key={r.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer select-none pop"
                style={{ left: r.x, top: r.y }}
                onClick={(e) => onNodeClick(r, "resource", e)}
                onMouseDown={(e) => onNodeMouseDown(r, "resource", e)}
              >
                <div
                  className={`w-20 h-20 rounded-full flex flex-col items-center justify-center shadow-lg border-4 transition transform hover:-translate-y-0.5 hover:shadow-xl ${
                    selectedNode?.node.id === r.id
                      ? "border-yellow-600 bg-yellow-400"
                      : "border-yellow-500 bg-yellow-400"
                  }`}
                >
                  <span className="text-gray-900 font-bold text-sm">{r.id}</span>
                  <span className="text-gray-800 text-xs">{r.available}/{r.total}</span>
                </div>
              </div>
            ))}

            {/* Empty helper card */}
            {processes.length === 0 && resources.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-white/90 dark:bg-slate-800/70 p-8 rounded-2xl shadow-2xl max-w-md border border-white/60 backdrop-blur">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Getting Started</h2>
                  <ol className="space-y-2 text-gray-700 dark:text-gray-300">
                    <li>1. Add processes and resources</li>
                    <li>2. Connect them together</li>
                    <li>3. Detect deadlocks</li>
                    <li>4. Apply prevention strategies</li>
                  </ol>
                </div>
              </div>
            )}

            {connectingFrom && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-xl shadow">
                Click another node to connect from <b>{connectingFrom.node.id}</b>
              </div>
            )}
          </div>

          {/* Right panel */}
          <aside className="col-span-3 border-l bg-white/70 dark:bg-slate-900/40 backdrop-blur px-4 py-4 space-y-4">
            <div className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <Info size={16} /> Live Info
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg bg-white dark:bg-slate-800 p-3 shadow flex flex-col items-center">
                <div className="text-xs text-gray-500">Processes</div>
                <div className="text-lg font-bold">{counts.p}</div>
              </div>
              <div className="rounded-lg bg-white dark:bg-slate-800 p-3 shadow flex flex-col items-center">
                <div className="text-xs text-gray-500">Resources</div>
                <div className="text-lg font-bold">{counts.r}</div>
              </div>
              <div className="rounded-lg bg-white dark:bg-slate-800 p-3 shadow flex flex-col items-center">
                <div className="text-xs text-gray-500">Edges</div>
                <div className="text-lg font-bold">{counts.e}</div>
              </div>
            </div>

            {safeSequence.length > 0 && (
              <div className="rounded-xl bg-green-50 text-green-800 p-3 text-sm">
                <div className="font-semibold mb-1">Safe sequence</div>
                <div>{safeSequence.join(" → ")}</div>
              </div>
            )}

            {selectedNode && (
              <div className="rounded-xl bg-white dark:bg-slate-800 p-3 shadow">
                <div className="text-sm font-semibold mb-2">Selected Node</div>
                <div className="text-sm text-gray-700 dark:text-gray-200">ID: {selectedNode.node.id}</div>
                <div className="text-xs text-gray-500 mb-2">Type: {selectedNode.type}</div>
                {selectedNode.type === "process" ? (
                  <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
                    <div>Allocated: {(selectedNode.node as Proc).allocated.join(", ") || "—"}</div>
                    <div>Requesting: {(selectedNode.node as Proc).requesting.join(", ") || "—"}</div>
                  </div>
                ) : (
                  <div className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
                    <div>Total: {(selectedNode.node as Res).total}</div>
                    <div>Available: {(selectedNode.node as Res).available}</div>
                  </div>
                )}
              </div>
            )}

            {selectedEdge && (
              <div className="rounded-xl bg-white dark:bg-slate-800 p-3 shadow text-sm">
                <div className="font-semibold mb-1">Selected Edge</div>
                {(() => {
                  const e = edges.find((x) => x.id === selectedEdge);
                  if (!e) return null;
                  return (
                    <div className="text-gray-700 dark:text-gray-200 space-y-1 text-xs">
                      <div>ID: {e.id}</div>
                      <div>Type: {e.type}</div>
                      <div>From: {e.from}</div>
                      <div>To: {e.to}</div>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="text-xs text-gray-500">Tip: Hold and drag nodes to rearrange. Use Connect to create REQ/ALLOC edges. Delete removes the selected node or edge.</div>
          </aside>
        </div>

        {/* Bottom legend */}
        <div className="bg-white/70 dark:bg-slate-900/50 backdrop-blur border-t px-4 py-3 text-sm flex items-center gap-8">
          <div className="flex items-center gap-2">
            <svg width="40" height="2"><line x1="0" y1="1" x2="40" y2="1" stroke="#6b7280" strokeWidth="2" /></svg>
            <span className="text-gray-600 dark:text-gray-300">Allocation</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="40" height="2"><line x1="0" y1="1" x2="40" y2="1" stroke="#6b7280" strokeWidth="2" strokeDasharray="8,4" /></svg>
            <span className="text-gray-600 dark:text-gray-300">Request</span>
          </div>
        </div>

        {/* Modals */}
        {showResourceDialog && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-96 border border-white/20">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-4">Add Resource</h2>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Number of instances</label>
              <input
                type="number"
                min={1}
                value={resourceInstances}
                autoFocus
                onChange={(e) => setResourceInstances(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg border bg-white/80 dark:bg-slate-900/60"
              />
              <div className="flex gap-3 mt-4">
                <button onClick={confirmAddResource} className="flex-1 bg-yellow-500 text-white px-4 py-2 rounded-lg shadow">Add</button>
                <button
                  onClick={() => {
                    setShowResourceDialog(false);
                    setPendingResourcePos(null);
                    setResourceInstances(1);
                    setMode("select");
                  }}
                  className="flex-1 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {showPreventionDialog && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto border border-white/20">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-4">
                {deadlockDetected ? "Deadlock Prevention" : "System Status"}
              </h2>
              <div className="space-y-4">
                {preventionSuggestions.map((s, i) => (
                  <div
                    key={i}
                    className={`p-4 rounded-xl border-2 ${
                      s.type === "info"
                        ? "border-green-300 bg-green-50"
                        : s.type === "preemption"
                        ? "border-blue-300 bg-blue-50"
                        : s.type === "termination"
                        ? "border-red-300 bg-red-50"
                        : "border-yellow-300 bg-yellow-50"
                    }`}
                  >
                    <div className="font-semibold text-lg mb-1">{s.title}</div>
                    <div className="text-gray-700 mb-3">{s.description}</div>
                    {s.action && (
                      <button
                        onClick={s.action}
                        className={`px-4 py-2 rounded-lg text-white ${
                          s.type === "preemption" ? "bg-blue-600" : s.type === "termination" ? "bg-red-600" : "bg-yellow-600"
                        }`}
                      >
                        Apply
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <button onClick={() => setShowPreventionDialog(false)} className="w-full bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-lg">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Hidden loader input */}
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={onLoadFile} />
      </div>
    </div>
  );
};

export default DeadlockSimulator;
