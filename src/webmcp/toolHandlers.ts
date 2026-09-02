import { appStore } from "../state/store";
import { analyzeInfeasibility } from "../solver/infeasibility";
import type { ActionResult, OptimizationProblem, SolverResult } from "../domain/types";
import {
  addConstraintSchema,
  addJobSchema,
  analyzeInfeasibilitySchema,
  getProblemStateSchema,
  getSolutionSchema,
  removeConstraintSchema,
  setObjectiveSchema,
  solveProblemSchema,
  updateJobToolSchema,
} from "./schemas";

const validationFailure = (message: string): ActionResult<never> => ({ ok: false, code: "VALIDATION_ERROR", message, recoverable: true, suggestedAction: "Correct the arguments and retry." });

function parse<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, input: unknown): ActionResult<T> {
  const result = schema.safeParse(input);
  return result.success ? { ok: true, data: result.data } : validationFailure(result.error.issues[0]?.message ?? "Invalid arguments.");
}

function compactProblemState() {
  const state = appStore.getState();
  return {
    scenarioName: state.scenarioName,
    modelVersion: state.modelVersion,
    objective: structuredClone(state.objective),
    solveStatus: state.solveStatus,
    solvedModelVersion: state.solvedModelVersion,
    staleSolution: state.solvedModelVersion !== undefined && state.solvedModelVersion !== state.modelVersion,
    jobs: structuredClone(state.jobs),
    resources: structuredClone(state.resources),
    constraints: structuredClone(state.constraints),
    infeasibility: state.infeasibility ? structuredClone(state.infeasibility) : undefined,
  };
}

function currentProblem(): OptimizationProblem {
  const state = appStore.getState();
  return { jobs: structuredClone(state.jobs), resources: structuredClone(state.resources), constraints: structuredClone(state.constraints), objective: structuredClone(state.objective), modelVersion: state.modelVersion };
}

export const toolHandlers = {
  get_problem_state(input: unknown) {
    const parsed = parse(getProblemStateSchema, input ?? {});
    return parsed.ok ? { ok: true as const, data: compactProblemState() } : parsed;
  },

  add_job(input: unknown) {
    const parsed = parse(addJobSchema, input);
    return parsed.ok ? appStore.getState().addJob(parsed.data, "agent") : parsed;
  },

  update_job(input: unknown) {
    const parsed = parse(updateJobToolSchema, input);
    return parsed.ok ? appStore.getState().updateJob(parsed.data.id, parsed.data.updates, "agent") : parsed;
  },

  add_constraint(input: unknown) {
    const parsed = parse(addConstraintSchema, input);
    return parsed.ok ? appStore.getState().addConstraint(parsed.data, "agent") : parsed;
  },

  remove_constraint(input: unknown) {
    const parsed = parse(removeConstraintSchema, input);
    return parsed.ok ? appStore.getState().removeConstraint(parsed.data.id, "agent") : parsed;
  },

  set_objective(input: unknown) {
    const parsed = parse(setObjectiveSchema, input);
    return parsed.ok ? appStore.getState().setObjective(parsed.data, "agent") : parsed;
  },

  async solve_problem(input: unknown, context?: { signal?: AbortSignal }): Promise<ActionResult<SolverResult>> {
    const parsed = parse(solveProblemSchema, input ?? {});
    return parsed.ok ? appStore.getState().solveProblem("agent", context?.signal) : parsed;
  },

  get_solution(input: unknown) {
    const parsed = parse(getSolutionSchema, input ?? {});
    if (!parsed.ok) return parsed;
    const state = appStore.getState();
    if (state.solvedModelVersion !== undefined && state.modelVersion !== state.solvedModelVersion) return { ok: false as const, code: "STALE_SOLUTION", message: `The solution is for model v${state.solvedModelVersion}, but the current model is v${state.modelVersion}.`, recoverable: true, suggestedAction: "Call solve_problem again." };
    if (state.solvedModelVersion === undefined || !["OPTIMAL", "FEASIBLE"].includes(state.solveStatus)) return { ok: false as const, code: "NO_SOLUTION", message: "No solved schedule is available.", recoverable: true, suggestedAction: "Call solve_problem first." };
    return { ok: true as const, data: { modelVersion: state.solvedModelVersion, objective: state.objective, objectiveValue: state.objectiveValue, assignments: structuredClone(state.assignments), solveTimeMs: state.solveTimeMs } };
  },

  analyze_infeasibility(input: unknown) {
    const parsed = parse(analyzeInfeasibilitySchema, input ?? {});
    if (!parsed.ok) return parsed;
    const state = appStore.getState();
    if (state.solvedModelVersion !== undefined && state.solvedModelVersion !== state.modelVersion) return { ok: false as const, code: "STALE_INFEASIBILITY", message: `The infeasibility result is for model v${state.solvedModelVersion}, but the current model is v${state.modelVersion}.`, recoverable: true, suggestedAction: "Call solve_problem again, then analyze only if the current model is infeasible." };
    if (state.solveStatus !== "INFEASIBLE") return { ok: false as const, code: "MODEL_NOT_INFEASIBLE", message: `Current solve status is ${state.solveStatus}.`, recoverable: true, suggestedAction: "Call solve_problem, then analyze only if the result is infeasible." };
    return { ok: true as const, data: analyzeInfeasibility(currentProblem()) };
  },
};

export type ToolName = keyof typeof toolHandlers;
