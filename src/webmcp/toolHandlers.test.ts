import { beforeEach, describe, expect, it } from "vitest";
import { appStore } from "../state/store";
import { createToolDefinitions } from "./toolDefinitions";
import { toolHandlers } from "./toolHandlers";

describe("WebMCP handlers share canonical actions", () => {
  beforeEach(() => appStore.getState().resetScenario());

  it("returns structured failures for unknown jobs and invalid deadlines", () => {
    expect(toolHandlers.update_job({ id: "missing", updates: { priority: 5 } })).toMatchObject({ ok: false, code: "UNKNOWN_JOB", recoverable: true });
    expect(toolHandlers.add_constraint({ type: "deadline", parameters: { jobId: "job-7", deadline: -1 } })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("rejects a stale solution after a human structural change", () => {
    const state = appStore.getState();
    state.onSolverResult({ status: "optimal", assignments: [], objectiveValue: 0, solveTimeMs: 1 }, state.modelVersion);
    expect(toolHandlers.get_solution({}).ok).toBe(true);
    appStore.getState().updateJob("job-1", { priority: 4 }, "human");
    expect(toolHandlers.get_solution({})).toMatchObject({ ok: false, code: "STALE_SOLUTION" });
  });

  it("keeps read-only calls free of structural mutations", () => {
    const before = appStore.getState();
    const snapshot = { modelVersion: before.modelVersion, jobs: structuredClone(before.jobs), constraints: structuredClone(before.constraints), auditCount: before.auditEvents.length };
    expect(toolHandlers.get_problem_state({}).ok).toBe(true);
    const after = appStore.getState();
    expect({ modelVersion: after.modelVersion, jobs: after.jobs, constraints: after.constraints, auditCount: after.auditEvents.length }).toEqual(snapshot);
  });

  it("returns isolated state snapshots that cannot mutate the canonical model", () => {
    const result = toolHandlers.get_problem_state({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.data.jobs[0].name = "Tampered outside the store";
    result.data.constraints[0].description = "Tampered outside the store";
    expect(appStore.getState().jobs[0].name).toBe("Steel blanks");
    expect(appStore.getState().constraints[0].description).not.toBe("Tampered outside the store");
  });

  it("rejects infeasibility analysis after the proven model has changed", () => {
    const state = appStore.getState();
    state.onSolverResult({ status: "infeasible", conflicts: [], solveTimeMs: 1 }, state.modelVersion);
    appStore.getState().updateJob("job-1", { priority: 4 }, "human");
    expect(toolHandlers.analyze_infeasibility({})).toMatchObject({ ok: false, code: "STALE_INFEASIBILITY" });
  });

  it("annotates read-only and mutating tools for WebMCP clients", () => {
    const definitions = createToolDefinitions();
    expect(definitions.find((tool) => tool.name === "get_problem_state")?.annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: false });
    expect(definitions.find((tool) => tool.name === "solve_problem")?.annotations).toMatchObject({ readOnlyHint: false, untrustedContentHint: false });
  });
});
