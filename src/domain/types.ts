export type Actor = "human" | "agent" | "solver" | "system";

export type Job = {
  id: string;
  name: string;
  durationMinutes: number;
  priority: number;
  earliestStart?: number;
  deadline?: number;
  requiredResource?: string;
  predecessors: string[];
  lockedStart?: number;
  lockedResource?: string;
};

export type Resource = {
  id: string;
  name: string;
  availableFrom: number;
  availableUntil: number;
  unavailableWindows: { start: number; end: number }[];
};

export type ConstraintType =
  | "precedence"
  | "resource_assignment"
  | "resource_availability"
  | "deadline"
  | "earliest_start"
  | "locked_start";

export type Constraint = {
  id: string;
  type: ConstraintType;
  description: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
  source: "user" | "agent" | "system";
};

export type OptimizationObjective = { type: "makespan" };

export type SolveStatus =
  | "UNSOLVED"
  | "SOLVING"
  | "OPTIMAL"
  | "FEASIBLE"
  | "INFEASIBLE"
  | "ERROR";

export type Assignment = {
  jobId: string;
  resourceId: string;
  start: number;
  end: number;
};

export type Conflict = {
  constraintIds: string[];
  jobIds: string[];
  resourceIds: string[];
  summary: string;
};

export interface InfeasibilityResult {
  status: "infeasible";
  conflicts: Conflict[];
}

export type SolverResult =
  | {
      status: "optimal" | "feasible";
      assignments: Assignment[];
      objectiveValue: number;
      solveTimeMs: number;
    }
  | ({ solveTimeMs: number } & InfeasibilityResult)
  | { status: "error"; message: string; solveTimeMs: number };

export type OptimizationProblem = {
  jobs: Job[];
  resources: Resource[];
  constraints: Constraint[];
  objective: OptimizationObjective;
  modelVersion: number;
};

export type AuditEvent = {
  id: string;
  timestamp: number;
  actor: Actor;
  type: "mutation" | "solve" | "tool_call" | "system";
  summary: string;
  modelVersionBefore: number;
  modelVersionAfter: number;
  input?: unknown;
  output?: unknown;
};

export type ToolTiming = {
  id: string;
  toolName: string;
  durationMs: number;
  ok: boolean;
  timestamp: number;
};

export type ToolSuccess<T> = { ok: true; data: T };
export type ToolFailure = {
  ok: false;
  code: string;
  message: string;
  recoverable: boolean;
  suggestedAction?: string;
};
export type ActionResult<T> = ToolSuccess<T> | ToolFailure;
