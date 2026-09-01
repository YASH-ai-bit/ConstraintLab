import { beforeEach, describe, expect, it } from "vitest";
import { appStore } from "../state/store";
import { toolHandlers } from "../webmcp/toolHandlers";

async function runExactDemo(iteration: number) {
  appStore.getState().resetScenario();
  const suffix = `run-${iteration}`;
  expect(toolHandlers.add_constraint({ id: `m2-downtime-${suffix}`, type: "resource_availability", parameters: { resourceId: "machine-2", start: 780, end: 900 } }).ok).toBe(true);
  expect(toolHandlers.add_constraint({ id: `job7-deadline-${suffix}`, type: "deadline", parameters: { jobId: "job-7", deadline: 720 } }).ok).toBe(true);
  const firstSolve = await toolHandlers.solve_problem({});
  expect(firstSolve.ok).toBe(true);
  if (!firstSolve.ok) return;
  expect(firstSolve.data.status).toBe("optimal");
  expect(appStore.getState().assignments.find((assignment) => assignment.jobId === "job-7")?.end).toBeLessThanOrEqual(720);

  expect(toolHandlers.add_constraint({ id: `job4-m2-${suffix}`, type: "resource_assignment", parameters: { jobId: "job-4", resourceId: "machine-2" } }).ok).toBe(true);
  expect(toolHandlers.add_constraint({ id: `job4-deadline-${suffix}`, type: "deadline", parameters: { jobId: "job-4", deadline: 750 } }).ok).toBe(true);
  const secondSolve = await toolHandlers.solve_problem({});
  expect(secondSolve.ok).toBe(true);
  if (!secondSolve.ok) return;
  expect(secondSolve.data.status).toBe("infeasible");
  const analysis = toolHandlers.analyze_infeasibility({});
  expect(analysis.ok).toBe(true);
  if (!analysis.ok) return;
  const job4Conflict = analysis.data.conflicts.find((conflict) => conflict.jobIds.includes("job-4"));
  expect(job4Conflict?.constraintIds).toEqual(expect.arrayContaining([`job4-m2-${suffix}`, `job4-deadline-${suffix}`]));
  expect(job4Conflict?.summary).toContain("240 contiguous minutes");
  expect(job4Conflict?.summary).toContain("12:30 PM");
}

describe("the exact two-prompt demo", () => {
  beforeEach(() => appStore.getState().resetScenario());
  it("runs end-to-end twice with genuine MILP infeasibility and typed facts", async () => {
    await runExactDemo(1);
    await runExactDemo(2);
  }, 60_000);
});
