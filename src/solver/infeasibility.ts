import { formatTime } from "../domain/time";
import type { Conflict, Constraint, InfeasibilityResult, Job, OptimizationProblem, Resource } from "../domain/types";

type Window = { start: number; end: number; constraintId?: string };

const enabled = (problem: OptimizationProblem, type: Constraint["type"]) => problem.constraints.filter((constraint) => constraint.enabled && constraint.type === type);
const asString = (value: unknown) => typeof value === "string" ? value : "";
const asNumber = (value: unknown) => typeof value === "number" ? value : Number(value);

function assignmentsFor(problem: OptimizationProblem, job: Job): Constraint[] {
  const explicit = enabled(problem, "resource_assignment").filter((constraint) => constraint.parameters.jobId === job.id);
  const represented = problem.constraints.some((constraint) => constraint.type === "resource_assignment" && constraint.parameters.jobId === job.id);
  if (represented || !job.requiredResource) return explicit;
  return [{ id: `job-field-assignment-${job.id}`, type: "resource_assignment", description: "Job field assignment", enabled: true, parameters: { jobId: job.id, resourceId: job.requiredResource }, source: "system" }];
}

function deadlinesFor(problem: OptimizationProblem, job: Job): { value: number; id: string }[] {
  const explicit = enabled(problem, "deadline").filter((constraint) => constraint.parameters.jobId === job.id).map((constraint) => ({ value: asNumber(constraint.parameters.deadline), id: constraint.id }));
  const represented = problem.constraints.some((constraint) => constraint.type === "deadline" && constraint.parameters.jobId === job.id);
  if (represented || job.deadline === undefined) return explicit;
  return [{ value: job.deadline, id: `job-field-deadline-${job.id}` }];
}

function earliestFor(problem: OptimizationProblem, job: Job): { value: number; ids: string[] } {
  const constraints = enabled(problem, "earliest_start").filter((constraint) => constraint.parameters.jobId === job.id);
  const values = constraints.map((constraint) => asNumber(constraint.parameters.earliestStart));
  const represented = problem.constraints.some((constraint) => constraint.type === "earliest_start" && constraint.parameters.jobId === job.id);
  if (!represented && job.earliestStart !== undefined) return { value: job.earliestStart, ids: [`job-field-earliest-${job.id}`] };
  const maximum = values.length ? Math.max(...values) : 0;
  return { value: maximum, ids: constraints.filter((constraint) => asNumber(constraint.parameters.earliestStart) === maximum).map((constraint) => constraint.id) };
}

function precedenceEdges(problem: OptimizationProblem): { predecessorId: string; successorId: string; constraintId: string }[] {
  const edges = enabled(problem, "precedence").map((constraint) => ({ predecessorId: asString(constraint.parameters.predecessorId), successorId: asString(constraint.parameters.successorId), constraintId: constraint.id }));
  const seen = new Set(problem.constraints.filter((constraint) => constraint.type === "precedence").map((constraint) => `${asString(constraint.parameters.predecessorId)}->${asString(constraint.parameters.successorId)}`));
  for (const job of problem.jobs) for (const predecessorId of job.predecessors) if (!seen.has(`${predecessorId}->${job.id}`)) edges.push({ predecessorId, successorId: job.id, constraintId: `precedence-${predecessorId}-${job.id}` });
  return edges;
}

function earliestByPrecedence(problem: OptimizationProblem): Map<string, { start: number; constraintIds: string[] }> {
  const results = new Map<string, { start: number; constraintIds: string[] }>();
  const edges = precedenceEdges(problem);
  const visiting = new Set<string>();
  const compute = (job: Job): { start: number; constraintIds: string[] } => {
    const cached = results.get(job.id);
    if (cached) return cached;
    if (visiting.has(job.id)) return { start: 0, constraintIds: [] };
    visiting.add(job.id);
    const ownEarliest = earliestFor(problem, job);
    let best = { start: ownEarliest.value, constraintIds: [...ownEarliest.ids] };
    for (const edge of edges.filter((item) => item.successorId === job.id)) {
      const predecessor = problem.jobs.find((item) => item.id === edge.predecessorId);
      if (!predecessor) continue;
      const predecessorEarliest = compute(predecessor);
      const candidate = predecessorEarliest.start + predecessor.durationMinutes;
      if (candidate > best.start) best = { start: candidate, constraintIds: [...predecessorEarliest.constraintIds, edge.constraintId] };
    }
    visiting.delete(job.id);
    results.set(job.id, best);
    return best;
  };
  for (const job of problem.jobs) compute(job);
  return results;
}

