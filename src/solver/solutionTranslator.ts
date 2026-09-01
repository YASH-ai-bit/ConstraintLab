import type { OptimizationProblem } from "../domain/types";
import { assignmentVariable, startVariable } from "./modelCompiler";
import type { HighsColumns, TranslatedSolution } from "./types";

function primal(columns: HighsColumns, name: string): number {
  const value = columns[name]?.Primal;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing primal value for ${name}.`);
  return value;
}

export function translateSolution(problem: OptimizationProblem, columns: HighsColumns, objectiveValue: number): TranslatedSolution {
  const assignments = problem.jobs.map((job) => {
    const resource = problem.resources
      .map((item) => ({ resource: item, value: columns[assignmentVariable(job.id, item.id)]?.Primal ?? 0 }))
      .sort((a, b) => b.value - a.value)[0];
    if (!resource || resource.value < 0.5) throw new Error(`Solver returned no resource assignment for ${job.id}.`);
    const start = Math.round(primal(columns, startVariable(job.id)) * 1000) / 1000;
    return { jobId: job.id, resourceId: resource.resource.id, start, end: start + job.durationMinutes };
  }).sort((a, b) => a.start - b.start || a.jobId.localeCompare(b.jobId));
  return { assignments, objectiveValue };
}
