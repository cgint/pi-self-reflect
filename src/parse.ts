import type { ReflectionResult } from "./types.ts";

export const parseReflection = (rawText: string): ReflectionResult => {
	const raw = rawText.trim();
	if (raw.startsWith("PAUSE_USER:")) {
		const message = raw.slice(raw.indexOf(":") + 1).trim();
		return {
			outcome: "PAUSE_USER",
			reason: message || "Reflection requested user input before continuing.",
			message: message || "User decision needed before continuing.",
			raw,
		};
	}
	if (raw.startsWith("STEER:")) {
		const message = raw.slice(raw.indexOf(":") + 1).trim();
		return {
			outcome: "STEER",
			reason: "Reflection found useful steering for the next step.",
			message: message || "Re-anchor on the goal and choose the smallest verified next step.",
			raw,
		};
	}
	if (raw.startsWith("NOTE:") || raw.startsWith("OK_NOTE:")) {
		const message = raw.slice(raw.indexOf(":") + 1).trim();
		return {
			outcome: "NOTE",
			reason: "Reflection found a non-blocking completion-risk note.",
			message: message || "Keep completion verification and documentation in mind before declaring done.",
			raw,
		};
	}
	if (raw.startsWith("OK:")) {
		const message = raw.slice(raw.indexOf(":") + 1).trim();
		return {
			outcome: "OK",
			reason: message || "Reflection found no intervention needed.",
			message: message || "Continue unchanged.",
			raw,
		};
	}
	return {
		outcome: "MALFORMED",
		reason: "Reflection response did not start with required prefix OK:, NOTE:, STEER:, or PAUSE_USER:.",
		message: raw || "Empty reflection response.",
		raw,
	};
};
