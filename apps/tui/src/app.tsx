import { AppController } from "./app-controller.js";
import type { AppLifecycle } from "./app-lifecycle.js";

export function App(props: {
  fullscreen?: boolean;
  lifecycle?: AppLifecycle;
  targetDirectory?: string;
}) {
  return (
    <AppController
      fullscreen={props.fullscreen === true}
      lifecycle={props.lifecycle}
      {...(props.targetDirectory === undefined ? {} : { targetDirectory: props.targetDirectory })}
    />
  );
}
