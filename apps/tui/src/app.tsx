import { AppController } from "./app-controller.js";
import type { AppLifecycle } from "./app-lifecycle.js";

export function App(props: { fullscreen?: boolean; lifecycle?: AppLifecycle }) {
  return <AppController fullscreen={props.fullscreen === true} lifecycle={props.lifecycle} />;
}
