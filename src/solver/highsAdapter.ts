import loadHighs from "highs";
import type { OptimizationProblem, SolverResult } from "../domain/types";
import { analyzeInfeasibility } from "./infeasibility";
import { compileModelToLp } from "./modelCompiler";
import { translateSolution } from "./solutionTranslator";
import type { HighsColumns, OptimizationSolver } from "./types";

type LoadedHighs = Awaited<ReturnType<typeof loadHighs>>;
let instancePromise: Promise<LoadedHighs> | undefined;

function loadSolver(): Promise<LoadedHighs> {
  if (!instancePromise) {
    const isBrowserRuntime = typeof globalThis.location !== "undefined" && /^https?:$/.test(globalThis.location.protocol);
    instancePromise = isBrowserRuntime
      ? loadHighs({ locateFile: () => new URL(`${import.meta.env.BASE_URL}highs.wasm`, globalThis.location.origin).href })
      : loadHighs();
  }
  return instancePromise;
}

export async function solveOptimizationProblem(problem: OptimizationProblem): Promise<SolverResult> {
  const started = performance.now();
  try {
    const { lp } = compileModelToLp(problem);
    const highs = await loadSolver();
    const solution = highs.solve(lp, { output_flag: false, log_to_console: false, presolve: "on", mip_rel_gap: 0, time_limit: 30, random_seed: 0 });
    const solveTimeMs = performance.now() - started;
    if (solution.Status === "Infeasible" || solution.Status === "Primal infeasible or unbounded") {
      return { ...analyzeInfeasibility(problem), solveTimeMs };
    }
    const columns = solution.Columns as HighsColumns;
    if (solution.Status === "Optimal") {
      const translated = translateSolution(problem, columns, solution.ObjectiveValue);
      return { status: "optimal", ...translated, solveTimeMs };
    }
    const hasPrimalSolution = problem.jobs.every((job) => typeof columns[startVariableName(job.id)]?.Primal === "number");
    if (hasPrimalSolution && ["Time limit reached", "Target for objective reached", "Bound on objective reached"].includes(solution.Status)) {
      const translated = translateSolution(problem, columns, solution.ObjectiveValue);
      return { status: "feasible", ...translated, solveTimeMs };
    }
    return { status: "error", message: `HiGHS ended with status: ${solution.Status}.`, solveTimeMs };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Unknown solver error.", solveTimeMs: performance.now() - started };
  }
}

function startVariableName(jobId: string): string {
  return `s_${Array.from(jobId).map((character) => character.codePointAt(0)!.toString(16)).join("_")}`;
}

export class HighsSolver implements OptimizationSolver {
  solve(model: OptimizationProblem): Promise<SolverResult> {
    return solveOptimizationProblem(model);
  }
}
