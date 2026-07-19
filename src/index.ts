import { buildSessionContext, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_CADENCE,
	INITIAL_AGENT_END_ENABLED,
	INITIAL_CADENCE,
	INITIAL_REFLECTION_STRATEGY,
	INITIAL_REFLECTOR_MODEL_OVERRIDE,
	REFLECTION_TRANSPORT,
	MAX_AGENT_END_REFLECTIONS_PER_USER_TURN,
	MAX_AUTO_CONTINUES,
	MIN_AGENT_END_ITERATIONS_SINCE_USER_INPUT,
} from "./config.ts";
import { registerSelfReflectCommands } from "./commands.ts";
import { lastAssistantWasAborted } from "./content.ts";
import { emitImmediateText, emitVisibleRecord } from "./display.ts";
import { nextGeneratedTimestamp } from "./message.ts";
import { configuredReflectorModelLabel, runReflection } from "./reflector.ts";
import { buildSteeringMessage } from "./steering.ts";
import type { AgentMessage, CheckpointRecord } from "./types.ts";

export default function selfReflect(pi: ExtensionAPI) {

	let cadence = INITIAL_CADENCE;
	let suspended = false;
	let agentEndReflectionEnabled = INITIAL_AGENT_END_ENABLED;
	let iterationCount = 0;
	let nextCheckpointAt = cadence;
	let checkpointCount = 0;
	let consecutiveAutoContinues = 0;
	let agentEndReflectionsSinceUserInput = 0;
	let iterationsSinceUserInput = 0;
	let isReflecting = false;
	let reflectorModelOverride = INITIAL_REFLECTOR_MODEL_OVERRIDE;
	let reflectionStrategy = INITIAL_REFLECTION_STRATEGY;
	let lastRecord: CheckpointRecord | undefined;

	const setStatus = (ctx: ExtensionContext, text: string | undefined) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("self-reflect", text);
		}
	};

	const resetNextCheckpoint = () => {
		nextCheckpointAt = iterationsSinceUserInput + cadence;
	};

	const progressWithinCadence = () => Math.max(0, cadence - (nextCheckpointAt - iterationsSinceUserInput));

	const updateProgressStatus = (ctx: ExtensionContext) => {
		if (suspended) {
			setStatus(ctx, `reflect: suspended (${cadence})`);
			return;
		}
		setStatus(ctx, `reflect: ${Math.min(progressWithinCadence(), cadence)}/${cadence}`);
	};

	const statusText = (ctx: ExtensionContext) =>
		[
			`enabled: ${suspended ? "no (suspended)" : "yes"}`,
			`reflector model: ${configuredReflectorModelLabel(ctx, reflectorModelOverride)}`,
			`reflection strategy: ${reflectionStrategy}`,
			`env reflection strategy override: ${process.env.PI_SELF_REFLECT_STRATEGY ?? "none"}`,
			`reflection transport: ${REFLECTION_TRANSPORT}`,
			`env reflection transport override: ${process.env.PI_SELF_REFLECT_TRANSPORT ?? "none"}`,
			`runtime reflector model override: ${reflectorModelOverride || "none (driver)"}`,
			`env reflector model override: ${INITIAL_REFLECTOR_MODEL_OVERRIDE || "none"}`,
			`cadence: ${cadence}`,
			`default cadence: ${DEFAULT_CADENCE}`,
			`env cadence override: ${process.env.PI_SELF_REFLECT_CADENCE ?? "none"}`,
			`agent-end reflection: ${agentEndReflectionEnabled ? "on" : "off"}`,
			`env agent-end override: ${process.env.PI_SELF_REFLECT_AGENT_END ?? "none"}`,
			`max automatic continuations: ${MAX_AUTO_CONTINUES}`,
			`current automatic continuation streak: ${consecutiveAutoContinues}`,
			`max agent-end auto-reflections per user turn: ${MAX_AGENT_END_REFLECTIONS_PER_USER_TURN}`,
			`agent-end auto-reflections since user input: ${agentEndReflectionsSinceUserInput}`,
			`agent-end min iterations since user input: ${MIN_AGENT_END_ITERATIONS_SINCE_USER_INPUT}`,
			`iterations since user input: ${iterationsSinceUserInput}`,
			`iterations: ${iterationCount}`,
			`next cadence checkpoint since user input at: ${suspended ? "suspended" : nextCheckpointAt}`,
			`checkpoints: ${checkpointCount}`,
			`last outcome: ${lastRecord?.outcome ?? "none"}`,
		].join("\n");

	const showCommandResult = (content: string, ctx: ExtensionContext) => {
		emitImmediateText(content, ctx, "info");
	};

	const recordCheckpoint = (record: CheckpointRecord, ctx: ExtensionContext) => {
		lastRecord = record;
		emitVisibleRecord(pi, record, ctx);
	};

	const reflect = (messages: AgentMessage[], ctx: ExtensionContext, checkpoint: number, trigger: "cadence" | "agent_end" | "manual") =>
		runReflection({
			messages,
			ctx,
			pi,
			checkpoint,
			iteration: iterationCount,
			trigger,
			reflectorModelOverride,
			strategy: reflectionStrategy,
		});

	const runManualReflection = async (ctx: ExtensionContext) => {
		if (isReflecting) {
			showCommandResult("Self-reflection is already running; try again after it finishes.", ctx);
			return;
		}
		if (!ctx.isIdle()) {
			showCommandResult("Self-reflection can only be triggered manually while the agent is idle.", ctx);
			return;
		}

		const checkpoint = checkpointCount + 1;
		checkpointCount = checkpoint;
		consecutiveAutoContinues = 0;
		setStatus(ctx, "reflect: manual checking…");
		isReflecting = true;

		try {
			const sessionContext = buildSessionContext(ctx.sessionManager.getBranch(), ctx.sessionManager.getLeafId());
			const result = await reflect(sessionContext.messages, ctx, checkpoint, "manual");
			const willInjectFollowup =
				result.outcome !== "OK" && result.outcome !== "NOTE" && result.outcome !== "MALFORMED" && ctx.mode !== "print" && ctx.mode !== "json";
			const record: CheckpointRecord = {
				checkpoint,
				iteration: iterationCount,
				trigger: "manual",
				outcome: result.outcome,
				reason: result.reason,
				message: result.message,
				raw: result.raw,
				injected: willInjectFollowup,
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(record, ctx);
			setStatus(
				ctx,
				result.outcome === "OK"
					? "reflect: manual ok"
					: result.outcome === "NOTE"
						? "reflect: manual note"
						: result.outcome === "STEER"
							? "reflect: manual steer"
							: result.outcome === "PAUSE_USER"
								? "reflect: manual pause"
								: "reflect: malformed diagnostic",
			);
			if (result.outcome === "OK" || result.outcome === "NOTE") {
				return;
			}
			if (result.outcome === "MALFORMED") {
				return;
			}
			const followupMessage = buildSteeringMessage(result, checkpoint, nextGeneratedTimestamp(sessionContext.messages));
			if (ctx.mode === "print" || ctx.mode === "json") {
				showCommandResult("Manual self-reflection follow-up delivery is not available in print/json mode; diagnostic was shown visibly.", ctx);
				return;
			}
			pi.sendMessage(followupMessage, { triggerTurn: true, deliverAs: "steer" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const record: CheckpointRecord = {
				checkpoint,
				iteration: iterationCount,
				trigger: "manual",
				outcome: "ERROR",
				reason: message,
				message,
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(record, ctx);
			setStatus(ctx, "reflect: manual error");
		} finally {
			isReflecting = false;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		iterationCount = 0;
		nextCheckpointAt = cadence;
		checkpointCount = 0;
		consecutiveAutoContinues = 0;
		agentEndReflectionsSinceUserInput = 0;
		iterationsSinceUserInput = 0;
		lastRecord = undefined;
		updateProgressStatus(ctx);
	});

	pi.on("tool_result", () => {
		iterationCount += 1;
		iterationsSinceUserInput += 1;
	});

	pi.on("input", (event) => {
		if (event.source === "extension") return;
		consecutiveAutoContinues = 0;
		agentEndReflectionsSinceUserInput = 0;
		iterationsSinceUserInput = 0;
		nextCheckpointAt = cadence;
	});

	pi.on("context", async (event, ctx) => {
		const contextMessages = event.messages;
		if (isReflecting) {
			return { messages: contextMessages };
		}

		iterationCount += 1;
		iterationsSinceUserInput += 1;
		updateProgressStatus(ctx);

		if (suspended || iterationsSinceUserInput < nextCheckpointAt) {
			return { messages: contextMessages };
		}

		const checkpoint = checkpointCount + 1;
		checkpointCount = checkpoint;
		nextCheckpointAt += cadence;
		setStatus(ctx, "reflect: checking…");
		isReflecting = true;

		try {
			const result = await reflect(contextMessages, ctx, checkpoint, "cadence");
			const willInject = result.outcome === "STEER" || result.outcome === "PAUSE_USER";
			const record: CheckpointRecord = {
				checkpoint: checkpointCount,
				iteration: iterationCount,
				trigger: "cadence",
				outcome: result.outcome,
				reason: result.reason,
				message: result.message,
				raw: result.raw,
				injected: willInject,
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(record, ctx);
			setStatus(
				ctx,
				result.outcome === "OK"
					? "reflect: ok"
					: result.outcome === "NOTE"
						? "reflect: note"
						: result.outcome === "STEER"
							? "reflect: steer"
							: result.outcome === "PAUSE_USER"
								? "reflect: pause"
								: "reflect: malformed",
			);

			if (willInject) {
				return { messages: [...contextMessages, buildSteeringMessage(result, checkpointCount, nextGeneratedTimestamp(contextMessages))] };
			}

			return { messages: contextMessages };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const record: CheckpointRecord = {
				checkpoint: checkpointCount,
				iteration: iterationCount,
				trigger: "cadence",
				outcome: "ERROR",
				reason: message,
				message,
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(record, ctx);
			setStatus(ctx, "reflect: error");
			return { messages: contextMessages };
		} finally {
			isReflecting = false;
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (isReflecting || suspended || !agentEndReflectionEnabled) return;
		const contextMessages = event.messages;
		if (lastAssistantWasAborted(contextMessages)) {
			setStatus(ctx, "reflect: agent-end skipped after abort");
			return;
		}
		if (iterationsSinceUserInput < MIN_AGENT_END_ITERATIONS_SINCE_USER_INPUT) {
			setStatus(ctx, `reflect: agent-end below threshold ${iterationsSinceUserInput}/${MIN_AGENT_END_ITERATIONS_SINCE_USER_INPUT}`);
			return;
		}

		const checkpoint = checkpointCount + 1;
		checkpointCount = checkpoint;

		if (agentEndReflectionsSinceUserInput >= MAX_AGENT_END_REFLECTIONS_PER_USER_TURN) {
			const skipped: CheckpointRecord = {
				checkpoint,
				iteration: iterationCount,
				trigger: "agent_end",
				outcome: "SKIPPED",
				reason: `Agent-end auto-reflection budget (${MAX_AGENT_END_REFLECTIONS_PER_USER_TURN}) reached before the next user input.`,
				message: "Returning control to the user without another automatic reflection.",
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(skipped, ctx);
			setStatus(ctx, "reflect: agent-end budget reached");
			return;
		}

		agentEndReflectionsSinceUserInput += 1;
		setStatus(ctx, "reflect: checking agent end…");
		isReflecting = true;

		try {
			const result = await reflect(contextMessages, ctx, checkpoint, "agent_end");
			const willInjectFollowup = (result.outcome === "STEER" || result.outcome === "PAUSE_USER") && consecutiveAutoContinues < MAX_AUTO_CONTINUES;
			const record: CheckpointRecord = {
				checkpoint,
				iteration: iterationCount,
				trigger: "agent_end",
				outcome: result.outcome,
				reason: result.reason,
				message: result.message,
				raw: result.raw,
				injected: willInjectFollowup,
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(record, ctx);

			if (result.outcome === "OK") {
				setStatus(ctx, "reflect: agent-end ok");
				return;
			}

			if (result.outcome === "NOTE") {
				setStatus(ctx, "reflect: agent-end note visible only");
				return;
			}

			if (consecutiveAutoContinues >= MAX_AUTO_CONTINUES) {
				const skipped: CheckpointRecord = {
					checkpoint,
					iteration: iterationCount,
					trigger: "agent_end",
					outcome: "SKIPPED",
					reason: `Automatic continuation limit (${MAX_AUTO_CONTINUES}) reached.`,
					message: "Returning control to the user without another automatic continuation.",
					timestamp: new Date().toISOString(),
				};
				recordCheckpoint(skipped, ctx);
				consecutiveAutoContinues = 0;
				setStatus(ctx, "reflect: auto-continue limit");
				return;
			}

			if (result.outcome === "MALFORMED") {
				setStatus(ctx, "reflect: malformed visible only");
				return;
			}

			consecutiveAutoContinues += 1;
			setStatus(ctx, result.outcome === "STEER" ? "reflect: auto-steer" : "reflect: auto-pause");
			pi.sendMessage(buildSteeringMessage(result, checkpoint, nextGeneratedTimestamp(contextMessages)), { triggerTurn: true, deliverAs: "steer" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const record: CheckpointRecord = {
				checkpoint,
				iteration: iterationCount,
				trigger: "agent_end",
				outcome: "ERROR",
				reason: message,
				message,
				timestamp: new Date().toISOString(),
			};
			recordCheckpoint(record, ctx);
			setStatus(ctx, "reflect: agent-end error");
		} finally {
			isReflecting = false;
		}
	});

	registerSelfReflectCommands(pi, {
		statusText,
		showCommandResult,
		setSuspended: (value) => {
			suspended = value;
		},
		setCadence: (value) => {
			cadence = value;
		},
		getCadence: () => cadence,
		getNextCheckpointAt: () => nextCheckpointAt,
		resetNextCheckpoint,
		updateProgressStatus,
		clearReflectorModelOverride: () => {
			reflectorModelOverride = undefined;
		},
		setReflectorModelOverride: (value) => {
			reflectorModelOverride = value;
		},
		getReflectionStrategy: () => reflectionStrategy,
		setReflectionStrategy: (value) => {
			reflectionStrategy = value;
		},
		setAgentEndReflectionEnabled: (value) => {
			agentEndReflectionEnabled = value;
		},
		resetConsecutiveAutoContinues: () => {
			consecutiveAutoContinues = 0;
		},
		runManualReflection,
	});
}
