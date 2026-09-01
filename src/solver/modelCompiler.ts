import type { Constraint, OptimizationProblem } from "../domain/types";
import type { CompiledModel } from "./types";

export const BIG_M = 2880;
export const MAX_START = 1440;

const token = (value: string) => Array.from(value).map((character) => character.codePointAt(0)!.toString(16)).join("_");
export const startVariable = (jobId: string) => `s_${token(jobId)}`;
export const assignmentVariable = (jobId: string, resourceId: string) => `a_${token(jobId)}__${token(resourceId)}`;
export const orderVariable = (firstJobId: string, secondJobId: string, resourceId: string) => `o_${token(firstJobId)}__${token(secondJobId)}__${token(resourceId)}`;
export const downtimeVariable = (jobId: string, resourceId: string, windowIndex: number) => `d_${token(jobId)}__${token(resourceId)}__${windowIndex}`;

type DowntimeWindow = { start: number; end: number; constraintId?: string };

function enabled(problem: OptimizationProblem, type: Constraint["type"]): Constraint[] {
  return problem.constraints.filter((constraint) => constraint.enabled && constraint.type === type);
}

function hasConstraint(problem: OptimizationProblem, type: Constraint["type"], predicate: (constraint: Constraint) => boolean): boolean {
  return problem.constraints.filter((constraint) => constraint.type === type).some(predicate);
}

function availabilityWindows(problem: OptimizationProblem, resourceId: string): DowntimeWindow[] {
  const resource = problem.resources.find((item) => item.id === resourceId)!;
  const base = resource.unavailableWindows.map((window) => ({ ...window }));
  const explicit = enabled(problem, "resource_availability")
    .filter((constraint) => constraint.parameters.resourceId === resourceId)
    .map((constraint) => ({ start: Number(constraint.parameters.start), end: Number(constraint.parameters.end), constraintId: constraint.id }));
  return [...base, ...explicit].sort((a, b) => a.start - b.start || a.end - b.end);
}

