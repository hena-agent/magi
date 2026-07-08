/** @jsxImportSource @opentui/react */
import type { TranscriptMessage } from "./app-controller.js";
import { readOpenTuiTranscriptLineColor } from "./opentui-transcript-format.js";
import { getTranscriptVisibleLineWindow } from "./transcript-state.js";

export type OpenTuiTranscriptProps = {
  expandedMessageIds: Set<string>;
  messages: TranscriptMessage[];
  mutedColor: string;
  scrollOffset?: number;
  selectedMessageId: string | undefined;
  textColor: string;
  width: number;
  lineLimit?: number;
};

export function OpenTuiTranscript(props: OpenTuiTranscriptProps) {
  if (props.messages.length === 0) return null;

  const { visibleLines, olderHiddenCount, newerHiddenCount } = getTranscriptVisibleLineWindow({
    messages: props.messages,
    selectedId: props.selectedMessageId,
    expandedIds: props.expandedMessageIds,
    scrollOffset: props.scrollOffset ?? 0,
    lineLimit: props.lineLimit,
  });

  return (
    <box width={props.width} style={{ flexDirection: "column", marginBottom: 2, paddingLeft: 1 }}>
      {olderHiddenCount > 0 && <text fg={props.mutedColor}>{olderHiddenCount} older lines</text>}
      {visibleLines.map((line) => (
        <text fg={readOpenTuiTranscriptLineColor(line, props)} key={line.key}>
          {line.text}
        </text>
      ))}
      {newerHiddenCount > 0 && <text fg={props.mutedColor}>{newerHiddenCount} newer lines</text>}
    </box>
  );
}
