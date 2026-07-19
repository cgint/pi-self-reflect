import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseCadence, parseReflectionStrategy } from "./config.ts";
import type { ReflectionStrategy } from "./types.ts";

export type SelfReflectCommandController = {
	statusText: (ctx: ExtensionContext) => string;
	showCommandResult: (content: string, ctx: ExtensionContext) => void;
	setSuspended: (value: boolean) => void;
	setCadence: (value: number) => void;
	getCadence: () => number;
	getNextCheckpointAt: () => number;
	resetNextCheckpoint: () => void;
	updateProgressStatus: (ctx: ExtensionContext) => void;
	clearReflectorModelOverride: () => void;
	setReflectorModelOverride: (value: string) => void;
	getReflectionStrategy: () => ReflectionStrategy;
	setReflectionStrategy: (value: ReflectionStrategy) => void;
	setAgentEndReflectionEnabled: (value: boolean) => void;
	resetConsecutiveAutoContinues: () => void;
	runManualReflection: (ctx: ExtensionContext) => Promise<void>;
};

export const registerSelfReflectCommands = (pi: ExtensionAPI, controller: SelfReflectCommandController) => {
	pi.registerCommand("self-reflect-status", {
		description: "Show self-reflection checkpoint status",
		handler: async (_args, ctx) => {
			controller.showCommandResult(controller.statusText(ctx), ctx);
		},
	});

	pi.registerCommand("self-reflect-suspend", {
		description: "Suspend self-reflection checkpoints for this extension runtime",
		handler: async (_args, ctx) => {
			controller.setSuspended(true);
			controller.updateProgressStatus(ctx);
			controller.showCommandResult(["Self-reflection suspended.", "Counters remain visible; checkpoints will not run until resumed.", controller.statusText(ctx)].join("\n"), ctx);
		},
	});

	pi.registerCommand("self-reflect-resume", {
		description: "Resume self-reflection checkpoints for this extension runtime",
		handler: async (_args, ctx) => {
			controller.setSuspended(false);
			controller.resetNextCheckpoint();
			controller.updateProgressStatus(ctx);
			controller.showCommandResult(["Self-reflection resumed.", `Next checkpoint scheduled at iteration ${controller.getNextCheckpointAt()}.`, controller.statusText(ctx)].join("\n"), ctx);
		},
	});

	pi.registerCommand("self-reflect-cadence", {
		description: "Set self-reflection cadence for this extension runtime (usage: /self-reflect-cadence <positive integer>)",
		handler: async (args, ctx) => {
			const next = parseCadence(args.trim(), Number.NaN);
			if (!Number.isFinite(next)) {
				controller.showCommandResult(`Invalid cadence ${JSON.stringify(args.trim())}. Use a positive integer.\n\n${controller.statusText(ctx)}`, ctx);
				return;
			}
			controller.setCadence(next);
			controller.resetNextCheckpoint();
			controller.updateProgressStatus(ctx);
			controller.showCommandResult([`Self-reflection cadence set to ${controller.getCadence()}.`, `Next checkpoint scheduled at iteration ${controller.getNextCheckpointAt()}.`, controller.statusText(ctx)].join("\n"), ctx);
		},
	});

	pi.registerCommand("self-reflect-model", {
		description: "Set reflection model for this runtime (usage: /self-reflect-model <provider/model-id|driver|status>)",
		handler: async (args, ctx) => {
			const value = args.trim();
			const normalized = value.toLowerCase();
			if (!value || normalized === "status") {
				controller.showCommandResult(controller.statusText(ctx), ctx);
				return;
			}
			if (["driver", "default", "none", "off", "clear"].includes(normalized)) {
				controller.clearReflectorModelOverride();
				controller.showCommandResult(["Self-reflection model set to driver model.", controller.statusText(ctx)].join("\n"), ctx);
				return;
			}

			const separator = value.indexOf("/");
			if (separator <= 0 || separator === value.length - 1) {
				controller.showCommandResult(`Invalid reflector model ${JSON.stringify(value)}. Use provider/model-id, driver, or status.\n\n${controller.statusText(ctx)}`, ctx);
				return;
			}
			const provider = value.slice(0, separator);
			const modelId = value.slice(separator + 1);
			const model = ctx.modelRegistry.find(provider, modelId);
			if (!model) {
				controller.showCommandResult(`Reflector model ${JSON.stringify(value)} is not registered. Use /model to inspect available models, or /self-reflect-model driver to follow the driver model.\n\n${controller.statusText(ctx)}`, ctx);
				return;
			}

			controller.setReflectorModelOverride(`${provider}/${modelId}`);
			controller.showCommandResult([`Self-reflection model set to ${provider}/${modelId}.`, controller.statusText(ctx)].join("\n"), ctx);
		},
	});

	pi.registerCommand("self-reflect-strategy", {
		description: "Set reflection strategy for this runtime (usage: /self-reflect-strategy <multi|single|status>)",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value || value === "status") {
				controller.showCommandResult(controller.statusText(ctx), ctx);
				return;
			}
			const parsed = parseReflectionStrategy(value, controller.getReflectionStrategy());
			if (parsed !== value && !["multi-view", "views", "one", "one-shot"].includes(value)) {
				controller.showCommandResult(`Invalid self-reflection strategy ${JSON.stringify(args.trim())}. Use multi, single, or status.\n\n${controller.statusText(ctx)}`, ctx);
				return;
			}
			controller.setReflectionStrategy(parsed);
			controller.showCommandResult([`Self-reflection strategy set to ${parsed}.`, controller.statusText(ctx)].join("\n"), ctx);
		},
	});

	pi.registerCommand("self-reflect-now", {
		description: "Run self-reflection immediately over the current conversation while the agent is idle",
		handler: async (_args, ctx) => {
			await controller.runManualReflection(ctx);
		},
	});

	pi.registerCommand("self-reflect-agent-end", {
		description: "Control reflection when the agent is about to return to the user (usage: /self-reflect-agent-end <on|off|status>)",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value || value === "status") {
				controller.showCommandResult(controller.statusText(ctx), ctx);
				return;
			}
			if (["on", "enable", "enabled", "true", "1", "yes"].includes(value)) {
				controller.setAgentEndReflectionEnabled(true);
				controller.showCommandResult(["Agent-end self-reflection enabled.", controller.statusText(ctx)].join("\n"), ctx);
				return;
			}
			if (["off", "disable", "disabled", "false", "0", "no"].includes(value)) {
				controller.setAgentEndReflectionEnabled(false);
				controller.resetConsecutiveAutoContinues();
				controller.showCommandResult(["Agent-end self-reflection disabled.", controller.statusText(ctx)].join("\n"), ctx);
				return;
			}
			controller.showCommandResult(`Invalid agent-end setting ${JSON.stringify(args.trim())}. Use on, off, or status.\n\n${controller.statusText(ctx)}`, ctx);
		},
	});
};

