import { request } from "./generate";

export interface ToolUsageItem {
    name: string;
    arguments: Record<string, unknown>;
}

export interface ToolParamDef {
    type: string;
    description: string;
    enum?: string[];
    default?: unknown;
}

export interface ToolDefinition {
    type: string;
    function: {
        name: string;
        description: string;
        parameters: {
            type: string;
            properties: Record<string, ToolParamDef>;
            required: string[];
        };
    };
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: ChatContent;
}

export type ChatContent = string | ChatContentPart[];

export type ChatContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

export interface ChatRequest {
    messages: ChatMessage[];
    model?: string;
    max_tokens?: number;
    temperature?: number;
}

// SSE event types emitted by the streaming endpoint
export type ChatStreamEvent =
    | { type: "tool_start"; name: string; arguments: Record<string, unknown> }
    | { type: "tool_end";   name: string }
    | { type: "content";    text: string }
    | { type: "done";       tool_usage: ToolUsageItem[] }
    | { type: "error";      message: string };

export async function chatStream(
    body: ChatRequest,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
): Promise<void> {
    const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Chat request failed (${response.status}): ${text}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const data = line.slice(6).trim();
                if (!data) continue;
                try {
                    onEvent(JSON.parse(data) as ChatStreamEvent);
                } catch { /* skip malformed chunk */ }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

export const chatApi = {
    getTools: () => request<ToolDefinition[]>("/api/chat/tools"),
    uploadChatMedia: async (file: File) => {
        const form = new FormData();
        form.set("file", file, file.name);
        const response = await fetch("/api/chat/uploads", { method: "POST", body: form });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(text || "Failed to upload media.");
        }
        return await response.json() as { filename: string; url: string; content_type: string };
    },
};