function downtimeWindows(problem: OptimizationProblem, resource: Resource): Window[] {
  return [
    ...resource.unavailableWindows.map((window) => ({ ...window })),
    ...enabled(problem, "resource_availability").filter((constraint) => constraint.parameters.resourceId === resource.id).map((constraint) => ({ start: asNumber(constraint.parameters.start), end: asNumber(constraint.parameters.end), constraintId: constraint.id })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
}

function availableSegments(start: number, end: number, windows: Window[]): { start: number; end: number }[] {
  let segments = [{ start, end }];
  for (const window of windows) {
    segments = segments.flatMap((segment) => {
      if (window.end <= segment.start || window.start >= segment.end) return [segment];
      const pieces: { start: number; end: number }[] = [];
      if (window.start > segment.start) pieces.push({ start: segment.start, end: Math.min(window.start, segment.end) });
      if (window.end < segment.end) pieces.push({ start: Math.max(window.end, segment.start), end: segment.end });
      return pieces;
    });
  }
  return segments.filter((segment) => segment.end > segment.start);
}

function assignmentConflicts(problem: OptimizationProblem): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const job of problem.jobs) {
    const constraints = assignmentsFor(problem, job);
    const resources = [...new Set(constraints.map((constraint) => asString(constraint.parameters.resourceId)))];
    if (resources.length > 1) conflicts.push({ constraintIds: constraints.map((constraint) => constraint.id), jobIds: [job.id], resourceIds: resources, summary: `${job.name} is simultaneously assigned to ${resources.map((id) => problem.resources.find((resource) => resource.id === id)?.name ?? id).join(" and ")}. A job can use only one machine.` });
  }
  return conflicts;
}

function deadlineAndAvailabilityConflicts(problem: OptimizationProblem): Conflict[] {
  const conflicts: Conflict[] = [];
  const precedenceStarts = earliestByPrecedence(problem);
  for (const job of problem.jobs) {
    const assignmentConstraints = assignmentsFor(problem, job);
    const assignedIds = [...new Set(assignmentConstraints.map((constraint) => asString(constraint.parameters.resourceId)))];
    if (assignedIds.length !== 1) continue;
    const resource = problem.resources.find((item) => item.id === assignedIds[0]);
    if (!resource) continue;
    const deadlines = deadlinesFor(problem, job);
    const effectiveDeadline = deadlines.length ? Math.min(...deadlines.map((item) => item.value)) : resource.availableUntil;
    const matchingDeadlineIds = deadlines.filter((item) => item.value === effectiveDeadline).map((item) => item.id);
    const precedence = precedenceStarts.get(job.id) ?? { start: 0, constraintIds: [] };
    const earliest = Math.max(resource.availableFrom, precedence.start);
    const windows = downtimeWindows(problem, resource);
    const segments = availableSegments(earliest, Math.min(resource.availableUntil, effectiveDeadline), windows);
    const longest = segments.reduce((maximum, segment) => Math.max(maximum, segment.end - segment.start), 0);
    if (longest + 1e-6 >= job.durationMinutes) continue;
    const relevantDowntime = windows.filter((window) => window.end > earliest && window.start < effectiveDeadline && window.constraintId).map((window) => window.constraintId!);
    const constraintIds = [...new Set([...assignmentConstraints.map((constraint) => constraint.id), ...matchingDeadlineIds, ...precedence.constraintIds, ...relevantDowntime])];
    const parts = [`${job.name} requires ${job.durationMinutes} contiguous minutes on ${resource.name.split(" · ")[0]}`];
    if (matchingDeadlineIds.length) parts.push(`its ${formatTime(effectiveDeadline)} deadline leaves only ${Math.max(0, effectiveDeadline - earliest)} minutes from the earliest possible start (${formatTime(earliest)})`);
    else parts.push(`${resource.name.split(" · ")[0]} has no contiguous window long enough between ${formatTime(earliest)} and ${formatTime(resource.availableUntil)}`);
    if (relevantDowntime.length) parts.push(`downtime removes ${windows.filter((window) => relevantDowntime.includes(window.constraintId ?? "")).map((window) => `${formatTime(window.start)}–${formatTime(window.end)}`).join(", ")}`);
    conflicts.push({ constraintIds, jobIds: [job.id], resourceIds: [resource.id], summary: `${parts.join("; ")}. Longest available window: ${longest} minutes.` });
  }
  return conflicts;
}

