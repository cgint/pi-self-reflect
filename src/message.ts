import type { AgentMessage } from "./types.ts";

export const nextGeneratedTimestamp = (messages: AgentMessage[]): number => {
	const latest = messages.reduce((max, message) => {
		const timestamp = typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : max;
		return Math.max(max, timestamp);
	}, 0);
	return latest + 1;
};
