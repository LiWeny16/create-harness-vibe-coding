import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeMouseHandler, NodeProps, ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, Boxes, GitBranch, Maximize2, Plus, RefreshCw, Route, Terminal, Workflow } from 'lucide-react';
import { apiJson, apiJsonCached, invalidateApiCache } from '../api';
import type { BuiltInWorkflow, RuntimeInfo, Session, TaskOption, WorkflowEdge, WorkflowNode, WorkflowSnapshot } from '../types';
import LoadingView from './LoadingView';

type Props = { onSelectSession: (sessionId: string) => void };

type CanvasNode = WorkflowNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WfNodeData = Record<string, unknown> & {
  workflowNode: WorkflowNode;
  onOpenSession: (sessionId: string) => void;
};

type FlowNode = Node<WfNodeData, 'wfNode'>;
type FlowEdge = Edge<Record<string, unknown>>;

const NODE_W = 188;
const NODE_H = 86;
const PANEL: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 12px 38px rgba(0,0,0,0.08)',
  backdropFilter: 'blur(16px)',
};

function statusColor(status: string | undefined) {
  if (status === 'running' || status === 'active' || status === 'ready') return '#166534';
  if (status === 'blocked' || status === 'exited') return '#991b1b';
  if (status === 'starting' || status === 'idle') return '#d97706';
  return '#6b7280';
}

