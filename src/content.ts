import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./types.ts";

export const textFromContent = (content: unknown): string => {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
};

export const textFromAssistant = (message: AssistantMessage): string => textFromContent(message.content);

export const lastAssistantWasAborted = (messages: AgentMessage[]): boolean => {
	// Pi currently exposes agent-end handling with message history, not a dedicated
	// "agent aborted" event for this extension hook. Treat the latest assistant
	// stopReason as the authoritative best-effort signal and fail open otherwise.
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant") return message.stopReason === "aborted";
	}
	return false;
};