function precedenceDeadlineConflicts(problem: OptimizationProblem): Conflict[] {
  const conflicts: Conflict[] = [];
  const starts = earliestByPrecedence(problem);
  for (const job of problem.jobs) {
    const deadlines = deadlinesFor(problem, job);
    if (!deadlines.length) continue;
    const deadline = Math.min(...deadlines.map((item) => item.value));
    const earliest = starts.get(job.id) ?? { start: 0, constraintIds: [] };
    const finish = earliest.start + job.durationMinutes;
    if (finish > deadline) conflicts.push({ constraintIds: [...earliest.constraintIds, ...deadlines.filter((item) => item.value === deadline).map((item) => item.id)], jobIds: [job.id], resourceIds: [], summary: `${job.name}'s precedence chain cannot finish before ${formatTime(finish)}, which is later than its ${formatTime(deadline)} deadline.` });
  }
  return conflicts;
}

function lockedStartConflicts(problem: OptimizationProblem): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const constraint of enabled(problem, "locked_start")) {
    const job = problem.jobs.find((item) => item.id === constraint.parameters.jobId);
    if (!job) continue;
    const start = asNumber(constraint.parameters.start);
    const deadline = deadlinesFor(problem, job).sort((a, b) => a.value - b.value)[0];
    if (deadline && start + job.durationMinutes > deadline.value) conflicts.push({ constraintIds: [constraint.id, deadline.id], jobIds: [job.id], resourceIds: [], summary: `${job.name} is locked at ${formatTime(start)}, so it finishes at ${formatTime(start + job.durationMinutes)} after its ${formatTime(deadline.value)} deadline.` });
    for (const assignment of assignmentsFor(problem, job)) {
      const resource = problem.resources.find((item) => item.id === assignment.parameters.resourceId);
      if (!resource) continue;
      const window = downtimeWindows(problem, resource).find((item) => start < item.end && start + job.durationMinutes > item.start);
      if (window) conflicts.push({ constraintIds: [constraint.id, assignment.id, ...(window.constraintId ? [window.constraintId] : [])], jobIds: [job.id], resourceIds: [resource.id], summary: `${job.name}'s locked interval ${formatTime(start)}–${formatTime(start + job.durationMinutes)} overlaps ${resource.name.split(" · ")[0]} downtime ${formatTime(window.start)}–${formatTime(window.end)}.` });
    }
  }
  return conflicts;
}

export function analyzeInfeasibility(problem: OptimizationProblem): InfeasibilityResult {
  const combined = [...assignmentConflicts(problem), ...precedenceDeadlineConflicts(problem), ...lockedStartConflicts(problem), ...deadlineAndAvailabilityConflicts(problem)];
  const unique = combined.filter((conflict, index) => combined.findIndex((item) => item.summary === conflict.summary) === index);
  return { status: "infeasible", conflicts: unique.length ? unique : [{ constraintIds: [], jobIds: [], resourceIds: [], summary: "The MILP is infeasible, but no typed local conflict was isolated. Inspect enabled assignment, precedence, deadline, availability, earliest-start, and locked-start constraints." }] };
}
