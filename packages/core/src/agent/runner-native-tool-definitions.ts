export const readNativeToolDefinitions = [
  {
    name: "read" as const,
    description: "Read a UTF-8 text file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "glob" as const,
    description: "List workspace files matching a glob pattern.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "grep" as const,
    description: "Search workspace file contents using a regular expression.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, include: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "todowrite" as const,
    description: "Create and maintain a structured task list for the current coding session.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              priority: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["content", "status", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
  },
  {
    name: "question" as const,
    description:
      "Ask the user structured clarification questions, then stop and wait for their answer.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              header: { type: "string" },
              multiple: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["question", "header", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
  {
    name: "skill" as const,
    description: "Load a named skill's instructions into the current context.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "task" as const,
    description:
      "Launch a foreground subagent task. Use explore for codebase research and general for broader work.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        prompt: { type: "string" },
        subagent_type: { type: "string" },
        task_id: { type: "string" },
        command: { type: "string" },
      },
      required: ["description", "prompt", "subagent_type"],
      additionalProperties: false,
    },
  },
  {
    name: "plan_exit" as const,
    description: "Call when the plan file is complete and ready for user approval.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
];

export const networkNativeToolDefinitions = [
  {
    name: "webfetch" as const,
    description: "Fetch content from a URL and return it as markdown, text, or html.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        format: { type: "string", enum: ["markdown", "text", "html"] },
        timeout: { type: "number" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

export const editNativeToolDefinitions = [
  {
    name: "edit" as const,
    description:
      "Perform an exact string replacement in a workspace file. Prefer after reading the file. Use replaceAll only when all occurrences should change.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["filePath", "oldString", "newString"],
      additionalProperties: false,
    },
  },
  {
    name: "write" as const,
    description: "Write full content to a workspace file. Prefer edit for existing files.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
  },
];

export const patchNativeToolDefinitions = [
  {
    name: "apply_patch" as const,
    description:
      "Apply an OpenCode-style patch envelope with *** Begin Patch / *** End Patch and Add/Delete/Update file sections.",
    inputSchema: {
      type: "object",
      properties: { patchText: { type: "string" } },
      required: ["patchText"],
      additionalProperties: false,
    },
  },
];
