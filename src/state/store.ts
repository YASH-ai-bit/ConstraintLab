import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { factoryConstraints, factoryJobs, factoryResources } from "../data/factoryScenario";
import type {
  ActionResult,
  Actor,
  Assignment,
  AuditEvent,
  Constraint,
  InfeasibilityResult,
  Job,
  OptimizationObjective,
  OptimizationProblem,
  Resource,
  SolveStatus,
  SolverResult,
  ToolTiming,
} from "../domain/types";
import { addConstraintSchema, addJobSchema, setObjectiveSchema, updateJobSchema } from "../webmcp/schemas";
import type { AddConstraintInput, AddJobInput, UpdateJobInput } from "../webmcp/schemas";
import { constraintDescription, constraintReferencesAreValid, failure, hasPrecedenceCycle } from "../domain/validation";
import { formatTime } from "../domain/time";

type WebMcpStatus = "checking" | "native" | "polyfill" | "unavailable";

export type ConstraintLabState = {
  scenarioName: "Factory Scheduling";
  jobs: Job[];
  resources: Resource[];
  constraints: Constraint[];
  objective: OptimizationObjective;
  modelVersion: number;
  solveStatus: SolveStatus;
  solvedModelVersion?: number;
  assignments: Assignment[];
  objectiveValue?: number;
  solveTimeMs?: number;
  solverMessage?: string;
  infeasibility?: InfeasibilityResult;
  selectedJobId?: string;
  selectedConstraintId?: string;
  auditEvents: AuditEvent[];
  webMcpStatus: WebMcpStatus;
  registeredTools: string[];
  toolTimings: ToolTiming[];
  addJob: (input: AddJobInput, actor?: Actor) => ActionResult<Job>;
  updateJob: (id: string, updates: UpdateJobInput, actor?: Actor) => ActionResult<Job>;
  addConstraint: (input: AddConstraintInput, actor?: Actor) => ActionResult<Constraint>;
  removeConstraint: (id: string, actor?: Actor) => ActionResult<{ id: string }>;
  setConstraintEnabled: (id: string, enabled: boolean, actor?: Actor) => ActionResult<Constraint>;
  setObjective: (objective: OptimizationObjective, actor?: Actor) => ActionResult<OptimizationObjective>;
  solveProblem: (actor?: Actor, signal?: AbortSignal) => Promise<ActionResult<SolverResult>>;
  onSolverResult: (result: SolverResult, solvedVersion: number, actor?: Actor) => void;
  selectJob: (id?: string) => void;
  selectConstraint: (id?: string) => void;
  setWebMcpStatus: (status: WebMcpStatus, tools?: string[]) => void;
  recordToolTiming: (timing: ToolTiming) => void;
  resetScenario: () => void;
};

let sequence = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
const clone = <T,>(value: T): T => structuredClone(value);

function initialAudit(): AuditEvent[] {
  return [{
    id: uid("audit"),
    timestamp: Date.now(),
    actor: "system",
    type: "system",
    summary: "Factory Scheduling scenario loaded",
    modelVersionBefore: 1,
    modelVersionAfter: 1,
    output: { jobs: factoryJobs.length, resources: factoryResources.length, constraints: factoryConstraints.length },
  }];
}

function auditEvent(actor: Actor, summary: string, before: number, after: number, input?: unknown, output?: unknown): AuditEvent {
  return { id: uid("audit"), timestamp: Date.now(), actor, type: actor === "solver" ? "solve" : "mutation", summary, modelVersionBefore: before, modelVersionAfter: after, input: clone(input), output: clone(output) };
}

const modelChangedSolveState = {
  solveStatus: "UNSOLVED" as const,
  infeasibility: undefined,
  solverMessage: undefined,
};

