import { appStore } from "../state/store";
import { createToolDefinitions, WEBMCP_TOOL_NAMES } from "./toolDefinitions";

type ModelContextLike = {
  registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => Promise<void> | void;
};

declare global {
  interface Window {
    __constraintLabToolsAbort?: AbortController;
  }
}

function getModelContext(): ModelContextLike | undefined {
  return (document as Document & { modelContext?: ModelContextLike }).modelContext;
}

export async function registerConstraintLabTools(): Promise<void> {
  window.__constraintLabToolsAbort?.abort();
  const controller = new AbortController();
  window.__constraintLabToolsAbort = controller;
  let mode: "native" | "polyfill" = "native";
  try {
    if (!("modelContext" in document) || !getModelContext()) {
      mode = "polyfill";
      await import("@mcp-b/global");
    }
    const modelContext = getModelContext();
    if (!modelContext) throw new Error("document.modelContext is unavailable after fallback initialization.");
    for (const tool of createToolDefinitions()) await modelContext.registerTool(tool, { signal: controller.signal });
    appStore.getState().setWebMcpStatus(mode, WEBMCP_TOOL_NAMES);
  } catch (error) {
    console.warn("ConstraintLab WebMCP registration unavailable; human workflow remains active.", error);
    appStore.getState().setWebMcpStatus("unavailable", []);
  }
}