function shortId(value: string | undefined) {
  if (!value) return '';
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function defaultPrompt(workflows: BuiltInWorkflow[], workflowId: string) {
  const workflow = workflows.find(item => item.id === workflowId) || workflows[0];
  return workflow?.defaultCeoPrompt || 'Act as the Harness /wf CEO. Coordinate terminal agents through Harness A2A evidence.';
}

function nodeKindIcon(kind: string) {
  if (kind === 'terminal-session') return Terminal;
  if (kind === 'terminal-controller' || kind === 'runtime') return Route;
  return Bot;
}

function layoutNodes(workflow: WorkflowSnapshot | null): CanvasNode[] {
  const base = workflow?.nodes || [];
  const sessionNodes = base
    .filter(node => node.kind === 'terminal-session')
    .filter(node => node.status === 'running' || node.status === 'starting')
    .map(node => ({
      ...node,
      label: node.runtime ? `${node.runtime} Worker` : node.label,
      level: 2,
    }));
  const ceo = base.find(node => node.id === 'ceo') || {
    id: 'ceo',
    label: 'Harness CEO',
    kind: 'controller',
    level: 0,
    status: workflow?.phase || 'idle',
    skills: ['wf'],
    permissions: ['dispatch'],
  };
  const controller = base.find(node => node.id === 'terminal-controller') || {
    id: 'terminal-controller',
    label: 'Agent Manager',
    kind: 'terminal-controller',
    level: 1,
    status: 'ready',
    skills: ['terminal-control'],
    permissions: ['read-terminals', 'send-terminal-input'],
  };

  const nodes: CanvasNode[] = [
    { ...ceo, x: 420, y: 72, width: NODE_W, height: NODE_H },
    { ...controller, label: 'Agent Manager', x: 420, y: 238, width: NODE_W, height: NODE_H },
  ];

  if (sessionNodes.length === 0) {
    nodes.push({
      id: 'wf-subagents-pool',
      label: 'WF Subagent Pool',
      kind: 'terminal-session',
      level: 2,
      status: 'idle',
      skills: ['new-terminal'],
      permissions: ['create-node'],
      x: 420,
      y: 406,
      width: NODE_W,
      height: NODE_H,
    });
    return nodes;
  }

  const gapX = 252;
  const startX = 420 - sessionNodes.length * gapX / 2 + gapX / 2 - NODE_W / 2;
  sessionNodes.forEach((node, index) => {
    nodes.push({
      ...node,
      x: startX + index * gapX,
      y: 406,
      width: NODE_W,
      height: NODE_H,
    });
  });

  return nodes;
}

function buildEdges(workflow: WorkflowSnapshot | null, nodeIds: Set<string>): WorkflowEdge[] {
  const relationByPair = new Map(
    (workflow?.edges || []).map(edge => [`${edge.from}->${edge.to}`, edge.relation]),
  );
  const edges: WorkflowEdge[] = [];
  if (nodeIds.has('ceo') && nodeIds.has('terminal-controller')) {
    edges.push({
      from: 'ceo',
      to: 'terminal-controller',
      relation: relationByPair.get('ceo->terminal-controller') || 'delegates',
    });
  }
  const workerIds = [...nodeIds].filter(id => id !== 'ceo' && id !== 'terminal-controller');
  for (const id of workerIds) {
    edges.push({
      from: 'terminal-controller',
      to: id,
      relation: relationByPair.get(`terminal-controller->${id}`) || (id === 'wf-subagents-pool' ? 'creates' : 'owns-worker'),
    });
  }
  return edges;
}

function toFlowNodes(
  canvasNodes: CanvasNode[],
  onOpenSession: (sessionId: string) => void,
  previous: FlowNode[],
): FlowNode[] {
  const previousPositions = new Map(previous.map(node => [node.id, node.position]));
  return canvasNodes.map(node => ({
    id: node.id,
    type: 'wfNode',
    position: previousPositions.get(node.id) || { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: { workflowNode: node, onOpenSession },
    draggable: true,
  }));
}

function toFlowEdges(edges: WorkflowEdge[]): FlowEdge[] {
  return edges.map((edge, index) => ({
    id: `${edge.from}-${edge.to}-${index}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    label: edge.relation,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
    style: { stroke: '#9ca3af', strokeWidth: 1.5 },
    labelStyle: { fill: '#6b7280', fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: 'rgba(255,255,255,0.72)' },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  }));
}

function useAutoLoadedWorkflow() {
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    try {
      if (refresh) {
        invalidateApiCache('/api/workflow');
        invalidateApiCache('/api/runtimes');
        invalidateApiCache('/api/tasks');
      }
      const [snapshot, runtimeRows, taskRows] = await Promise.all([
        apiJsonCached<WorkflowSnapshot>('/api/workflow', { ttlMs: refresh ? 0 : 1200, refresh }),
        apiJsonCached<RuntimeInfo[]>(refresh ? '/api/runtimes?refresh=1' : '/api/runtimes', { ttlMs: 12000, refresh }),
        apiJsonCached<TaskOption[]>('/api/tasks', { ttlMs: 8000, refresh }).catch(() => []),
      ]);
      setWorkflow(snapshot);
      setRuntimes(runtimeRows);
      setTasks(taskRows);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => load(false), 5000);
    return () => clearInterval(interval);
  }, []);

  return { workflow, runtimes, tasks, loading, error, setError, reload: load };
}

export default function WorkflowRoute({ onSelectSession }: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowRouteInner onSelectSession={onSelectSession} />
    </ReactFlowProvider>
  );
}

function WorkflowRouteInner({ onSelectSession }: Props) {
  const { workflow, runtimes, tasks, loading, error, setError, reload } = useAutoLoadedWorkflow();
  const workflows = workflow?.availableWorkflows || [];
  const [workflowId, setWorkflowId] = useState('');
  const [ceoPrompt, setCeoPrompt] = useState('');
  const [subagentMode, setSubagentMode] = useState('wf-subagents');
  const [runtimeId, setRuntimeId] = useState('');
  const [bindTask, setBindTask] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [model, setModel] = useState('');
  const [agentObjective, setAgentObjective] = useState('WF terminal subagent');
  const [selectedNodeId, setSelectedNodeId] = useState('ceo');
  const [running, setRunning] = useState(false);
  const [launchingAgent, setLaunchingAgent] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const fittedOnce = useRef(false);

  useEffect(() => {
    if (workflows.length > 0) {
      setWorkflowId(current => current || workflows[0].id);
      setCeoPrompt(current => current || defaultPrompt(workflows, workflows[0].id));
    }
  }, [workflows]);

  useEffect(() => {
    setRuntimeId(current => current && runtimes.some(runtime => runtime.id === current) ? current : runtimes[0]?.id || '');
  }, [runtimes]);

  useEffect(() => {
    setTaskId(current => current && tasks.some(task => task.taskId === current) ? current : tasks[0]?.taskId || '');
  }, [tasks]);

  const canvasNodes = useMemo(() => layoutNodes(workflow), [workflow]);
  const nodeIds = useMemo(() => new Set(canvasNodes.map(node => node.id)), [canvasNodes]);
  const canvasEdges = useMemo(() => buildEdges(workflow, nodeIds), [workflow, nodeIds]);
  const currentRuntime = runtimes.find(runtime => runtime.id === runtimeId) || null;
  const selectedNode = nodes.find(node => node.id === selectedNodeId)?.data.workflowNode || canvasNodes[0] || null;

  useEffect(() => {
    setNodes(previous => toFlowNodes(canvasNodes, onSelectSession, previous));
  }, [canvasNodes, onSelectSession, setNodes]);

  useEffect(() => {
    setEdges(toFlowEdges(canvasEdges));
  }, [canvasEdges, setEdges]);

  useEffect(() => {
    if (!fittedOnce.current && nodes.length > 0 && flowRef.current) {
      fittedOnce.current = true;
      requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.28, duration: 220 }));
    }
  }, [nodes.length]);

  const nodeTypes = useMemo(() => ({ wfNode: WfNodeCard }), []);

  const chooseWorkflow = (nextWorkflowId: string) => {
    setWorkflowId(nextWorkflowId);
    setCeoPrompt(defaultPrompt(workflows, nextWorkflowId));
  };

  const runWorkflow = async () => {
    if (!runtimeId) return;
    setRunning(true);
    setError(null);
    try {
      const session = await apiJson<Session>('/api/workflow/run', {
        method: 'POST',
        body: JSON.stringify({
          workflowId,
          runtime: runtimeId,
          subagentMode,
          ceoPrompt,
          model,
          taskId: bindTask ? taskId : null,
        }),
      });
      invalidateApiCache('/api/workflow');
      invalidateApiCache('/api/sessions');
      await reload(true);
      onSelectSession(session.sessionId);
    } catch (e: any) {
      setError(e?.message || 'Failed to run workflow');
    } finally {
      setRunning(false);
    }
  };

  const createAgentNode = async () => {
    if (!runtimeId || subagentMode !== 'wf-subagents') return;
    setLaunchingAgent(true);
    setError(null);
    try {
      const session = await apiJson<Session>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          runtime: runtimeId,
          model,
          taskId: bindTask ? taskId : null,
          role: 'wf-subagent',
          objective: agentObjective,
          subagentMode: 'wf-subagents',
          workflowMode: 'wf',
        }),
      });
      invalidateApiCache('/api/workflow');
      invalidateApiCache('/api/sessions');
      await reload(true);
      onSelectSession(session.sessionId);
    } catch (e: any) {
      setError(e?.message || 'Failed to create agent node');
    } finally {
      setLaunchingAgent(false);
    }
  };

  const onConnect = useCallback((connection: Connection) => {
    setEdges(current => addEdge({
      ...connection,
      id: `manual-${connection.source}-${connection.target}-${Date.now()}`,
      type: 'smoothstep',
      label: 'manual',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#111' },
      style: { stroke: '#111', strokeWidth: 1.6 },
      labelStyle: { fill: '#111', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: 'rgba(255,255,255,0.82)' },
    }, current));
  }, [setEdges]);

  const openPaneMenu = (event: ReactMouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 190)),
      y: Math.max(8, Math.min(event.clientY - bounds.top, bounds.height - 116)),
    });
  };

  const openNodeConfig: NodeMouseHandler<FlowNode> = (event, node) => {
    event.preventDefault();
    setContextMenu(null);
    setSelectedNodeId(node.id);
    setShowConfig(true);
  };

  const selectNode: NodeMouseHandler<FlowNode> = (_event, node) => {
    setContextMenu(null);
    setSelectedNodeId(node.id);
  };

  const resetView = () => {
    setContextMenu(null);
    flowRef.current?.fitView({ padding: 0.28, duration: 220 });
  };

  if (loading) return <LoadingView label="Loading workflow canvas" fullCanvas />;

  return (
    <div ref={flowWrapperRef} className="wf-canvas-shell" style={{ height: '100%', minHeight: 0 }}>
      <ReactFlow
        className="wf-flow"
        data-testid="workflow-canvas"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => { flowRef.current = instance; }}
        onPaneClick={() => setContextMenu(null)}
        onPaneContextMenu={openPaneMenu}
        onNodeClick={selectNode}
        onNodeDoubleClick={openNodeConfig}
        onNodeContextMenu={openNodeConfig}
        fitView
        minZoom={0.3}
        maxZoom={1.7}
        panOnDrag
        panOnScroll
        selectionOnDrag={false}
        nodesDraggable
        nodesConnectable
        nodesFocusable={false}
        edgesFocusable={false}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5e7eb" gap={32} size={1} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={3}
          nodeColor={(node) => statusColor((node.data as WfNodeData).workflowNode.status)}
          style={{ width: 142, height: 96, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.84)' }}
        />

        {error && (
          <Panel position="top-center">
            <div data-canvas-control="true" style={{ fontSize: 11, color: '#991b1b', padding: '6px 8px', background: '#fef2f2', borderRadius: 'var(--radius)', border: '1px solid #fecaca' }}>
              {error}
            </div>
          </Panel>
        )}

        <Panel position="top-left">
          <aside data-canvas-control="true" className="nodrag nopan nowheel" style={{ ...PANEL, width: 292, maxHeight: 'calc(100vh - var(--header-h) - 32px)', overflow: 'auto', padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Boxes size={14} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Built-in Workflows</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{workflow?.workflowId || 'workflow-none'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
              {workflows.map(item => (
                <button key={item.id} onClick={() => chooseWorkflow(item.id)}
                  style={{
                    textAlign: 'left',
                    border: `1px solid ${workflowId === item.id ? '#111' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    padding: 8,
                    background: workflowId === item.id ? 'var(--surface)' : 'var(--bg)',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{item.label}</span>
                    <span style={{ fontSize: 9, color: 'var(--muted)' }}>{item.command}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{item.description}</div>
                </button>
              ))}
            </div>

            <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 4, marginBottom: 10 }}>
              CEO Prompt
              <textarea value={ceoPrompt} onChange={e => setCeoPrompt(e.target.value)}
                style={{ minHeight: 112, resize: 'vertical', padding: 8, fontSize: 11, lineHeight: 1.45, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }} />
            </label>

            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 5 }}>Subagents</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 10 }}>
              {(workflow?.subagentModes || [
                { id: 'built-in-subagents', label: 'Built-in' },
                { id: 'wf-subagents', label: 'WF Terminals' },
              ]).map(mode => (
                <button key={mode.id} onClick={() => setSubagentMode(mode.id)}
                  style={{ padding: '6px 4px', fontSize: 10, fontWeight: subagentMode === mode.id ? 700 : 500, background: subagentMode === mode.id ? '#111' : 'var(--bg)', color: subagentMode === mode.id ? '#fff' : 'var(--muted)' }}>
                  {mode.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                Runtime
                <select value={runtimeId} onChange={e => setRuntimeId(e.target.value)}
                  style={{ minWidth: 0, padding: '6px 7px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }}>
                  {runtimes.map(runtime => <option key={runtime.id} value={runtime.id}>{runtime.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                Model
                <input value={model} onChange={e => setModel(e.target.value)} placeholder="optional"
                  style={{ minWidth: 0, padding: '6px 7px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }} />
              </label>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
              <input type="checkbox" checked={bindTask} onChange={e => setBindTask(e.target.checked)} />
              Bind a task
            </label>
            {bindTask && (
              <select value={taskId} onChange={e => setTaskId(e.target.value)}
                style={{ width: '100%', padding: '6px 7px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)', marginBottom: 10 }}>
                {tasks.map(task => <option key={task.taskId} value={task.taskId}>{task.taskId}</option>)}
              </select>
            )}

            <button onClick={runWorkflow} disabled={!currentRuntime || running}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', background: '#111', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: !currentRuntime || running ? 0.5 : 1 }}>
              <GitBranch size={12} /> Run /wf
            </button>

            {subagentMode === 'wf-subagents' && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3, marginBottom: 7 }}>
                  New Agent Objective
                  <input value={agentObjective} onChange={e => setAgentObjective(e.target.value)}
                    style={{ padding: '6px 7px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg)' }} />
                </label>
                <button onClick={createAgentNode} disabled={!currentRuntime || launchingAgent}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: !currentRuntime || launchingAgent ? 0.5 : 1 }}>
                  <Plus size={12} /> Agent Node
                </button>
              </div>
            )}
          </aside>
        </Panel>

        <Panel position="top-right">
          <div data-canvas-control="true" className="nodrag nopan" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ ...PANEL, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Workflow size={13} /> WF Canvas
            </div>
            <button onClick={() => reload(true)} title="Refresh workflow" style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: 'var(--muted)' }}>
              <RefreshCw size={13} />
            </button>
            <button title="Fit view" onClick={resetView} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: 'var(--muted)' }}>
              <Maximize2 size={13} />
            </button>
          </div>
        </Panel>

        {contextMenu && (
          <div
            data-canvas-control="true"
            data-testid="workflow-context-menu"
            className="nodrag nopan"
            style={{ ...PANEL, position: 'absolute', zIndex: 12, left: contextMenu.x, top: contextMenu.y, width: 178, padding: 6, cursor: 'default' }}
          >
            <button
              onClick={() => { setContextMenu(null); createAgentNode(); }}
              disabled={!currentRuntime || subagentMode !== 'wf-subagents' || launchingAgent}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--fg)', fontSize: 11, fontWeight: 600, opacity: !currentRuntime || subagentMode !== 'wf-subagents' || launchingAgent ? 0.5 : 1 }}
            >
              <Plus size={12} /> New Agent Node
            </button>
            <button
              onClick={resetView}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--muted)', fontSize: 11 }}
            >
              <Maximize2 size={12} /> Fit View
            </button>
          </div>
        )}

        {showConfig && selectedNode && (
          <Panel position="bottom-right">
            <aside data-canvas-control="true" className="nodrag nopan nowheel" style={{ ...PANEL, width: 292, padding: 12, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{selectedNode.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{selectedNode.id}</div>
                </div>
                <button onClick={() => setShowConfig(false)} style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>Close</button>
              </div>

              <dl style={{ display: 'grid', gridTemplateColumns: '76px 1fr', gap: '5px 8px', fontSize: 10, marginBottom: 10 }}>
                <dt style={{ color: 'var(--muted)' }}>Kind</dt><dd>{selectedNode.kind}</dd>
                <dt style={{ color: 'var(--muted)' }}>Status</dt><dd style={{ color: statusColor(selectedNode.status) }}>{selectedNode.status || 'unknown'}</dd>
                {selectedNode.runtime && <><dt style={{ color: 'var(--muted)' }}>Runtime</dt><dd>{selectedNode.runtime}</dd></>}
                {selectedNode.model && <><dt style={{ color: 'var(--muted)' }}>Model</dt><dd>{selectedNode.model}</dd></>}
                {selectedNode.taskId && <><dt style={{ color: 'var(--muted)' }}>Task</dt><dd>{selectedNode.taskId}</dd></>}
                {selectedNode.peerId && <><dt style={{ color: 'var(--muted)' }}>Peer</dt><dd>{shortId(selectedNode.peerId)}</dd></>}
              </dl>

              {selectedNode.sessionId ? (
                <button onClick={() => onSelectSession(selectedNode.sessionId!)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)', background: '#111', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  <Terminal size={12} /> Open Terminal
                </button>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  Use the left panel or right-click canvas to create a WF terminal node.
                </div>
              )}
            </aside>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function WfNodeCard({ data, selected }: NodeProps<FlowNode>) {
  const node = data.workflowNode;
  const Icon = nodeKindIcon(node.kind);
  const color = statusColor(node.status);
  return (
    <div
      data-testid="workflow-node"
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        border: `1px solid ${selected ? color : 'var(--border)'}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius)',
        background: selected ? '#fff' : 'rgba(255,255,255,0.92)',
        boxShadow: selected ? '0 10px 24px rgba(0,0,0,0.10)' : '0 4px 14px rgba(0,0,0,0.06)',
        textAlign: 'left',
        padding: 9,
        display: 'grid',
        alignContent: 'start',
        gap: 4,
        color: 'var(--fg)',
      }}
    >
      <Handle className="wf-flow-handle" type="target" position={Position.Top} />
      <Handle className="wf-flow-handle" type="source" position={Position.Bottom} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Icon size={14} />
        <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
      </div>
      <div style={{ fontSize: 10, color }}>{node.status || 'unknown'}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {node.runtime || node.kind}{node.model ? ` / ${node.model}` : ''}
      </div>
      {node.sessionId && (
        <button
          className="nodrag nopan"
          onClick={(e) => { e.stopPropagation(); data.onOpenSession(node.sessionId!); }}
          style={{ fontSize: 10, color: 'var(--fg)', textDecoration: 'underline', justifySelf: 'start', alignSelf: 'end' }}
        >
          terminal
        </button>
      )}
    </div>
  );
}
