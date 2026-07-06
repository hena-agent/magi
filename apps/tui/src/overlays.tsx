import { Box, Text } from "ink";
import type { PendingPermission, PendingQuestion, PendingSelector } from "./app-controller.js";

export function OverlayArea(props: {
  pendingPermission: PendingPermission | undefined;
  pendingQuestion: PendingQuestion | undefined;
  pendingSelector: PendingSelector | undefined;
  questionAnswer: string;
  questionOptionIndex: number;
  questionSelectedOptionIndexes: Set<number>;
}) {
  if (props.pendingSelector) {
    return <SelectorOverlay selector={props.pendingSelector} />;
  }

  if (props.pendingQuestion) {
    return (
      <QuestionOverlay
        pendingQuestion={props.pendingQuestion}
        answer={props.questionAnswer}
        optionIndex={props.questionOptionIndex}
        selectedOptionIndexes={props.questionSelectedOptionIndexes}
      />
    );
  }

  if (props.pendingPermission) {
    return <PermissionOverlay pendingPermission={props.pendingPermission} />;
  }

  return null;
}

function SelectorOverlay(props: { selector: PendingSelector }) {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        {` ${props.selector.title} `}
      </Text>
      {props.selector.subtitle ? <Text dimColor>{props.selector.subtitle}</Text> : null}
      {props.selector.items.map((item, index) => {
        const selected = index === props.selector.selectedIndex;
        return (
          <Box key={item.value} flexDirection="column" marginTop={index === 0 ? 1 : 0}>
            <Text
              color={selected ? "black" : "white"}
              backgroundColor={selected ? "cyan" : undefined}
              bold={selected}
            >
              {`${selected ? "›" : " "} ${item.label}`}
            </Text>
            {item.description ? <Text dimColor>{`  ${item.description}`}</Text> : null}
          </Box>
        );
      })}
      <Text dimColor>↑/↓ select enter confirm esc cancel</Text>
    </Box>
  );
}

function PermissionOverlay(props: { pendingPermission: PendingPermission }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Permission Required
      </Text>
      <Text>{formatPermissionDescription(props.pendingPermission.description)}</Text>
      <Text dimColor>[y] allow [n] deny [esc] cancel</Text>
    </Box>
  );
}

function QuestionOverlay(props: {
  pendingQuestion: PendingQuestion;
  answer: string;
  optionIndex: number;
  selectedOptionIndexes: Set<number>;
}) {
  const activeQuestion = props.pendingQuestion.questions[0];
  const selectedLabels = activeQuestion
    ? [...props.selectedOptionIndexes]
        .sort((left, right) => left - right)
        .map((index) => activeQuestion.options[index]?.label)
        .filter((label): label is string => typeof label === "string")
    : [];
  const mode =
    props.answer.length > 0
      ? `custom answer: ${props.answer}`
      : selectedLabels.length > 0
        ? `selected: ${selectedLabels.join(", ")}`
        : activeQuestion?.options[props.optionIndex]
          ? `ready: ${activeQuestion.options[props.optionIndex]?.label}`
          : "type an answer";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Question
      </Text>
      {props.pendingQuestion.questions.map((question, questionIndex) => (
        <Box key={`${question.header}:${question.question}`} flexDirection="column" marginTop={1}>
          <Text color="cyan">{`${questionIndex + 1}. ${question.header}`}</Text>
          <Text>{question.question}</Text>
          {question.options.map((option, optionIndex) => (
            <QuestionOptionLine
              key={`${option.label}:${option.description}`}
              active={questionIndex === 0 && optionIndex === props.optionIndex}
              checked={questionIndex === 0 && props.selectedOptionIndexes.has(optionIndex)}
              description={option.description}
              index={optionIndex}
              label={option.label}
            />
          ))}
          {question.multiple ? (
            <Text dimColor>Multiple answers allowed. Separate answers with commas.</Text>
          ) : null}
        </Box>
      ))}
      <Text color={props.answer.length > 0 ? "green" : "cyan"}>{mode}</Text>
      <Text>{`answer> ${props.answer}`}</Text>
      <Text dimColor>↑/↓ select space mark enter submit esc cancel</Text>
    </Box>
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
    <Text
      dimColor={!props.active && !props.checked}
      color={props.active ? "black" : props.checked ? "cyan" : undefined}
      backgroundColor={props.active ? "cyan" : undefined}
    >
      {`${props.active ? "›" : " "} ${props.checked ? "[x]" : "[ ]"} ${props.index + 1}. ${props.label}${props.description ? ` - ${props.description}` : ""}`}
    </Text>
  );
}

function formatPermissionDescription(description: string): string {
  const [tool, input] = description.split(": ", 2);
  return input ? `Tool: ${tool}\nInput: ${input}` : description;
}
