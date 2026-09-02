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
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<{ content: { type: "text"; text: string }[] }>;
};

const specs: { name: ToolName; title: string; description: string; schema: z.ZodType; readOnly: boolean }[] = [
  { name: "get_problem_state", title: "Get problem state", description: "Read the complete compact Factory Scheduling model, all stable-ID typed constraints, solve status, model version, and stale-solution state. This tool never mutates the model.", schema: getProblemStateSchema, readOnly: true },
  { name: "add_job", title: "Add job", description: "Add one validated job to the canonical scheduling model. References must use IDs returned by get_problem_state.", schema: addJobSchema, readOnly: false },
  { name: "update_job", title: "Update job", description: "Update one existing job by ID. Only name, durationMinutes, priority, earliestStart, deadline, requiredResource, and predecessors are allowed.", schema: updateJobToolSchema, readOnly: false },
  { name: "add_constraint", title: "Add constraint", description: "Add exactly one typed scheduling constraint with a stable ID. Raw solver expressions and custom constraint types are not accepted.", schema: addConstraintSchema, readOnly: false },
  { name: "remove_constraint", title: "Remove constraint", description: "Remove one application-level constraint by its stable ID.", schema: removeConstraintSchema, readOnly: false },
  { name: "set_objective", title: "Set objective", description: "Set the optimization objective. Only { type: 'makespan' } is supported in this build.", schema: setObjectiveSchema, readOnly: false },
  { name: "solve_problem", title: "Solve problem", description: "Compile the current canonical model to a disjunctive-scheduling MILP, solve it with deterministic HiGHS in a Web Worker, and update shared solve state.", schema: solveProblemSchema, readOnly: false },
  { name: "get_solution", title: "Get solution", description: "Read current job/resource assignments only when the solution matches the current model version. Returns STALE_SOLUTION after any structural change.", schema: getSolutionSchema, readOnly: true },
  { name: "analyze_infeasibility", title: "Analyze infeasibility", description: "When the last solve is infeasible, deterministically analyze typed constraints and return structured conflict facts. No LLM generates these facts.", schema: analyzeInfeasibilitySchema, readOnly: true },
];

export const WEBMCP_TOOL_NAMES = specs.map((spec) => spec.name);

export function createToolDefinitions(): ToolDescriptor[] {
  return specs.map((spec) => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.schema, { unrepresentable: "any" }) as Record<string, unknown>,
    annotations: { readOnlyHint: spec.readOnly, untrustedContentHint: false },
    async execute(input: unknown, context?: { signal?: AbortSignal }) {
      const started = performance.now();
      const handler = toolHandlers[spec.name] as (argumentsValue: unknown, executionContext?: { signal?: AbortSignal }) => unknown;
      const response = await handler(input, context) as { ok: boolean };
      appStore.getState().recordToolTiming({ id: `timing-${Date.now()}-${spec.name}`, toolName: spec.name, durationMs: performance.now() - started, ok: response.ok, timestamp: Date.now() });
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    },
  }));
}
