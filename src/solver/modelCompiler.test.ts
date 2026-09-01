import { describe, expect, it } from "vitest";
import { compileModelToLp } from "./modelCompiler";
import { solveOptimizationProblem } from "./highsAdapter";
import { tinyProblem } from "../test/problemFactory";

describe("HiGHS MILP integration", () => {
  it("compiles explicit CPLEX LP text with binary assignment and order variables", () => {
    const { lp } = compileModelToLp(tinyProblem());
    expect(lp).toContain("Minimize\n obj: cmax");
    expect(lp).toContain("Subject To");
    expect(lp).toContain("Binaries");
    expect(lp.trim().endsWith("End")).toBe(true);
  });

  it("schedules 60 and 30 minute jobs on one machine with makespan 90", async () => {
    const result = await solveOptimizationProblem(tinyProblem());
    expect(result.status).toBe("optimal");
    if (result.status !== "optimal") return;
    expect(result.objectiveValue).toBeCloseTo(90, 4);
    expect(result.assignments).toHaveLength(2);
    const [first, second] = [...result.assignments].sort((a, b) => a.start - b.start);
    expect(first.end).toBeLessThanOrEqual(second.start + 1e-6);
  });

  it("uses two machines in parallel for a 60 minute makespan", async () => {
    const result = await solveOptimizationProblem(tinyProblem([60, 30], true));
    expect(result.status).toBe("optimal");
    if (result.status === "optimal") expect(result.objectiveValue).toBeCloseTo(60, 4);
  });
});
