import type { Assignment, OptimizationProblem, SolverResult } from "../domain/types";

export type HighsColumn = {
  Primal?: number;
  Lower?: number | null;
  Upper?: number | null;
};

export type HighsColumns = Record<string, HighsColumn>;

export type CompiledModel = {
  lp: string;
  problem: OptimizationProblem;
};

export interface OptimizationSolver {
  solve(model: OptimizationProblem): Promise<SolverResult>;
}

export type TranslatedSolution = {
  assignments: Assignment[];
  objectiveValue: number;
};
