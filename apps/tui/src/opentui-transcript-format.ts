import type { TranscriptLine } from "./transcript-format.js";
import type { TranscriptMessage } from "./app-controller.js";

export function createOpenTuiUserPromptMessage(
  prompt: string,
  id: string = crypto.randomUUID(),
): TranscriptMessage {
  return {
    id,
    role: "user",
    parts: [{ id: `${id}:text`, text: prompt, type: "text" }],
  };
}

export function readOpenTuiTranscriptLineColor(
  line: Pick<TranscriptLine, "color" | "dim" | "selected">,
  colors: { mutedColor: string; textColor: string },
): string {
  if (line.color === "red") return "#dc2626";
  if (line.color === "yellow") return "#d97706";
  if (line.selected) return colors.textColor;
  if (line.dim) return colors.mutedColor;

  return colors.textColor;
}
