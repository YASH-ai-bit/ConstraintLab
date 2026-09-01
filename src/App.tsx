import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Cpu,
  Gauge,
  LoaderCircle,
  Play,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  UserRound,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useConstraintLab } from "./state/store";
import type { Actor, Constraint, Job, Resource, SolveStatus } from "./domain/types";
import { affectedJobIds } from "./domain/validation";
import { durationLabel, formatTime } from "./domain/time";

const TIME_START = 480;
const TIME_END = 1080;
const RESOURCE_COLORS: Record<string, string> = {
  "machine-1": "#285f70",
  "machine-2": "#8b5f33",
  "machine-3": "#526944",
  "machine-4": "#5d5685",
};

function StatusBadge({ status }: { status: SolveStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {status === "SOLVING" ? <LoaderCircle size={12} className="spin" /> : <CircleDot size={11} />}
      {status}
    </span>
  );
}

function PanelTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="panel-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function ResourceList({ resources, jobs }: { resources: Resource[]; jobs: Job[] }) {
  return (
    <div className="resource-list">
      {resources.map((resource) => (
        <div className="resource-card" key={resource.id}>
          <span className="resource-dot" style={{ background: RESOURCE_COLORS[resource.id] }} />
          <div className="resource-meta">
            <strong>{resource.name.split(" · ")[0]}</strong>
            <span>{resource.name.split(" · ")[1]}</span>
          </div>
          <span className="resource-count">{jobs.filter((job) => job.requiredResource === resource.id).length}</span>
        </div>
      ))}
    </div>
  );
}

function JobsPanel() {
  const state = useConstraintLab((value) => value);
  const [section, setSection] = useState<"jobs" | "resources">("jobs");
  const conflictJobIds = new Set(state.infeasibility?.conflicts.flatMap((conflict) => conflict.jobIds) ?? []);
  return (
    <aside className="panel left-panel">
      <div className="segmented" aria-label="Model data">
        <button className={section === "jobs" ? "active" : ""} onClick={() => setSection("jobs")}>Jobs <span>{state.jobs.length}</span></button>
        <button className={section === "resources" ? "active" : ""} onClick={() => setSection("resources")}>Resources <span>{state.resources.length}</span></button>
      </div>
      {section === "jobs" ? (
        <div className="job-list">
          {state.jobs.map((job) => {
            const assignment = state.assignments.find((item) => item.jobId === job.id);
            return (
              <button key={job.id} className={`job-row ${state.selectedJobId === job.id ? "selected" : ""} ${conflictJobIds.has(job.id) ? "conflict" : ""}`} onClick={() => state.selectJob(job.id)}>
                <span className="job-code">{job.id.replace("job-", "J")}</span>
                <span className="job-main"><strong>{job.name}</strong><small>{durationLabel(job.durationMinutes)} · P{job.priority}</small></span>
                <span className="job-time">{assignment ? formatTime(assignment.start).replace(" ", "\u00a0") : "—"}</span>
              </button>
            );
          })}
        </div>
      ) : <ResourceList resources={state.resources} jobs={state.jobs} />}
      <div className="panel-foot"><Box size={13} /> {state.jobs.length} jobs · {state.resources.length} machines</div>
    </aside>
  );
}

