import { Box, Text } from "ink";
import type { PendingPermission, PendingQuestion, PendingSelector } from "./app-controller.js";

export function OverlayArea(props: {
  pendingPermission: PendingPermission | undefined;
  pendingQuestion: PendingQuestion | undefined;
  pendingSelector: PendingSelector | undefined;
  questionAnswer: string;
}) {
  if (props.pendingSelector) {
    return <SelectorOverlay selector={props.pendingSelector} />;
  }

  if (props.pendingQuestion) {
    return (
      <QuestionOverlay pendingQuestion={props.pendingQuestion} answer={props.questionAnswer} />
    );
  }

  if (props.pendingPermission) {
    return <PermissionOverlay pendingPermission={props.pendingPermission} />;
  }

  return null;
}

function SelectorOverlay(props: { selector: PendingSelector }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        {props.selector.title}
      </Text>
      {props.selector.subtitle ? <Text dimColor>{props.selector.subtitle}</Text> : null}
      {props.selector.items.map((item, index) => {
        const selected = index === props.selector.selectedIndex;
        return (
          <Text
            key={item.value}
            color={selected ? "black" : undefined}
            backgroundColor={selected ? "cyan" : undefined}
          >
            {`${selected ? "›" : " "} ${item.label}${item.description ? `  ${item.description}` : ""}`}
          </Text>
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

function QuestionOverlay(props: { pendingQuestion: PendingQuestion; answer: string }) {
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
            <Text key={`${option.label}:${option.description}`} dimColor>
              {`${optionIndex + 1}. ${option.label}${option.description ? ` - ${option.description}` : ""}`}
            </Text>
          ))}
          {question.multiple ? (
            <Text dimColor>Multiple answers allowed. Separate answers with commas.</Text>
          ) : null}
        </Box>
      ))}
      <Text>{`answer> ${props.answer}`}</Text>
      <Text dimColor>[enter] submit [esc] cancel</Text>
    </Box>
  );
}

function formatPermissionDescription(description: string): string {
  const [tool, input] = description.split(": ", 2);
  return input ? `Tool: ${tool}\nInput: ${input}` : description;
}