function fieldConstraint(job: Job, type: Constraint["type"], value: unknown, resources: Resource[]): Constraint | null {
  const base = { enabled: true, source: "user" as const };
  if (type === "deadline" && typeof value === "number") return { ...base, id: `job-field-deadline-${job.id}`, type, description: `${job.name} completes by ${formatTime(value)}`, parameters: { jobId: job.id, deadline: value, fieldBacked: true } };
  if (type === "earliest_start" && typeof value === "number") return { ...base, id: `job-field-earliest-${job.id}`, type, description: `${job.name} starts after ${formatTime(value)}`, parameters: { jobId: job.id, earliestStart: value, fieldBacked: true } };
  if (type === "resource_assignment" && typeof value === "string") return { ...base, id: `job-field-assignment-${job.id}`, type, description: `${job.name} runs on ${resources.find((resource) => resource.id === value)?.name.split(" · ")[0] ?? value}`, parameters: { jobId: job.id, resourceId: value, fieldBacked: true } };
  return null;
}

export function createConstraintLabStore() {
  return createStore<ConstraintLabState>((set, get) => ({
    scenarioName: "Factory Scheduling",
    jobs: clone(factoryJobs),
    resources: clone(factoryResources),
    constraints: clone(factoryConstraints),
    objective: { type: "makespan" },
    modelVersion: 1,
    solveStatus: "UNSOLVED",
    assignments: [],
    auditEvents: initialAudit(),
    webMcpStatus: "checking",
    registeredTools: [],
    toolTimings: [],

    addJob: (input, actor = "human") => {
      const parsed = addJobSchema.safeParse(input);
      if (!parsed.success) return failure("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid job.");
      const state = get();
      const id = parsed.data.id ?? uid("job");
      if (state.jobs.some((job) => job.id === id)) return failure("DUPLICATE_JOB", `Job ID ${id} already exists.`);
      if (parsed.data.requiredResource && !state.resources.some((resource) => resource.id === parsed.data.requiredResource)) return failure("UNKNOWN_RESOURCE", `Unknown resource ID: ${parsed.data.requiredResource}.`);
      const unknownPred = parsed.data.predecessors.find((pred) => !state.jobs.some((job) => job.id === pred));
      if (unknownPred) return failure("UNKNOWN_JOB", `Unknown predecessor ID: ${unknownPred}.`);
      const job: Job = { ...parsed.data, id, predecessors: [...parsed.data.predecessors] };
      if (hasPrecedenceCycle([...state.jobs, job])) return failure("PRECEDENCE_CYCLE", "This predecessor relationship creates a cycle.");
      const generated: Constraint[] = [];
      for (const [type, value] of [["deadline", job.deadline], ["earliest_start", job.earliestStart], ["resource_assignment", job.requiredResource]] as const) {
        const item = fieldConstraint(job, type, value, state.resources);
        if (item) generated.push(item);
      }
      for (const predecessorId of job.predecessors) generated.push({ id: `precedence-${predecessorId}-${job.id}`, type: "precedence", description: `${state.jobs.find((item) => item.id === predecessorId)?.name ?? predecessorId} precedes ${job.name}`, enabled: true, parameters: { predecessorId, successorId: job.id, fieldBacked: true }, source: actor === "agent" ? "agent" : "user" });
      const nextVersion = state.modelVersion + 1;
      set({ ...modelChangedSolveState, jobs: [...state.jobs, job], constraints: [...state.constraints, ...generated], modelVersion: nextVersion, auditEvents: [...state.auditEvents, auditEvent(actor, `Added ${job.name}`, state.modelVersion, nextVersion, input, job)] });
      return { ok: true, data: clone(job) };
    },

    updateJob: (id, updates, actor = "human") => {
      const parsed = updateJobSchema.safeParse(updates);
      if (!parsed.success) return failure("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid update.");
      const state = get();
      const current = state.jobs.find((job) => job.id === id);
      if (!current) return failure("UNKNOWN_JOB", `Unknown job ID: ${id}.`, true, "Call get_problem_state to inspect current job IDs.");
      const data = parsed.data;
      if (data.requiredResource && !state.resources.some((resource) => resource.id === data.requiredResource)) return failure("UNKNOWN_RESOURCE", `Unknown resource ID: ${data.requiredResource}.`);
      const predecessorIds = data.predecessors ?? current.predecessors;
      const unknownPred = predecessorIds.find((pred) => !state.jobs.some((job) => job.id === pred));
      if (unknownPred) return failure("UNKNOWN_JOB", `Unknown predecessor ID: ${unknownPred}.`);
      if (predecessorIds.includes(id)) return failure("INVALID_PRECEDENCE", "A job cannot precede itself.");
      const normalized = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === null ? undefined : value]));
      const updated: Job = { ...current, ...normalized, predecessors: [...predecessorIds] };
      const nextJobs = state.jobs.map((job) => job.id === id ? updated : job);
      if (hasPrecedenceCycle(nextJobs)) return failure("PRECEDENCE_CYCLE", "This predecessor relationship creates a cycle.");
      let constraints = [...state.constraints];
      const replaceFieldConstraint = (type: Constraint["type"], value: unknown) => {
        constraints = constraints.filter((constraint) => !(constraint.type === type && constraint.parameters.jobId === id && constraint.parameters.fieldBacked === true));
        const next = fieldConstraint(updated, type, value, state.resources);
        if (next) constraints.push({ ...next, source: actor === "agent" ? "agent" : "user" });
      };
      if ("deadline" in data) replaceFieldConstraint("deadline", updated.deadline);
      if ("earliestStart" in data) replaceFieldConstraint("earliest_start", updated.earliestStart);
      if ("requiredResource" in data) replaceFieldConstraint("resource_assignment", updated.requiredResource);
      if ("predecessors" in data) {
        constraints = constraints.filter((constraint) => !(constraint.type === "precedence" && constraint.parameters.successorId === id && constraint.parameters.fieldBacked === true));
        for (const predecessorId of updated.predecessors) constraints.push({ id: `precedence-${predecessorId}-${id}`, type: "precedence", description: `${nextJobs.find((job) => job.id === predecessorId)?.name ?? predecessorId} precedes ${updated.name}`, enabled: true, parameters: { predecessorId, successorId: id, fieldBacked: true }, source: actor === "agent" ? "agent" : "user" });
      }
      const nextVersion = state.modelVersion + 1;
      set({ ...modelChangedSolveState, jobs: nextJobs, constraints, modelVersion: nextVersion, auditEvents: [...state.auditEvents, auditEvent(actor, `Updated ${updated.name}`, state.modelVersion, nextVersion, { id, updates }, updated)] });
      return { ok: true, data: clone(updated) };
    },

    addConstraint: (input, actor = "human") => {
      const parsed = addConstraintSchema.safeParse(input);
      if (!parsed.success) return failure("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid constraint.");
      const state = get();
      const invalidReference = constraintReferencesAreValid(parsed.data.type, parsed.data.parameters, state.jobs, state.resources);
      if (invalidReference) return invalidReference;
      const id = parsed.data.id ?? uid("constraint");
      if (state.constraints.some((constraint) => constraint.id === id)) return failure("DUPLICATE_CONSTRAINT", `Constraint ID ${id} already exists.`);
      if (parsed.data.type === "precedence") {
        const predecessorId = parsed.data.parameters.predecessorId;
        const successorId = parsed.data.parameters.successorId;
        const nextJobs = state.jobs.map((job) => job.id === successorId ? { ...job, predecessors: [...new Set([...job.predecessors, predecessorId])] } : job);
        if (hasPrecedenceCycle(nextJobs)) return failure("PRECEDENCE_CYCLE", "This precedence constraint creates a cycle.");
      }
      const constraint: Constraint = {
        id,
        type: parsed.data.type,
        description: parsed.data.description ?? constraintDescription(parsed.data, state.jobs, state.resources),
        enabled: parsed.data.enabled ?? true,
        parameters: { ...parsed.data.parameters },
        source: actor === "agent" ? "agent" : parsed.data.source ?? (actor === "system" ? "system" : "user"),
      };
      const nextVersion = state.modelVersion + 1;
      set({ ...modelChangedSolveState, constraints: [...state.constraints, constraint], modelVersion: nextVersion, selectedConstraintId: constraint.id, auditEvents: [...state.auditEvents, auditEvent(actor, `Added ${constraint.type.replaceAll("_", " ")} constraint`, state.modelVersion, nextVersion, input, constraint)] });
      return { ok: true, data: clone(constraint) };
    },

    removeConstraint: (id, actor = "human") => {
      const state = get();
      const constraint = state.constraints.find((item) => item.id === id);
      if (!constraint) return failure("UNKNOWN_CONSTRAINT", `Unknown constraint ID: ${id}.`);
      let jobs = state.jobs;
      if (constraint.parameters.fieldBacked === true) {
        if (constraint.type === "precedence") {
          jobs = jobs.map((job) => job.id === constraint.parameters.successorId ? { ...job, predecessors: job.predecessors.filter((predecessorId) => predecessorId !== constraint.parameters.predecessorId) } : job);
        } else {
          const jobId = constraint.parameters.jobId;
          jobs = jobs.map((job) => {
            if (job.id !== jobId) return job;
            if (constraint.type === "resource_assignment") return { ...job, requiredResource: undefined };
            if (constraint.type === "deadline") return { ...job, deadline: undefined };
            if (constraint.type === "earliest_start") return { ...job, earliestStart: undefined };
            if (constraint.type === "locked_start") return { ...job, lockedStart: undefined };
            return job;
          });
        }
      }
      const nextVersion = state.modelVersion + 1;
      set({ ...modelChangedSolveState, jobs, constraints: state.constraints.filter((item) => item.id !== id), modelVersion: nextVersion, selectedConstraintId: state.selectedConstraintId === id ? undefined : state.selectedConstraintId, auditEvents: [...state.auditEvents, auditEvent(actor, `Removed ${constraint.description}`, state.modelVersion, nextVersion, { id }, constraint)] });
      return { ok: true, data: { id } };
    },

    setConstraintEnabled: (id, enabled, actor = "human") => {
      const state = get();
      const constraint = state.constraints.find((item) => item.id === id);
      if (!constraint) return failure("UNKNOWN_CONSTRAINT", `Unknown constraint ID: ${id}.`);
      const updated = { ...constraint, enabled };
      const nextVersion = state.modelVersion + 1;
      set({ ...modelChangedSolveState, constraints: state.constraints.map((item) => item.id === id ? updated : item), modelVersion: nextVersion, auditEvents: [...state.auditEvents, auditEvent(actor, `${enabled ? "Enabled" : "Disabled"} ${constraint.description}`, state.modelVersion, nextVersion, { id, enabled }, updated)] });
      return { ok: true, data: clone(updated) };
    },

    setObjective: (objective, actor = "human") => {
      const parsed = setObjectiveSchema.safeParse(objective);
      if (!parsed.success) return failure("UNSUPPORTED_OBJECTIVE", "Only makespan is supported in this build.", false);
      const state = get();
      if (state.objective.type === parsed.data.type) return { ok: true, data: clone(state.objective) };
      const nextVersion = state.modelVersion + 1;
      set({ ...modelChangedSolveState, objective: parsed.data, modelVersion: nextVersion, auditEvents: [...state.auditEvents, auditEvent(actor, "Set objective to minimize makespan", state.modelVersion, nextVersion, objective, parsed.data)] });
      return { ok: true, data: clone(parsed.data) };
    },

    solveProblem: async (actor = "human", signal) => {
      const state = get();
      if (state.solveStatus === "SOLVING") return failure("SOLVE_IN_PROGRESS", "A solve is already in progress.");
      if (signal?.aborted) return failure("SOLVE_CANCELLED", "The solve was cancelled before it started.", true, "Retry solve_problem when ready.");
      const model: OptimizationProblem = { jobs: clone(state.jobs), resources: clone(state.resources), constraints: clone(state.constraints), objective: clone(state.objective), modelVersion: state.modelVersion };
      const previousSolveState = { solveStatus: state.solveStatus, infeasibility: state.infeasibility, solverMessage: state.solverMessage };
      set({ solveStatus: "SOLVING", solverMessage: undefined, infeasibility: undefined, auditEvents: [...state.auditEvents, auditEvent(actor, "Started deterministic solve", state.modelVersion, state.modelVersion, { modelVersion: state.modelVersion })] });
      try {
        const { solveInWorker } = await import("../solver/solverClient");
        const result = await solveInWorker(model, signal);
        if (signal?.aborted) throw Object.assign(new Error("Solve cancelled."), { name: "AbortError" });
        get().onSolverResult(result, model.modelVersion, "solver");
        return { ok: true, data: result };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          const current = get();
          const restore = current.modelVersion === model.modelVersion ? previousSolveState : {};
          set({ ...restore, auditEvents: [...current.auditEvents, auditEvent("solver", "Solve cancelled", current.modelVersion, current.modelVersion, { solvedVersion: model.modelVersion })] });
          return failure("SOLVE_CANCELLED", "The solve was cancelled before completion.", true, "Retry solve_problem when ready.");
        }
        const result: SolverResult = { status: "error", message: error instanceof Error ? error.message : "Unknown solver error.", solveTimeMs: 0 };
        get().onSolverResult(result, model.modelVersion, "solver");
        return { ok: true, data: result };
      }
    },

    onSolverResult: (result, solvedVersion, actor = "solver") => {
      const state = get();
      const base = { solvedModelVersion: solvedVersion, solveTimeMs: result.solveTimeMs };
      if (result.status === "optimal" || result.status === "feasible") {
        set({ ...base, solveStatus: result.status === "optimal" ? "OPTIMAL" : "FEASIBLE", assignments: clone(result.assignments), objectiveValue: result.objectiveValue, infeasibility: undefined, solverMessage: undefined, auditEvents: [...state.auditEvents, auditEvent(actor, `${result.status === "optimal" ? "Optimal" : "Feasible"} schedule found`, state.modelVersion, state.modelVersion, { solvedVersion }, result)] });
      } else if (result.status === "infeasible") {
        set({ ...base, solveStatus: "INFEASIBLE", assignments: [], objectiveValue: undefined, infeasibility: { status: "infeasible", conflicts: clone(result.conflicts) }, solverMessage: result.conflicts[0]?.summary ?? "No feasible schedule exists.", selectedJobId: result.conflicts[0]?.jobIds[0], selectedConstraintId: undefined, auditEvents: [...state.auditEvents, auditEvent(actor, "Model proven infeasible", state.modelVersion, state.modelVersion, { solvedVersion }, result)] });
      } else if (result.status === "error") {
        set({ ...base, solveStatus: "ERROR", assignments: [], objectiveValue: undefined, infeasibility: undefined, solverMessage: result.message, auditEvents: [...state.auditEvents, auditEvent(actor, "Solver error", state.modelVersion, state.modelVersion, { solvedVersion }, result)] });
      }
    },

    selectJob: (id) => set({ selectedJobId: id, selectedConstraintId: id ? undefined : get().selectedConstraintId }),
    selectConstraint: (id) => set({ selectedConstraintId: id, selectedJobId: id ? undefined : get().selectedJobId }),
    setWebMcpStatus: (status, tools = []) => set({ webMcpStatus: status, registeredTools: tools }),
    recordToolTiming: (timing) => set((state) => ({ toolTimings: [timing, ...state.toolTimings].slice(0, 12) })),
    resetScenario: () => set({ jobs: clone(factoryJobs), resources: clone(factoryResources), constraints: clone(factoryConstraints), objective: { type: "makespan" }, modelVersion: 1, solveStatus: "UNSOLVED", solvedModelVersion: undefined, assignments: [], objectiveValue: undefined, solveTimeMs: undefined, solverMessage: undefined, infeasibility: undefined, selectedJobId: undefined, selectedConstraintId: undefined, auditEvents: initialAudit() }),
  }));
}

export const appStore = createConstraintLabStore();
export const useConstraintLab = <T,>(selector: (state: ConstraintLabState) => T): T => useStore(appStore, selector);
