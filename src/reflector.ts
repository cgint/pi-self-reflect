import { complete } from "@earendil-works/pi-ai";
import type { Tool } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REFLECTION_MAX_TOKENS, REFLECTION_TRANSPORT, TEST_REFLECTION_RESPONSE, TEST_REFLECTION_RETRY_RESPONSE } from "./config.ts";
import { textFromAssistant } from "./content.ts";
import { parseReflection } from "./parse.ts";
import { buildReflectionCombinerPrompt, buildReflectionViewPrompts, buildSingleReflectionPrompt } from "./prompt.ts";
import { nextGeneratedTimestamp } from "./message.ts";
import type { AgentMessage, ReflectionResult, ReflectionStrategy, ReflectionTrigger } from "./types.ts";

export const modelLabel = (model: { provider: string; id: string } | undefined): string =>
	model ? `${model.provider}/${model.id}` : "none";

export const resolveReflectorModelOverride = (ctx: ExtensionContext, reflectorModelOverride: string | undefined, options: { throwOnError: boolean }) => {
	if (!reflectorModelOverride) return undefined;
	const separator = reflectorModelOverride.indexOf("/");
	if (separator <= 0 || separator === reflectorModelOverride.length - 1) {
		if (options.throwOnError) throw new Error(`Invalid reflector model ${JSON.stringify(reflectorModelOverride)}. Use provider/model-id or driver.`);
		return undefined;
	}
	const provider = reflectorModelOverride.slice(0, separator);
	const modelId = reflectorModelOverride.slice(separator + 1);
	const model = ctx.modelRegistry.find(provider, modelId);
	if (!model && options.throwOnError) {
		throw new Error(`Reflector model ${JSON.stringify(reflectorModelOverride)} is not registered.`);
	}
	return model;
};

export const configuredReflectorModelLabel = (ctx: ExtensionContext, reflectorModelOverride: string | undefined): string => {
	if (!reflectorModelOverride) return `driver (${modelLabel(ctx.model)})`;
	const resolved = resolveReflectorModelOverride(ctx, reflectorModelOverride, { throwOnError: false });
	return resolved ? `override (${modelLabel(resolved)})` : `override invalid (${reflectorModelOverride})`;
};

const VIEW_MAX_TOKENS = 32;
const COMBINER_MAX_TOKENS = 80;
const SINGLE_MAX_TOKENS = 120;
const RAW_DIAGNOSTIC_MAX_CHARS = 400;

const truncateDiagnostic = (text: string): string => {
	const trimmed = text.trim();
	if (trimmed.length <= RAW_DIAGNOSTIC_MAX_CHARS) return trimmed;
	return `${trimmed.slice(0, RAW_DIAGNOSTIC_MAX_CHARS).trimEnd()} …[truncated]`;
};

const activeToolsForReflection = (pi: ExtensionAPI): Tool[] => {
	const active = new Set(pi.getActiveTools());
	return pi
		.getAllTools()
		.filter((tool) => active.has(tool.name))
		.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		}));
};

type RunReflectionOptions = {
	messages: AgentMessage[];
	ctx: ExtensionContext;
	pi: ExtensionAPI;
	checkpoint: number;
	iteration: number;
	trigger: ReflectionTrigger;
	reflectorModelOverride?: string;
	strategy: ReflectionStrategy;
};

