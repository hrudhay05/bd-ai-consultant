import { z } from "zod";

export const CATEGORIES = [
  "how_to",
  "troubleshooting",
  "project_request",
  "refund_cancellation",
  "complaint",
  "quote_request",
  "follow_up",
] as const;

export const CategorySchema = z.enum(CATEGORIES);
export const UrgencySchema = z.enum(["low", "normal", "high", "urgent"]);
export const RiskSchema = z.enum(["low", "medium", "high"]);

export const DatasetEmailSchema = z.object({
  id: z.string(),
  split: z.enum(["dev", "test"]),
  from_name: z.string(),
  from_email: z.string(),
  subject: z.string(),
  body: z.string().min(10),
  expected_category: CategorySchema,
  expected_urgency: UrgencySchema,
  expected_risk: RiskSchema,
  kb_expectation: z.enum(["likely_answerable", "should_escalate", "not_needed"]),
  reply_must: z.array(z.string()),
  reply_must_not: z.array(z.string()),
  tags: z.array(z.string()).default([]),
});

export type Category = z.infer<typeof CategorySchema>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type DatasetEmail = z.infer<typeof DatasetEmailSchema>;