import { beforeEach, describe, expect, it } from "vitest";
import { appStore } from "../state/store";
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
});