export const runReflection = async ({
	messages,
	ctx,
	pi,
	checkpoint,
	iteration,
	trigger,
	reflectorModelOverride,
	strategy,
}: RunReflectionOptions): Promise<ReflectionResult> => {
	if (TEST_REFLECTION_RESPONSE?.trim()) {
		const firstResult = parseReflection(TEST_REFLECTION_RESPONSE);
		if (firstResult.outcome !== "MALFORMED") {
			return firstResult;
		}
		const retryResult = parseReflection(TEST_REFLECTION_RETRY_RESPONSE ?? TEST_REFLECTION_RESPONSE);
		if (retryResult.outcome === "MALFORMED") {
			return {
				...retryResult,
				reason: "Reflection response did not start with required prefix OK:, NOTE:, STEER:, or PAUSE_USER: after one retry.",
			};
		}
		return retryResult;
	}

	const model = resolveReflectorModelOverride(ctx, reflectorModelOverride, { throwOnError: true }) ?? ctx.model;
	if (!model) {
		throw new Error("No active model available for reflection.");
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		throw new Error(auth.error);
	}
	if (!auth.apiKey) {
		throw new Error(`No API key available for ${model.provider}/${model.id}.`);
	}

	const tools = activeToolsForReflection(pi);
	// Provider-chain containment: reflection must not mutate the driver's provider
	// continuation state. OpenAI Codex websocket continuations were observed to fail
	// after out-of-band calls reused the driving session id. Reflection therefore uses
	// stable sidecar session ids; transport defaults to SSE for correctness, with an
	// explicit PI_SELF_REFLECT_TRANSPORT escape hatch for cache experiments.
	const baseSessionId = `${ctx.sessionManager.getSessionId()}:self-reflect`;
	const callReflectorRaw = async (candidateMessages: AgentMessage[], sessionSuffix: string, maxTokens: number) => {
		const response = await complete(
			model,
			{
				systemPrompt: ctx.getSystemPrompt(),
				messages: convertToLlm(candidateMessages),
				tools,
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				signal: ctx.signal,
				// Use sidecar session ids: the prompt/history prefix is identical, but provider-level
				// continuation state (for example Codex previous_response_id over websocket) must not
				// be mutated by reflection or the driving agent's next call can fail. Expert views run
				// sequentially, but each view still gets a stable sidecar suffix instead of sharing one chain.
				sessionId: `${baseSessionId}:${sessionSuffix}`,
				transport: REFLECTION_TRANSPORT,
				maxTokens,
			},
		);
		return textFromAssistant(response).trim();
	};

	const sanitizeViewOutput = (rawOutput: string) => {
		const raw = rawOutput.trim();
		const normalized = raw
			.replace(/^```(?:text)?\s*/i, "")
			.replace(/\s*```$/i, "")
			.replace(/^\*\*(CLEAR:|ISSUE:)/, "$1")
			.replace(/\*\*$/, "")
			.trim();
		if (normalized === "CLEAR:" || normalized.startsWith("CLEAR:\n")) return { finding: "CLEAR:", raw, malformed: false };
		if (normalized.startsWith("ISSUE:")) return { finding: normalized, raw, malformed: false };
		return { finding: undefined, raw, malformed: true };
	};

	const parseWithRetry = async (candidateMessages: AgentMessage[], sessionSuffix: string, malformedReason: string): Promise<ReflectionResult> => {
		const raw = await callReflectorRaw(candidateMessages, sessionSuffix, Math.min(REFLECTION_MAX_TOKENS, strategy === "single" ? SINGLE_MAX_TOKENS : COMBINER_MAX_TOKENS));
		const firstResult = parseReflection(raw);
		if (firstResult.outcome !== "MALFORMED") return firstResult;
		const retryPrompt: AgentMessage = {
			role: "user",
			content: [
				{
					type: "text",
					text: [
						"FORMAT REPAIR ONLY.",
						"Return exactly one line. Allowed prefixes: OK:, NOTE:, STEER:, PAUSE_USER:.",
						"Default: OK:",
						"No explanation. No markdown. No analysis. No mention of malformed output.",
					].join("\n"),
				},
			],
			timestamp: nextGeneratedTimestamp(candidateMessages),
		};
		const retryRaw = await callReflectorRaw([...candidateMessages, retryPrompt], `${sessionSuffix}-retry`, Math.min(REFLECTION_MAX_TOKENS, strategy === "single" ? SINGLE_MAX_TOKENS : COMBINER_MAX_TOKENS));
		const retryResult = parseReflection(retryRaw);
		if (retryResult.outcome === "MALFORMED") {
			return {
				...retryResult,
				reason: malformedReason,
			};
		}
		return retryResult;
	};

	if (strategy === "single") {
		const prompt = buildSingleReflectionPrompt(checkpoint, iteration, trigger, messages);
		return parseWithRetry([...messages, prompt], "single", "Single reflection response did not start with required prefix OK:, NOTE:, STEER:, or PAUSE_USER: after one retry.");
	}

	const viewPrompts = buildReflectionViewPrompts(checkpoint, trigger, messages);
	type ViewResult = { id: string; name: string; finding?: string; raw: string; malformed: boolean };
	const viewResults: ViewResult[] = [];

	// CRITICAL: Expert views MUST run sequentially (for loop), NEVER in parallel (Promise.all).
	//
	// Each expert view sends the full conversation history as its message prefix.
	// Because all views share this identical long prefix, the provider's KV-cache
	// (or prompt-cache) from view N is still warm when view N+1 starts. This means
	// only view 1 pays for the full history; views 2–N pay only for their short,
	// view-specific suffix text. Parallel calls would each rebuild the cache independently,
	// multiplying cost and latency by ~N× and defeating the cache-sensitive design that
	// is a core architecture constraint for this extension.
	//
	// See AGENTS.md "Core architecture constraints" and "External harness/fusion lessons"
	// for the original decision record. Do not change to Promise.all without verifying
	// cache behavior with the target provider first.
	for (const view of viewPrompts) {
		try {
			const parsed = sanitizeViewOutput(await callReflectorRaw([...messages, view.message], `view-${view.id}`, VIEW_MAX_TOKENS));
			viewResults.push({
				id: view.id,
				name: view.name,
				finding: parsed.finding,
				raw: parsed.raw,
				malformed: parsed.malformed,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			viewResults.push({
				id: view.id,
				name: view.name,
				raw: `ERROR: ${message}`,
				malformed: true,
			});
		}
	}
	const validIssueCount = viewResults.filter((view) => view.finding?.startsWith("ISSUE:")).length;
	const viewOutputs = viewResults
		.filter((view) => view.finding !== undefined)
		.map(({ id, name, finding }) => ({ id, name, output: finding ?? "" }));
	const rawWithViews = (combinerOutput: string, includeMalformedDetails: boolean) => {
		const malformedWithRaw = viewResults.filter((view) => view.malformed && view.raw);
		return [
			"Expert view outputs used for synthesis:",
			...(viewOutputs.length > 0 ? viewOutputs.map((view) => `- ${view.name} (${view.id}): ${view.output}`) : ["(none; no valid expert-view findings)"]),
			"Malformed expert view outputs excluded from synthesis:",
			...(includeMalformedDetails
				? [
					...malformedWithRaw.map((view) => `- ${view.name} (${view.id}): ${truncateDiagnostic(view.raw)}`),
					...(malformedWithRaw.length > 0 ? [] : ["(none)"]),
				]
				: [malformedWithRaw.length > 0 ? `(${malformedWithRaw.length} suppressed; no valid expert finding, no driver information)` : "(none)"]),
			"Combiner output:",
			combinerOutput || "(empty)",
		].join("\n");
	};

	if (validIssueCount === 0) {
		return {
			outcome: "OK",
			reason: "No valid expert view reported a material process issue.",
			message: "Continue unchanged.",
			raw: rawWithViews("OK: No valid expert view reported a material process issue.", false),
		};
	}

	const combinerPrompt = buildReflectionCombinerPrompt(checkpoint, iteration, trigger, messages, viewOutputs);
	const combinerResult = await parseWithRetry(
		[combinerPrompt],
		"combiner",
		"Reflection combiner response did not start with required prefix OK:, NOTE:, STEER:, or PAUSE_USER: after one retry.",
	);
	return {
		...combinerResult,
		raw: rawWithViews(combinerResult.raw, true),
	};
};
