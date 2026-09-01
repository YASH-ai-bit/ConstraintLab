import { describe, expect, it } from "vitest";
import { analyzeInfeasibility } from "./infeasibility";
import { solveOptimizationProblem } from "./highsAdapter";
import { tinyProblem } from "../test/problemFactory";

describe("typed infeasibility analysis", () => {
  it("matches a deadline and machine-window contradiction", async () => {
    const problem = tinyProblem([240]);
    problem.resources[0].availableFrom = 540;
    problem.resources[0].availableUntil = 1020;
    problem.constraints = [
      { id: "assign-j1", type: "resource_assignment", description: "Assign", enabled: true, parameters: { jobId: "j1", resourceId: "r1" }, source: "agent" },
      { id: "deadline-j1", type: "deadline", description: "Deadline", enabled: true, parameters: { jobId: "j1", deadline: 750 }, source: "agent" },
    ];
    const solved = await solveOptimizationProblem(problem);
    expect(solved.status).toBe("infeasible");
    const analysis = analyzeInfeasibility(problem);
    expect(analysis.conflicts[0].constraintIds).toEqual(expect.arrayContaining(["assign-j1", "deadline-j1"]));
    expect(analysis.conflicts[0].summary).toContain("240 contiguous minutes");
    expect(analysis.conflicts[0].summary).toContain("12:30 PM");
  });
});
