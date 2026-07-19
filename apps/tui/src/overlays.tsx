import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { PendingPermission, PendingQuestion, PendingSelector } from "./app-controller.js";

export function OverlayArea(props: {
  pendingPermission: PendingPermission | undefined;
  pendingQuestion: PendingQuestion | undefined;
  pendingSelector: PendingSelector | undefined;
  questionAnswer: string;
  questionOptionIndex: number;
  questionSelectedOptionIndexes: Set<number>;
  maxVisibleItems?: number;
}) {
  if (props.pendingPermission) {
    return <PermissionOverlay pendingPermission={props.pendingPermission} />;
  }

  if (props.pendingQuestion) {
    return (
      <QuestionOverlay
        pendingQuestion={props.pendingQuestion}
        answer={props.questionAnswer}
        optionIndex={props.questionOptionIndex}
        selectedOptionIndexes={props.questionSelectedOptionIndexes}
        maxVisibleItems={props.maxVisibleItems}
      />
    );
  }

  if (props.pendingSelector) {
    return (
      <SelectorOverlay selector={props.pendingSelector} maxVisibleItems={props.maxVisibleItems} />
    );
  }

  return null;
}

function OverlayPanel(props: {
  title: string;
  subtitle?: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>{props.title}</Text>
      {props.subtitle ? <Text dimColor>{props.subtitle}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {props.children}
      </Box>
      <Text dimColor>{props.footer}</Text>
    </Box>
  );
}

function SelectorOverlay(props: { selector: PendingSelector; maxVisibleItems?: number }) {
  const visibleItems = getVisibleItems(
    props.selector.items,
    props.selector.selectedIndex,
    props.maxVisibleItems,
  );
  return (
    <OverlayPanel
      title={props.selector.title}
      subtitle={props.selector.subtitle}
      footer="↑/↓ select enter confirm esc cancel"
    >
      {visibleItems.items.map((item, visibleIndex) => {
        const index = visibleItems.start + visibleIndex;
        const selected = index === props.selector.selectedIndex;
        return (
          <Box key={item.value} flexDirection="column">
            <Text bold={selected}>{`${selected ? "›" : " "} ${item.label}`}</Text>
            {item.description ? <Text dimColor>{`  ${item.description}`}</Text> : null}
          </Box>
        );
      })}
      {visibleItems.hidden > 0 ? <Text dimColor>{`  … ${visibleItems.hidden} more`}</Text> : null}
    </OverlayPanel>
  );
}

function PermissionOverlay(props: { pendingPermission: PendingPermission }) {
  const lines = formatPermissionDescriptionLines(props.pendingPermission.description);

  return (
    <OverlayPanel title="Permission Required" footer="[y] allow [n] deny [esc] cancel">
      {lines.map((line) => (
        <Text key={line.label} dimColor={line.muted}>
          {line.text}
        </Text>
      ))}
    </OverlayPanel>
  );
}

function QuestionOverlay(props: {
  pendingQuestion: PendingQuestion;
  answer: string;
  optionIndex: number;
  selectedOptionIndexes: Set<number>;
  maxVisibleItems?: number;
}) {
  const activeQuestion = props.pendingQuestion.questions[0];
  const visibleOptions = getVisibleItems(
    activeQuestion?.options ?? [],
    props.optionIndex,
    props.maxVisibleItems,
  );
  const mode = getQuestionMode({
    activeQuestion,
    answer: props.answer,
    optionIndex: props.optionIndex,
    selectedOptionIndexes: props.selectedOptionIndexes,
  });

  return (
    <OverlayPanel title="Question" footer="↑/↓ select space mark enter submit esc cancel">
      {activeQuestion ? (
        <Box key={`${activeQuestion.header}:${activeQuestion.question}`} flexDirection="column">
          <Text bold>{activeQuestion.header}</Text>
          <Text>{activeQuestion.question}</Text>
          {visibleOptions.items.map((option, visibleIndex) => {
            const optionIndex = visibleOptions.start + visibleIndex;
            return (
              <QuestionOptionLine
                key={`${option.label}:${option.description}`}
                active={optionIndex === props.optionIndex}
                checked={props.selectedOptionIndexes.has(optionIndex)}
                description={option.description}
                index={optionIndex}
                label={option.label}
              />
            );
          })}
          {visibleOptions.hidden > 0 ? (
            <Text dimColor>{`  … ${visibleOptions.hidden} more options`}</Text>
          ) : null}
          {activeQuestion.multiple ? (
            <Text dimColor>Multiple answers allowed. Separate answers with commas.</Text>
          ) : null}
        </Box>
      ) : null}
      <Text dimColor>{mode}</Text>
      <Text>{`answer> ${props.answer}`}</Text>
    </OverlayPanel>
  );
}

function QuestionOptionLine(props: {
  active: boolean;
  checked: boolean;
  description: string;
  index: number;
  label: string;
}) {
  return (
    <Text dimColor={!props.active && !props.checked} bold={props.active}>
      {`${props.active ? "›" : " "} ${props.checked ? "[x]" : "[ ]"} ${props.index + 1}. ${props.label}${props.description ? ` - ${props.description}` : ""}`}
    </Text>
  );
}

export function formatPermissionDescriptionLines(description: string): Array<{
  label: string;
  text: string;
  muted: boolean;
}> {
  const [tool, input] = description.split(": ", 2);
  if (!input) return [{ label: "description", text: description, muted: false }];

  return [
    { label: "tool", text: `Tool: ${tool}`, muted: false },
    { label: "input", text: `Input: ${input}`, muted: true },
  ];
}

export function getQuestionMode(input: {
  activeQuestion:
    | {
        options: Array<{ label: string }>;
      }
    | undefined;
  answer: string;
  optionIndex: number;
  selectedOptionIndexes: Set<number>;
}): string {
  const selectedLabels = getSelectedQuestionLabels({
    activeQuestion: input.activeQuestion,
    selectedOptionIndexes: input.selectedOptionIndexes,
  });

  if (input.answer.length > 0) return `custom answer: ${input.answer}`;
  if (selectedLabels.length > 0) return `selected: ${selectedLabels.join(", ")}`;
  if (input.activeQuestion?.options[input.optionIndex]) {
    return `ready: ${input.activeQuestion.options[input.optionIndex]?.label}`;
  }

  return "type an answer";
}

function getSelectedQuestionLabels(input: {
  activeQuestion:
    | {
        options: Array<{ label: string }>;
      }
    | undefined;
  selectedOptionIndexes: Set<number>;
}): string[] {
  if (!input.activeQuestion) return [];

  return [...input.selectedOptionIndexes]
    .sort((left, right) => left - right)
    .map((index) => input.activeQuestion?.options[index]?.label)
    .filter((label): label is string => typeof label === "string");
}

function getVisibleItems<T>(
  items: T[],
  selectedIndex: number,
  limit: number | undefined,
): { hidden: number; items: T[]; start: number } {
  if (limit === undefined || items.length <= limit) {
    return { hidden: 0, items, start: 0 };
  }

  const start = Math.max(0, Math.min(selectedIndex - Math.floor(limit / 2), items.length - limit));
  return { hidden: items.length - limit, items: items.slice(start, start + limit), start };
}
