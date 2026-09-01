import type { Constraint, Job, Resource } from "../domain/types";

export const factoryResources: Resource[] = [
  { id: "machine-1", name: "Machine 1 · Cutting", availableFrom: 480, availableUntil: 1080, unavailableWindows: [] },
  { id: "machine-2", name: "Machine 2 · Milling", availableFrom: 540, availableUntil: 1020, unavailableWindows: [] },
  { id: "machine-3", name: "Machine 3 · Assembly", availableFrom: 480, availableUntil: 1080, unavailableWindows: [{ start: 750, end: 780 }] },
  { id: "machine-4", name: "Machine 4 · Finishing", availableFrom: 480, availableUntil: 1050, unavailableWindows: [] },
];

export const factoryJobs: Job[] = [
  { id: "job-1", name: "Steel blanks", durationMinutes: 60, priority: 3, requiredResource: "machine-1", predecessors: [] },
  { id: "job-2", name: "Housing mill", durationMinutes: 90, priority: 3, requiredResource: "machine-2", predecessors: [] },
  { id: "job-3", name: "Shaft turn", durationMinutes: 75, priority: 2, requiredResource: "machine-2", predecessors: [] },
  { id: "job-4", name: "Emergency rework", durationMinutes: 240, priority: 4, predecessors: [] },
  { id: "job-5", name: "Deburr plates", durationMinutes: 45, priority: 2, requiredResource: "machine-1", predecessors: ["job-1"] },
  { id: "job-6", name: "Bracket drill", durationMinutes: 60, priority: 4, requiredResource: "machine-2", predecessors: ["job-1"] },
  { id: "job-7", name: "Final calibration", durationMinutes: 60, priority: 5, requiredResource: "machine-4", predecessors: ["job-6"] },
  { id: "job-8", name: "Frame weld", durationMinutes: 120, priority: 3, requiredResource: "machine-3", predecessors: [] },
  { id: "job-9", name: "Housing inspect", durationMinutes: 45, priority: 2, requiredResource: "machine-4", predecessors: ["job-2"] },
  { id: "job-10", name: "Shaft inspect", durationMinutes: 30, priority: 2, requiredResource: "machine-4", predecessors: ["job-3"] },
  { id: "job-11", name: "Panel cut", durationMinutes: 90, priority: 2, requiredResource: "machine-1", predecessors: [] },
  { id: "job-12", name: "Panel assembly", durationMinutes: 75, priority: 3, requiredResource: "machine-3", predecessors: ["job-11"] },
  { id: "job-13", name: "Seal prep", durationMinutes: 30, priority: 1, requiredResource: "machine-1", predecessors: [] },
  { id: "job-14", name: "Seal install", durationMinutes: 60, priority: 2, requiredResource: "machine-3", predecessors: ["job-13"] },
  { id: "job-15", name: "Final pack", durationMinutes: 45, priority: 3, requiredResource: "machine-4", predecessors: ["job-9", "job-10", "job-12", "job-14"] },
];

function jobConstraintObjects(): Constraint[] {
  const constraints: Constraint[] = [];
  for (const job of factoryJobs) {
    if (job.requiredResource) {
      const resource = factoryResources.find((item) => item.id === job.requiredResource)!;
      constraints.push({
        id: `assignment-${job.id}`,
        type: "resource_assignment",
        description: `${job.name} runs on ${resource.name.split(" · ")[0]}`,
        enabled: true,
        parameters: { jobId: job.id, resourceId: resource.id, fieldBacked: true },
        source: "system",
      });
    }
    for (const predecessorId of job.predecessors) {
      const predecessor = factoryJobs.find((item) => item.id === predecessorId)!;
      constraints.push({
        id: `precedence-${predecessorId}-${job.id}`,
        type: "precedence",
        description: `${predecessor.name} precedes ${job.name}`,
        enabled: true,
        parameters: { predecessorId, successorId: job.id, fieldBacked: true },
        source: "system",
      });
    }
  }
  return constraints;
}

export const factoryConstraints: Constraint[] = jobConstraintObjects();
