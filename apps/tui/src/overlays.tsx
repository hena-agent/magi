import { Box, Text } from "ink";
import type { PendingPermission, PendingQuestion } from "./app-controller.js";

export function OverlayArea(props: {
  pendingPermission: PendingPermission | undefined;
  pendingQuestion: PendingQuestion | undefined;
  questionAnswer: string;
}) {
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
