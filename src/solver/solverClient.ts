import type { OptimizationProblem, SolverResult } from "../domain/types";

function cancellationError(): Error {
  const error = new Error("Solve cancelled.");
  error.name = "AbortError";
  return error;
}

export async function solveInWorker(model: OptimizationProblem, signal?: AbortSignal): Promise<SolverResult> {
  if (signal?.aborted) throw cancellationError();
  if (typeof Worker === "undefined") {
    const { solveOptimizationProblem } = await import("./highsAdapter");
    const result = await solveOptimizationProblem(model);
    if (signal?.aborted) throw cancellationError();
    return result;
  }
  return new Promise<SolverResult>((resolve, reject) => {
    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module", name: "constraintlab-highs" });
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    const finish = (result: SolverResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      worker.terminate();
      resolve(result);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
      reject(cancellationError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.addEventListener("message", (event: MessageEvent<SolverResult>) => finish(event.data), { once: true });
    worker.addEventListener("error", (event) => finish({ status: "error", message: event.message || "Solver worker failed.", solveTimeMs: 0 }), { once: true });
    worker.postMessage(model);
  });
}
