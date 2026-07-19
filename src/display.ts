import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CheckpointRecord } from "./types.ts";

const CONSIDERED = "loop/process risk, user-contract drift, verification/completion risk, grounding/assumptions";

export const visibleCheckpointMessage = (record: CheckpointRecord): string => {
	const trigger = record.trigger === "agent_end" ? "agent end" : record.trigger === "manual" ? "manual" : "cadence";
	const rawLines = record.raw !== undefined ? ["Raw reflector output:", record.raw || "(empty)"] : [];
	const injectedLines = record.injected
		? [`Driver-context injection: ${record.outcome} process support delivered to the driver (internal text not displayed or persisted).`]
		: ["Driver-context injection: none."];
	if (record.outcome === "OK") {
		return [
			`✓ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — OK / continue`,
			`Considered: ${CONSIDERED}.`,
			...rawLines,
			`Result: ${record.message}`,
			...injectedLines,
		].join("\n");
	}
	if (record.outcome === "NOTE") {
		return [
			`ℹ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — NOTE / visible only`,
			`Considered: ${CONSIDERED}.`,
			...rawLines,
			`Reminder: ${record.message}`,
			...injectedLines,
		].join("\n");
	}
	if (record.outcome === "STEER") {
		return [
			`◇ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — STEER`,
			`Considered: ${CONSIDERED}.`,
			...rawLines,
			`Reason: ${record.reason}`,
			...injectedLines,
		].join("\n");
	}
	if (record.outcome === "PAUSE_USER") {
		return [
			`◆ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — PAUSE_USER`,
			`Considered: ${CONSIDERED}.`,
			...rawLines,
			`Reason: ${record.reason}`,
			"Requesting user decision:",
			record.message,
			...injectedLines,
		].join("\n");
	}
	if (record.outcome === "MALFORMED") {
		return [
			`◆ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — MALFORMED`,
			`Considered: ${CONSIDERED}.`,
			...rawLines,
			`Reason: ${record.reason}`,
			"Result: malformed reflection retry also failed; raw output is visible/logged but not treated as reflector approval or steering.",
			...injectedLines,
		].join("\n");
	}
	if (record.outcome === "SKIPPED") {
		return [
			`◆ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — SKIPPED`,
			`Considered: ${CONSIDERED}.`,
			`Reason: ${record.reason}`,
			`Result: ${record.message}`,
		].join("\n");
	}
	return [
		`◆ Self-reflection checkpoint #${record.checkpoint} (${trigger}) — ERROR`,
		`Considered: ${CONSIDERED}.`,
		`Reason: ${record.reason}`,
		"Result: reflection failed open; agent continues unchanged.",
	].join("\n");
};

export const emitImmediateText = (content: string, ctx: ExtensionContext, severity: "info" | "warning" = "info") => {
	if (ctx.hasUI) {
		ctx.ui.notify(content, severity);
		return;
	}

	// Pi print/json modes currently have no transcript-neutral display API. Write directly
	// to stderr as an explicitly non-session side channel instead of using pi.sendMessage(),
	// which appends session messages even with triggerTurn:false.
	process.stderr.write(`\n${content}\n\n`);
};

export const emitVisibleRecord = (pi: ExtensionAPI, record: CheckpointRecord, ctx: ExtensionContext) => {
	pi.appendEntry("self-reflect-checkpoint", record);

	const visible = visibleCheckpointMessage(record);
	// Do not use pi.sendMessage() for checkpoint display: custom messages are session messages,
	// can retrigger agent-end handling, and can perturb provider message ordering.
	emitImmediateText(visible, ctx, record.outcome === "OK" || record.outcome === "NOTE" ? "info" : "warning");
};
