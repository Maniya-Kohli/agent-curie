export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ToolResponse {
  toolName: string;
  result: string;
  success: boolean;
}