function GanttChart() {
  const state = useConstraintLab((value) => value);
  const selectedConstraint = state.constraints.find((item) => item.id === state.selectedConstraintId);
  const affectedIds = new Set(selectedConstraint ? affectedJobIds(selectedConstraint) : []);
  const deadlineConstraints = state.constraints.filter((constraint) => constraint.enabled && constraint.type === "deadline");
  const conflicts = state.infeasibility?.conflicts ?? [];
  const ticks = Array.from({ length: 11 }, (_, index) => TIME_START + index * 60);
  const pct = (value: number) => `${((value - TIME_START) / (TIME_END - TIME_START)) * 100}%`;
  const windowsFor = (resource: Resource) => [
    ...resource.unavailableWindows,
    ...state.constraints.filter((constraint) => constraint.enabled && constraint.type === "resource_availability" && constraint.parameters.resourceId === resource.id).map((constraint) => ({ start: Number(constraint.parameters.start), end: Number(constraint.parameters.end) })),
  ];

  return (
    <section className="panel gantt-panel">
      <PanelTitle eyebrow="LIVE SOLUTION" title="Resource schedule" action={<div className="legend"><span><i className="legend-block" /> Job</span><span><i className="legend-down" /> Downtime</span><span><i className="legend-deadline" /> Deadline</span></div>} />
      <div className="gantt-wrap">
        <div className="gantt-axis-label">RESOURCE</div>
        <div className="gantt-axis">
          {ticks.map((tick, index) => <span key={tick} style={{ left: `${index * 10}%` }}>{formatTime(tick).replace(":00 ", " ")}</span>)}
        </div>
        {state.resources.map((resource) => {
          const assignments = state.assignments.filter((item) => item.resourceId === resource.id);
          return (
            <div className="gantt-row" key={resource.id}>
              <div className="gantt-resource"><span style={{ background: RESOURCE_COLORS[resource.id] }} /><strong>{resource.name.split(" · ")[0]}</strong><small>{resource.name.split(" · ")[1]}</small></div>
              <div className="gantt-lane">
                {ticks.map((tick, index) => <i className="grid-line" key={tick} style={{ left: `${index * 10}%` }} />)}
                {windowsFor(resource).map((window, index) => <div key={`${window.start}-${index}`} className="downtime" style={{ left: pct(window.start), width: `calc(${pct(window.end)} - ${pct(window.start)})` }} title={`Downtime ${formatTime(window.start)}–${formatTime(window.end)}`}><span>DOWN</span></div>)}
                {deadlineConstraints.map((constraint) => {
                  const jobId = String(constraint.parameters.jobId);
                  const assignment = assignments.find((item) => item.jobId === jobId);
                  if (!assignment) return null;
                  const deadline = Number(constraint.parameters.deadline);
                  return <i key={constraint.id} className="deadline-line" style={{ left: pct(deadline) }} title={`${jobId} deadline ${formatTime(deadline)}`} />;
                })}
                {conflicts.filter((conflict) => conflict.resourceIds.includes(resource.id)).map((conflict, index) => {
                  const jobId = conflict.jobIds[0];
                  const job = state.jobs.find((item) => item.id === jobId);
                  if (!job) return null;
                  const deadlines = deadlineConstraints.filter((constraint) => constraint.parameters.jobId === jobId).map((constraint) => Number(constraint.parameters.deadline));
                  const end = deadlines.length ? Math.min(...deadlines) : Math.min(resource.availableUntil, resource.availableFrom + job.durationMinutes);
                  return <button key={`${jobId}-${index}`} className="conflict-band" style={{ left: pct(resource.availableFrom), width: `calc(${pct(end)} - ${pct(resource.availableFrom)})` }} onClick={() => state.selectJob(jobId)} title={conflict.summary}><AlertTriangle size={12} /><strong>{job.id.replace("job-", "J")}</strong><span>{durationLabel(job.durationMinutes)} required · insufficient window</span></button>;
                })}
                {assignments.map((assignment) => {
                  const job = state.jobs.find((item) => item.id === assignment.jobId)!;
                  const dimmed = affectedIds.size > 0 && !affectedIds.has(job.id);
                  return (
                    <button
                      key={assignment.jobId}
                      className={`gantt-block ${state.selectedJobId === job.id ? "selected" : ""} ${dimmed ? "dimmed" : ""} ${affectedIds.has(job.id) ? "affected" : ""}`}
                      style={{ left: pct(assignment.start), width: `calc(${pct(assignment.end)} - ${pct(assignment.start)})`, background: RESOURCE_COLORS[resource.id] }}
                      onClick={() => state.selectJob(job.id)}
                      title={`${job.name}\n${formatTime(assignment.start)}–${formatTime(assignment.end)}\n${durationLabel(job.durationMinutes)} on ${resource.name}`}
                    >
                      <strong>{job.id.replace("job-", "J")}</strong><span>{job.name}</span>
                    </button>
                  );
                })}
                {assignments.length === 0 && state.solveStatus === "UNSOLVED" && <span className="lane-empty">Awaiting solve</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="gantt-summary">
        <span><Clock3 size={14} /> Horizon <strong>8:00 AM–6:00 PM</strong></span>
        <span><Gauge size={14} /> Objective <strong>Minimize makespan</strong></span>
        <span><Cpu size={14} /> Engine <strong>HiGHS MILP</strong></span>
      </div>
    </section>
  );
}

function JobInspector({ job }: { job: Job }) {
  const state = useConstraintLab((value) => value);
  const assignment = state.assignments.find((item) => item.jobId === job.id);
  const constraints = state.constraints.filter((item) => affectedJobIds(item).includes(job.id));
  const conflict = state.infeasibility?.conflicts.find((item) => item.jobIds.includes(job.id));
  const [deadline, setDeadline] = useState(job.deadline ? `${Math.floor(job.deadline / 60).toString().padStart(2, "0")}:${(job.deadline % 60).toString().padStart(2, "0")}` : "");
  const saveDeadline = () => {
    if (!deadline) return void state.updateJob(job.id, { deadline: null });
    const [hours, minutes] = deadline.split(":").map(Number);
    state.updateJob(job.id, { deadline: hours * 60 + minutes });
  };
  return (
    <div className="inspector-body">
      <div className="selection-heading"><span className="job-code large">{job.id.replace("job-", "J")}</span><div><h3>{job.name}</h3><p>{assignment ? `${formatTime(assignment.start)}–${formatTime(assignment.end)}` : "Not currently scheduled"}</p></div></div>
      <div className="metric-grid">
        <label>Duration<strong>{durationLabel(job.durationMinutes)}</strong></label>
        <label>Priority<strong>P{job.priority}</strong></label>
        <label>Machine<strong>{assignment ? state.resources.find((item) => item.id === assignment.resourceId)?.name.split(" · ")[0] : job.requiredResource ? state.resources.find((item) => item.id === job.requiredResource)?.name.split(" · ")[0] : "Flexible"}</strong></label>
        <label>Predecessors<strong>{job.predecessors.length || "None"}</strong></label>
      </div>
      {conflict && <div className="conflict-callout"><AlertTriangle size={15} /><span>{conflict.summary}</span></div>}
      <div className="field-block"><label htmlFor="deadline-input">Deadline</label><div className="inline-field"><input id="deadline-input" type="time" value={deadline} onChange={(event) => setDeadline(event.target.value)} /><button onClick={saveDeadline}><Check size={14} /> Apply</button></div></div>
      <div className="subhead"><span>AFFECTING CONSTRAINTS</span><strong>{constraints.length}</strong></div>
      <div className="mini-constraint-list">{constraints.map((constraint) => <button key={constraint.id} onClick={() => state.selectConstraint(constraint.id)}><span className={`source-dot ${constraint.source}`} /> <span>{constraint.description}</span><ChevronRight size={13} /></button>)}</div>
    </div>
  );
}

function ConstraintRow({ constraint }: { constraint: Constraint }) {
  const state = useConstraintLab((value) => value);
  const isConflict = state.infeasibility?.conflicts.some((conflict) => conflict.constraintIds.includes(constraint.id));
  return (
    <button className={`constraint-row ${state.selectedConstraintId === constraint.id ? "selected" : ""} ${!constraint.enabled ? "disabled" : ""} ${isConflict ? "conflict" : ""}`} onClick={() => state.selectConstraint(constraint.id)}>
      <span className={`source-dot ${constraint.source}`} />
      <span className="constraint-copy"><strong>{constraint.type.replaceAll("_", " ")}</strong><small>{constraint.description}</small></span>
      <span className={`tiny-toggle ${constraint.enabled ? "on" : ""}`} role="switch" aria-checked={constraint.enabled} onClick={(event) => { event.stopPropagation(); state.setConstraintEnabled(constraint.id, !constraint.enabled); }}><i /></span>
    </button>
  );
}

function InspectorPanel() {
  const state = useConstraintLab((value) => value);
  const [tab, setTab] = useState<"inspector" | "constraints">("inspector");
  const selectedJob = state.jobs.find((item) => item.id === state.selectedJobId);
  const selectedConstraint = state.constraints.find((item) => item.id === state.selectedConstraintId);
  const stale = state.solvedModelVersion !== undefined && state.modelVersion !== state.solvedModelVersion;
  return (
    <aside className="panel right-panel">
      <div className="segmented inspector-tabs">
        <button className={tab === "inspector" ? "active" : ""} onClick={() => setTab("inspector")}>Inspector</button>
        <button className={tab === "constraints" ? "active" : ""} onClick={() => setTab("constraints")}>Constraints <span>{state.constraints.filter((item) => item.enabled).length}</span></button>
      </div>
      {tab === "inspector" ? (
        selectedJob ? <JobInspector key={selectedJob.id} job={selectedJob} /> : selectedConstraint ? (
          <div className="inspector-body">
            <div className="constraint-detail-icon"><SlidersHorizontal size={18} /></div>
            <div className="eyebrow">{selectedConstraint.type.replaceAll("_", " ")}</div><h3 className="constraint-title">{selectedConstraint.description}</h3>
            <dl className="detail-list"><div><dt>Stable ID</dt><dd>{selectedConstraint.id}</dd></div><div><dt>Source</dt><dd className="capitalize">{selectedConstraint.source}</dd></div><div><dt>State</dt><dd>{selectedConstraint.enabled ? "Enabled" : "Disabled"}</dd></div></dl>
            <pre>{JSON.stringify(selectedConstraint.parameters, null, 2)}</pre>
            <div className="detail-actions"><button onClick={() => state.setConstraintEnabled(selectedConstraint.id, !selectedConstraint.enabled)}>{selectedConstraint.enabled ? "Disable" : "Enable"}</button><button className="danger" onClick={() => state.removeConstraint(selectedConstraint.id)}><X size={13} /> Remove</button></div>
          </div>
        ) : (
          <div className="inspector-body overview">
            <div className="overview-mark"><Zap size={19} /></div><h3>Factory Scheduling</h3><p>Select a job or constraint to inspect the exact model state.</p>
            <div className="solve-card"><div><span>SOLVE STATUS</span><StatusBadge status={state.solveStatus} /></div><dl><div><dt>Model version</dt><dd>v{state.modelVersion}</dd></div><div><dt>Solved version</dt><dd>{state.solvedModelVersion ? `v${state.solvedModelVersion}` : "—"}</dd></div><div><dt>Runtime</dt><dd>{state.solveTimeMs ? `${state.solveTimeMs.toFixed(0)} ms` : "—"}</dd></div></dl></div>
            {stale && <div className="stale-callout"><AlertTriangle size={15} /><span><strong>Model changed</strong> — re-solve required.</span></div>}
            {state.solveStatus === "INFEASIBLE" && <div className="conflict-callout"><AlertTriangle size={15} /><span>{state.solverMessage}</span></div>}
          </div>
        )
      ) : <div className="constraint-list">{state.constraints.map((constraint) => <ConstraintRow key={constraint.id} constraint={constraint} />)}</div>}
      <div className="source-legend"><span><i className="source-dot user" /> Human</span><span><i className="source-dot agent" /> Agent</span><span><i className="source-dot system" /> System</span></div>
    </aside>
  );
}

const ActorIcon = ({ actor }: { actor: Actor }) => actor === "human" ? <UserRound size={13} /> : actor === "agent" ? <Bot size={13} /> : actor === "solver" ? <Cpu size={13} /> : <Settings2 size={13} />;

function AuditTimeline() {
  const state = useConstraintLab((value) => value);
  const [devOpen, setDevOpen] = useState(false);
  return (
    <section className="panel audit-panel">
      <div className="audit-heading"><div><span className="eyebrow">SHARED HISTORY</span><h2>Audit timeline</h2></div><button className="dev-toggle" onClick={() => setDevOpen((value) => !value)}><Braces size={14} /> Developer panel {devOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button></div>
      <div className="audit-content">
        <div className="audit-events">
          {[...state.auditEvents].reverse().slice(0, 8).map((event) => (
            <details className={`audit-event actor-${event.actor}`} key={event.id}>
              <summary><span className="actor-icon"><ActorIcon actor={event.actor} /></span><span className="event-copy"><strong>{event.summary}</strong><small>{event.actor} · v{event.modelVersionBefore}{event.modelVersionAfter !== event.modelVersionBefore ? ` → v${event.modelVersionAfter}` : ""}</small></span><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></summary>
              <pre>{JSON.stringify({ input: event.input, output: event.output }, null, 2)}</pre>
            </details>
          ))}
        </div>
        {devOpen && <div className="dev-panel"><div className="dev-status"><span className={`connection-dot ${state.webMcpStatus}`} /> <strong>WebMCP</strong><span>{state.webMcpStatus}</span></div><p>{state.webMcpStatus === "unavailable" ? "Unavailable in this browser. The human interface remains fully operational." : "Top-level document connection status."}</p><div className="subhead"><span>REGISTERED TOOLS</span><strong>{state.registeredTools.length}</strong></div><div className="tool-pills">{state.registeredTools.length ? state.registeredTools.map((tool) => <span key={tool}>{tool}</span>) : <em>Waiting for registration…</em>}</div><div className="subhead timing-head"><span>RECENT TOOL CALLS</span><strong>{state.toolTimings.length}</strong></div><div className="timing-list">{state.toolTimings.length ? state.toolTimings.slice(0, 5).map((timing) => <div key={timing.id}><span className={timing.ok ? "ok" : "failed"}>{timing.ok ? "OK" : "ERR"}</span><code>{timing.toolName}</code><time>{timing.durationMs.toFixed(1)} ms</time></div>) : <em>No calls yet</em>}</div></div>}
      </div>
    </section>
  );
}

export function App() {
  const state = useConstraintLab((value) => value);
  const stale = state.solvedModelVersion !== undefined && state.modelVersion !== state.solvedModelVersion;
  const headerMessage = useMemo(() => stale ? "Model changed — re-solve required." : state.solveStatus === "INFEASIBLE" ? "Conflict detected — inspect constraints." : state.solveStatus === "UNSOLVED" ? "Ready for a deterministic solve." : `Solved model v${state.solvedModelVersion}.`, [stale, state.solveStatus, state.solvedModelVersion]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Wrench size={17} /></div><div><strong>ConstraintLab</strong><span>OPTIMIZATION WORKSPACE</span></div></div>
        <div className="scenario"><span>SCENARIO</span><strong>Factory Scheduling</strong><small>15 jobs · 4 machines · makespan</small></div>
        <div className="top-status"><div><StatusBadge status={state.solveStatus} /><span className={stale ? "stale-text" : ""}>{headerMessage}</span></div><span className="version-chip">MODEL v{state.modelVersion}</span></div>
        <button className="reset-button" title="Reset demo scenario" onClick={state.resetScenario}><RotateCcw size={15} /></button>
        <button className="solve-button" disabled={state.solveStatus === "SOLVING"} onClick={() => void state.solveProblem("human")}>
          {state.solveStatus === "SOLVING" ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />} {state.solveStatus === "SOLVING" ? "SOLVING" : "SOLVE"}
          <kbd>⌘↵</kbd>
        </button>
      </header>
      <main className="workspace"><JobsPanel /><GanttChart /><InspectorPanel /><AuditTimeline /></main>
    </div>
  );
}
