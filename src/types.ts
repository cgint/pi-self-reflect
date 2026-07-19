import type { convertToLlm } from "@earendil-works/pi-coding-agent";

export type AgentMessage = Parameters<typeof convertToLlm>[0][number];
export type CustomAgentMessage = Extract<AgentMessage, { role: "custom" }>;

export type ReflectionOutcome = "OK" | "NOTE" | "STEER" | "PAUSE_USER" | "MALFORMED";

export type ReflectionResult = {
	outcome: ReflectionOutcome;
	reason: string;
	message: string;
	raw: string;
};

export type ReflectionTrigger = "cadence" | "agent_end" | "manual";

export type ReflectionStrategy = "multi" | "single";

export type CheckpointRecord = {
	checkpoint: number;
	iteration: number;
	trigger: ReflectionTrigger;
	outcome: ReflectionOutcome | "ERROR" | "SKIPPED";
	reason: string;
	message: string;
	raw?: string;
	injected?: boolean;
	timestamp: string;
};
