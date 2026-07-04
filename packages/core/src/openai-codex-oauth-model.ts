export function isOpenAICodexOAuthModel(model: string): boolean {
  if (
    model === "gpt-5.5" ||
    model === "gpt-5.3-codex-spark" ||
    model === "gpt-5.4" ||
    model === "gpt-5.4-mini"
  ) {
    return true;
  }

  if (model === "gpt-5.5-pro") {
    return false;
  }

  const match = model.match(/^gpt-(\d+\.\d+)/);

  return match ? Number.parseFloat(match[1] ?? "0") > 5.4 : false;
}
