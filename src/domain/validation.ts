import type { Constraint, ConstraintType, Job, Resource, ToolFailure } from "./types";
import type { AddConstraintInput } from "../webmcp/schemas";
import { formatTime } from "./time";

export function failure(
  code: string,
  message: string,
  recoverable = true,
  suggestedAction?: string,
): ToolFailure {
  return { ok: false, code, message, recoverable, suggestedAction };
}

export function hasPrecedenceCycle(jobs: Job[]): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const predecessor of byId.get(id)?.predecessors ?? []) {
      if (visit(predecessor)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return jobs.some((job) => visit(job.id));
}

export function constraintDescription(
  input: AddConstraintInput,
  jobs: Job[],
  resources: Resource[],
): string {
  const jobName = (id: string) => jobs.find((job) => job.id === id)?.name ?? id;
  const resourceName = (id: string) => resources.find((resource) => resource.id === id)?.name.split(" · ")[0] ?? id;
  const p = input.parameters as Record<string, string | number>;
  switch (input.type) {
    case "precedence":
      return `${jobName(String(p.predecessorId))} precedes ${jobName(String(p.successorId))}`;
    case "resource_assignment":
      return `${jobName(String(p.jobId))} runs on ${resourceName(String(p.resourceId))}`;
    case "resource_availability":
      return `${resourceName(String(p.resourceId))} unavailable ${formatTime(Number(p.start))}–${formatTime(Number(p.end))}`;
    case "deadline":
      return `${jobName(String(p.jobId))} completes by ${formatTime(Number(p.deadline))}`;
    case "earliest_start":
      return `${jobName(String(p.jobId))} starts after ${formatTime(Number(p.earliestStart))}`;
    case "locked_start":
      return `${jobName(String(p.jobId))} starts at ${formatTime(Number(p.start))}`;
  }
}

export function constraintReferencesAreValid(
  type: ConstraintType,
  parameters: Record<string, unknown>,
  jobs: Job[],
  resources: Resource[],
): ToolFailure | null {
  const jobIds = new Set(jobs.map((job) => job.id));
  const resourceIds = new Set(resources.map((resource) => resource.id));
  const jobKeys = type === "precedence" ? ["predecessorId", "successorId"] : type === "resource_availability" ? [] : ["jobId"];
  for (const key of jobKeys) {
    const value = parameters[key];
    if (typeof value !== "string" || !jobIds.has(value)) {
      return failure("UNKNOWN_JOB", `Unknown job ID: ${String(value)}.`, true, "Call get_problem_state to inspect current job IDs.");
    }
  }
  if (type === "resource_assignment" || type === "resource_availability") {
    const value = parameters.resourceId;
    if (typeof value !== "string" || !resourceIds.has(value)) {
      return failure("UNKNOWN_RESOURCE", `Unknown resource ID: ${String(value)}.`, true, "Call get_problem_state to inspect current resource IDs.");
    }
  }
  if (type === "precedence" && parameters.predecessorId === parameters.successorId) {
    return failure("INVALID_PRECEDENCE", "A job cannot precede itself.");
  }
  return null;
}

export function affectedJobIds(constraint: Constraint): string[] {
  const ids = [constraint.parameters.jobId, constraint.parameters.predecessorId, constraint.parameters.successorId];
  return ids.filter((value): value is string => typeof value === "string");
}