function rowName(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}_${parts.map((part) => token(String(part))).join("_")}`;
}

export function compileModelToLp(problem: OptimizationProblem): CompiledModel {
  if (problem.objective.type !== "makespan") throw new Error(`Unsupported objective: ${String(problem.objective.type)}`);
  if (!problem.jobs.length) throw new Error("At least one job is required.");
  if (!problem.resources.length) throw new Error("At least one resource is required.");

  const rows: string[] = [];
  const binaries = new Set<string>();

  for (const job of problem.jobs) {
    const start = startVariable(job.id);
    rows.push(` ${rowName("makespan", job.id)}: cmax - ${start} >= ${job.durationMinutes}`);
    const assignments = problem.resources.map((resource) => {
      const variable = assignmentVariable(job.id, resource.id);
      binaries.add(variable);
      return variable;
    });
    rows.push(` ${rowName("assign", job.id)}: ${assignments.join(" + ")} = 1`);

    for (const resource of problem.resources) {
      const assignment = assignmentVariable(job.id, resource.id);
      rows.push(` ${rowName("available_from", job.id, resource.id)}: ${start} - ${BIG_M} ${assignment} >= ${resource.availableFrom - BIG_M}`);
      rows.push(` ${rowName("available_until", job.id, resource.id)}: ${start} + ${BIG_M} ${assignment} <= ${resource.availableUntil - job.durationMinutes + BIG_M}`);
      availabilityWindows(problem, resource.id).forEach((window, windowIndex) => {
        const before = downtimeVariable(job.id, resource.id, windowIndex);
        binaries.add(before);
        rows.push(` ${rowName("downtime_before", job.id, resource.id, windowIndex)}: ${start} + ${BIG_M} ${before} + ${BIG_M} ${assignment} <= ${window.start + 2 * BIG_M - job.durationMinutes}`);
        rows.push(` ${rowName("downtime_after", job.id, resource.id, windowIndex)}: ${start} + ${BIG_M} ${before} - ${BIG_M} ${assignment} >= ${window.end - BIG_M}`);
      });
    }

    if (job.requiredResource && !hasConstraint(problem, "resource_assignment", (constraint) => constraint.parameters.jobId === job.id)) {
      rows.push(` ${rowName("implicit_resource", job.id)}: ${assignmentVariable(job.id, job.requiredResource)} = 1`);
    }
    if (job.deadline !== undefined && !hasConstraint(problem, "deadline", (constraint) => constraint.parameters.jobId === job.id)) {
      rows.push(` ${rowName("implicit_deadline", job.id)}: ${start} <= ${job.deadline - job.durationMinutes}`);
    }
    if (job.earliestStart !== undefined && !hasConstraint(problem, "earliest_start", (constraint) => constraint.parameters.jobId === job.id)) {
      rows.push(` ${rowName("implicit_earliest", job.id)}: ${start} >= ${job.earliestStart}`);
    }
    if (job.lockedStart !== undefined && !hasConstraint(problem, "locked_start", (constraint) => constraint.parameters.jobId === job.id)) {
      rows.push(` ${rowName("implicit_locked", job.id)}: ${start} = ${job.lockedStart}`);
    }
  }

  for (let firstIndex = 0; firstIndex < problem.jobs.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < problem.jobs.length; secondIndex += 1) {
      const first = problem.jobs[firstIndex];
      const second = problem.jobs[secondIndex];
      for (const resource of problem.resources) {
        const order = orderVariable(first.id, second.id, resource.id);
        const firstAssignment = assignmentVariable(first.id, resource.id);
        const secondAssignment = assignmentVariable(second.id, resource.id);
        binaries.add(order);
        rows.push(` ${rowName("order_first", first.id, second.id, resource.id)}: ${startVariable(second.id)} - ${startVariable(first.id)} - ${BIG_M} ${order} - ${BIG_M} ${firstAssignment} - ${BIG_M} ${secondAssignment} >= ${first.durationMinutes - 3 * BIG_M}`);
        rows.push(` ${rowName("order_second", first.id, second.id, resource.id)}: ${startVariable(first.id)} - ${startVariable(second.id)} + ${BIG_M} ${order} - ${BIG_M} ${firstAssignment} - ${BIG_M} ${secondAssignment} >= ${second.durationMinutes - 2 * BIG_M}`);
      }
    }
  }

  const representedPrecedence = new Set(problem.constraints.filter((constraint) => constraint.type === "precedence").map((constraint) => `${String(constraint.parameters.predecessorId)}->${String(constraint.parameters.successorId)}`));
  for (const constraint of enabled(problem, "precedence")) {
    const predecessorId = String(constraint.parameters.predecessorId);
    const successorId = String(constraint.parameters.successorId);
    const predecessor = problem.jobs.find((job) => job.id === predecessorId);
    if (!predecessor) continue;
    rows.push(` ${rowName("precedence", constraint.id)}: ${startVariable(successorId)} - ${startVariable(predecessorId)} >= ${predecessor.durationMinutes}`);
  }
  for (const job of problem.jobs) {
    for (const predecessorId of job.predecessors) {
      if (representedPrecedence.has(`${predecessorId}->${job.id}`)) continue;
      const predecessor = problem.jobs.find((item) => item.id === predecessorId);
      if (predecessor) rows.push(` ${rowName("implicit_precedence", predecessorId, job.id)}: ${startVariable(job.id)} - ${startVariable(predecessorId)} >= ${predecessor.durationMinutes}`);
    }
  }

  for (const constraint of enabled(problem, "resource_assignment")) {
    rows.push(` ${rowName("resource_assignment", constraint.id)}: ${assignmentVariable(String(constraint.parameters.jobId), String(constraint.parameters.resourceId))} = 1`);
  }
  for (const constraint of enabled(problem, "deadline")) {
    const job = problem.jobs.find((item) => item.id === constraint.parameters.jobId);
    if (job) rows.push(` ${rowName("deadline", constraint.id)}: ${startVariable(job.id)} <= ${Number(constraint.parameters.deadline) - job.durationMinutes}`);
  }
  for (const constraint of enabled(problem, "earliest_start")) {
    rows.push(` ${rowName("earliest", constraint.id)}: ${startVariable(String(constraint.parameters.jobId))} >= ${Number(constraint.parameters.earliestStart)}`);
  }
  for (const constraint of enabled(problem, "locked_start")) {
    rows.push(` ${rowName("locked", constraint.id)}: ${startVariable(String(constraint.parameters.jobId))} = ${Number(constraint.parameters.start)}`);
  }

  const bounds = [
    ` 0 <= cmax <= ${BIG_M}`,
    ...problem.jobs.map((job) => ` 0 <= ${startVariable(job.id)} <= ${MAX_START}`),
  ];
  const binaryLines = [...binaries].map((variable) => ` ${variable}`);
  const lp = ["Minimize", " obj: cmax", "Subject To", ...rows, "Bounds", ...bounds, "Binaries", ...binaryLines, "End", ""].join("\n");
  return { lp, problem };
}
