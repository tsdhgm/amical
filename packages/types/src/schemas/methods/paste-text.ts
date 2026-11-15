import { z } from "zod";

// Request params
export const PasteTextParamsSchema = z.object({
  transcript: z.string(),
  preserveClipboard: z.boolean().optional(),
  // Linux helper only: the desktop already wrote the clipboard, so the helper
  // just simulates the paste keystroke. Other helpers ignore it.
  keystrokeOnly: z.boolean().optional(),
});
export type PasteTextParams = z.infer<typeof PasteTextParamsSchema>;

// Response result
export const PasteTextResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(), // Optional message for errors or status
});
export type PasteTextResult = z.infer<typeof PasteTextResultSchema>;
