export const DEFAULT_CADENCE = 10;

export const parseCadence = (value: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
	if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
	return fallback;
};

export type ReflectionTransport = "sse" | "auto" | "websocket" | "websocket-cached";

export const parseReflectionStrategy = (value: string | undefined, fallback: "multi" | "single"): "multi" | "single" => {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "multi" || normalized === "multi-view" || normalized === "views") return "multi";
	if (normalized === "single" || normalized === "one" || normalized === "one-shot") return "single";
	return fallback;
};

export const parseReflectionTransport = (value: string | undefined, fallback: ReflectionTransport): ReflectionTransport => {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "sse" || normalized === "auto" || normalized === "websocket" || normalized === "websocket-cached") return normalized;
	return fallback;
};

export const INITIAL_CADENCE = parseCadence(process.env.PI_SELF_REFLECT_CADENCE, DEFAULT_CADENCE);
export const INITIAL_AGENT_END_ENABLED = parseBoolean(process.env.PI_SELF_REFLECT_AGENT_END, true);
export const REFLECTION_MAX_TOKENS = Number.parseInt(process.env.PI_SELF_REFLECT_MAX_TOKENS ?? "600", 10) || 600;
export const MAX_AUTO_CONTINUES = parseCadence(process.env.PI_SELF_REFLECT_MAX_AUTO_CONTINUES, 3);
export const MAX_AGENT_END_REFLECTIONS_PER_USER_TURN = parseCadence(process.env.PI_SELF_REFLECT_MAX_AGENT_END_REFLECTIONS_PER_USER_TURN, 1);
export const MIN_AGENT_END_ITERATIONS_SINCE_USER_INPUT = parseCadence(process.env.PI_SELF_REFLECT_AGENT_END_MIN_ITERATIONS_SINCE_USER_INPUT, 3);
export const INITIAL_REFLECTION_STRATEGY = parseReflectionStrategy(process.env.PI_SELF_REFLECT_STRATEGY, "multi");
export const INITIAL_REFLECTOR_MODEL_OVERRIDE = process.env.PI_SELF_REFLECT_MODEL?.trim();
export const REFLECTION_TRANSPORT = parseReflectionTransport(process.env.PI_SELF_REFLECT_TRANSPORT, "sse");
export const TEST_REFLECTION_RESPONSE = process.env.PI_SELF_REFLECT_TEST_RESPONSE;
export const TEST_REFLECTION_RETRY_RESPONSE = process.env.PI_SELF_REFLECT_TEST_RETRY_RESPONSE;
