/// <reference lib="webworker" />
import type { OptimizationProblem } from "../domain/types";
import { solveOptimizationProblem } from "./highsAdapter";

self.addEventListener("message", async (event: MessageEvent<OptimizationProblem>) => {
  const result = await solveOptimizationProblem(event.data);
  self.postMessage(result);
});

export {};
