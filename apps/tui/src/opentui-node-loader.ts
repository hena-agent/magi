import type { ResolveHook } from "node:module";

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
  if (specifier === "react-reconciler/constants") {
    return nextResolve("react-reconciler/constants.js", context);
  }

  return nextResolve(specifier, context);
};
