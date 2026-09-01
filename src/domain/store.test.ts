import { describe, expect, it } from "vitest";
import { createConstraintLabStore } from "../state/store";

describe("canonical domain actions", () => {
  it("adds and updates a validated job and increments model version", () => {
    const store = createConstraintLabStore();
    const before = store.getState().modelVersion;
    const added = store.getState().addJob({ id: "job-16", name: "Quality gate", durationMinutes: 25, priority: 3, requiredResource: "machine-4", predecessors: ["job-15"] });
    expect(added.ok).toBe(true);
    expect(store.getState().modelVersion).toBe(before + 1);
    const updated = store.getState().updateJob("job-16", { durationMinutes: 30, deadline: 1020 });
    expect(updated.ok).toBe(true);
    expect(store.getState().jobs.find((job) => job.id === "job-16")?.durationMinutes).toBe(30);
    expect(store.getState().constraints.some((constraint) => constraint.type === "deadline" && constraint.parameters.jobId === "job-16")).toBe(true);
    expect(store.getState().auditEvents.at(-1)?.summary).toBe("Updated Quality gate");
  });

  it("rejects unknown references and precedence cycles without mutation", () => {
    const store = createConstraintLabStore();
    const before = store.getState().modelVersion;
    const unknown = store.getState().updateJob("missing", { priority: 4 });
    expect(unknown).toMatchObject({ ok: false, code: "UNKNOWN_JOB" });
    const invalidResource = store.getState().updateJob("job-1", { requiredResource: "machine-99" });
    expect(invalidResource).toMatchObject({ ok: false, code: "UNKNOWN_RESOURCE" });
    const cycle = store.getState().addConstraint({ type: "precedence", parameters: { predecessorId: "job-7", successorId: "job-1" } });
    expect(cycle).toMatchObject({ ok: false, code: "PRECEDENCE_CYCLE" });
    expect(store.getState().modelVersion).toBe(before);
  });

  it("creates deadline and downtime constraints as typed objects", () => {
    const store = createConstraintLabStore();
    const downtime = store.getState().addConstraint({ id: "down-m2", type: "resource_availability", parameters: { resourceId: "machine-2", start: 780, end: 900 } });
    const deadline = store.getState().addConstraint({ id: "due-j7", type: "deadline", parameters: { jobId: "job-7", deadline: 720 } });
    expect(downtime).toMatchObject({ ok: true, data: { id: "down-m2", type: "resource_availability" } });
    expect(deadline).toMatchObject({ ok: true, data: { id: "due-j7", type: "deadline" } });
    expect(store.getState().constraints.find((item) => item.id === "down-m2")?.description).toContain("1:00 PM–3:00 PM");
  });
});
