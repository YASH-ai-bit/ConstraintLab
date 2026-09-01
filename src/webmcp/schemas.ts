import { z } from "zod";

const idSchema = z.string().trim().min(1).max(80);
const minuteSchema = z.number().int().min(0).max(24 * 60);

export const addJobSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(80),
  durationMinutes: z.number().int().positive().max(24 * 60),
  priority: z.number().int().min(1).max(5),
  earliestStart: minuteSchema.optional(),
  deadline: minuteSchema.optional(),
  requiredResource: idSchema.optional(),
  predecessors: z.array(idSchema).max(30).default([]),
}).strict().superRefine((value, context) => {
  if (value.deadline !== undefined && value.earliestStart !== undefined && value.deadline <= value.earliestStart) {
    context.addIssue({ code: "custom", path: ["deadline"], message: "Deadline must be after earliest start." });
  }
});

export const updateJobSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  durationMinutes: z.number().int().positive().max(24 * 60).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  earliestStart: minuteSchema.nullable().optional(),
  deadline: minuteSchema.nullable().optional(),
  requiredResource: idSchema.nullable().optional(),
  predecessors: z.array(idSchema).max(30).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const sourceSchema = z.enum(["user", "agent", "system"]).optional();

const precedenceConstraintSchema = z.object({
  id: idSchema.optional(),
  type: z.literal("precedence"),
  description: z.string().trim().min(1).max(180).optional(),
  enabled: z.boolean().optional(),
  source: sourceSchema,
  parameters: z.object({ predecessorId: idSchema, successorId: idSchema }).strict(),
}).strict();

const assignmentConstraintSchema = z.object({
  id: idSchema.optional(),
  type: z.literal("resource_assignment"),
  description: z.string().trim().min(1).max(180).optional(),
  enabled: z.boolean().optional(),
  source: sourceSchema,
  parameters: z.object({ jobId: idSchema, resourceId: idSchema }).strict(),
}).strict();

const availabilityConstraintSchema = z.object({
  id: idSchema.optional(),
  type: z.literal("resource_availability"),
  description: z.string().trim().min(1).max(180).optional(),
  enabled: z.boolean().optional(),
  source: sourceSchema,
  parameters: z.object({ resourceId: idSchema, start: minuteSchema, end: minuteSchema }).strict()
    .refine((value) => value.end > value.start, { path: ["end"], message: "End must be after start." }),
}).strict();

const deadlineConstraintSchema = z.object({
  id: idSchema.optional(),
  type: z.literal("deadline"),
  description: z.string().trim().min(1).max(180).optional(),
  enabled: z.boolean().optional(),
  source: sourceSchema,
  parameters: z.object({ jobId: idSchema, deadline: minuteSchema }).strict(),
}).strict();

const earliestConstraintSchema = z.object({
  id: idSchema.optional(),
  type: z.literal("earliest_start"),
  description: z.string().trim().min(1).max(180).optional(),
  enabled: z.boolean().optional(),
  source: sourceSchema,
  parameters: z.object({ jobId: idSchema, earliestStart: minuteSchema }).strict(),
}).strict();

const lockedStartConstraintSchema = z.object({
  id: idSchema.optional(),
  type: z.literal("locked_start"),
  description: z.string().trim().min(1).max(180).optional(),
  enabled: z.boolean().optional(),
  source: sourceSchema,
  parameters: z.object({ jobId: idSchema, start: minuteSchema }).strict(),
}).strict();

export const addConstraintSchema = z.discriminatedUnion("type", [
  precedenceConstraintSchema,
  assignmentConstraintSchema,
  availabilityConstraintSchema,
  deadlineConstraintSchema,
  earliestConstraintSchema,
  lockedStartConstraintSchema,
]);

export const removeConstraintSchema = z.object({ id: idSchema }).strict();
export const setObjectiveSchema = z.object({ type: z.literal("makespan") }).strict();
export const getProblemStateSchema = z.object({}).strict();
export const solveProblemSchema = z.object({}).strict();
export const getSolutionSchema = z.object({}).strict();
export const analyzeInfeasibilitySchema = z.object({}).strict();

export const updateJobToolSchema = z.object({ id: idSchema, updates: updateJobSchema }).strict();

export type AddJobInput = z.infer<typeof addJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type AddConstraintInput = z.infer<typeof addConstraintSchema>;
