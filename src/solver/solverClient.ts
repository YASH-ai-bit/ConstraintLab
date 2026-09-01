import type { OptimizationProblem, SolverResult } from "../domain/types";

export async function solveInWorker(model: OptimizationProblem): Promise<SolverResult> {
  if (typeof Worker === "undefined") {
    const { solveOptimizationProblem } = await import("./highsAdapter");
    return solveOptimizationProblem(model);
  }
  return new Promise<SolverResult>((resolve) => {
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module", name: "constraintlab-highs" });
    const finish = (result: SolverResult) => {
      worker.terminate();
      resolve(result);
    };
    worker.addEventListener("message", (event: MessageEvent<SolverResult>) => finish(event.data), { once: true });
    worker.addEventListener("error", (event) => finish({ status: "error", message: event.message || "Solver worker failed.", solveTimeMs: 0 }), { once: true });
    worker.postMessage(model);
  });
}
