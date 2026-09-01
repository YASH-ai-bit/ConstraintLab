import type { OptimizationProblem } from "../domain/types";

export function tinyProblem(durations = [60, 30], twoResources = false): OptimizationProblem {
  const resources = [
    { id: "r1", name: "Machine 1", availableFrom: 0, availableUntil: 600, unavailableWindows: [] },
    ...(twoResources ? [{ id: "r2", name: "Machine 2", availableFrom: 0, availableUntil: 600, unavailableWindows: [] }] : []),
  ];
  const jobs = durations.map((durationMinutes, index) => ({ id: `j${index + 1}`, name: `Job ${index + 1}`, durationMinutes, priority: 1, requiredResource: twoResources ? `r${index + 1}` : "r1", predecessors: [] }));
  return { jobs, resources, constraints: [], objective: { type: "makespan" }, modelVersion: 1 };
}
