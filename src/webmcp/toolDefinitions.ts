import { z } from "zod";
import { appStore } from "../state/store";
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
import { toolHandlers, type ToolName } from "./toolHandlers";

type ToolDescriptor = {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<{ content: { type: "text"; text: string }[] }>;
};

const specs: { name: ToolName; description: string; schema: z.ZodType }[] = [
  { name: "get_problem_state", description: "Read the complete compact Factory Scheduling model, all stable-ID typed constraints, solve status, model version, and stale-solution state. This tool never mutates the model.", schema: getProblemStateSchema },
  { name: "add_job", description: "Add one validated job to the canonical scheduling model. References must use IDs returned by get_problem_state.", schema: addJobSchema },
  { name: "update_job", description: "Update one existing job by ID. Only name, durationMinutes, priority, earliestStart, deadline, requiredResource, and predecessors are allowed.", schema: updateJobToolSchema },
  { name: "add_constraint", description: "Add exactly one typed scheduling constraint with a stable ID. Raw solver expressions and custom constraint types are not accepted.", schema: addConstraintSchema },
  { name: "remove_constraint", description: "Remove one application-level constraint by its stable ID.", schema: removeConstraintSchema },
  { name: "set_objective", description: "Set the optimization objective. Only { type: 'makespan' } is supported in this build.", schema: setObjectiveSchema },
  { name: "solve_problem", description: "Compile the current canonical model to a disjunctive-scheduling MILP, solve it with deterministic HiGHS in a Web Worker, and update shared solve state.", schema: solveProblemSchema },
  { name: "get_solution", description: "Read current job/resource assignments only when the solution matches the current model version. Returns STALE_SOLUTION after any structural change.", schema: getSolutionSchema },
  { name: "analyze_infeasibility", description: "When the last solve is infeasible, deterministically analyze typed constraints and return structured conflict facts. No LLM generates these facts.", schema: analyzeInfeasibilitySchema },
];

export const WEBMCP_TOOL_NAMES = specs.map((spec) => spec.name);

export function createToolDefinitions(): ToolDescriptor[] {
  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.schema, { unrepresentable: "any" }) as Record<string, unknown>,
    async execute(input: unknown) {
      const started = performance.now();
      const response = await toolHandlers[spec.name](input as never);
      appStore.getState().recordToolTiming({ id: `timing-${Date.now()}-${spec.name}`, toolName: spec.name, durationMs: performance.now() - started, ok: response.ok, timestamp: Date.now() });
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    },
  }));
}
