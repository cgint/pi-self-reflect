import { describe, expect, it } from "vitest";
import { parseReflection } from "../src/parse.ts";
import type { ReflectionResult } from "../src/types.ts";

const assertOutcome = (raw: string, expected: "OK" | "NOTE" | "STEER" | "PAUSE_USER" | "MALFORMED"): ReflectionResult => {
	const result = parseReflection(raw);
	expect(result.outcome).toBe(expected);
	return result;
};

describe("parseReflection", () => {
	it("parses bare OK:", () => {
		const r = assertOutcome("OK:", "OK");
		expect(r.message).toBe("Continue unchanged.");
		expect(r.reason).toBe("Reflection found no intervention needed.");
	});

	it("parses OK with message:", () => {
		const r = assertOutcome("OK: Everything looks good.", "OK");
		expect(r.message).toBe("Everything looks good.");
	});

	it("parses NOTE:", () => {
		const r = assertOutcome("NOTE: check logs before deploy.", "NOTE");
		expect(r.message).toBe("check logs before deploy.");
	});

	it("parses OK_NOTE: as NOTE:", () => {
		const r = assertOutcome("OK_NOTE: minor hygiene reminder.", "NOTE");
		expect(r.message).toBe("minor hygiene reminder.");
	});

	it("parses STEER:", () => {
		const r = assertOutcome("STEER: verify the HTTP response code.", "STEER");
		expect(r.message).toBe("verify the HTTP response code.");
	});

	it("parses STEER with empty message:", () => {
		const r = assertOutcome("STEER:", "STEER");
		expect(r.message).toBe("Re-anchor on the goal and choose the smallest verified next step.");
	});

	it("parses PAUSE_USER:", () => {
		const r = assertOutcome("PAUSE_USER: ask the user for option A or B.", "PAUSE_USER");
		expect(r.message).toBe("ask the user for option A or B.");
	});

	it("parses PAUSE_USER with empty message:", () => {
		const r = assertOutcome("PAUSE_USER:", "PAUSE_USER");
		expect(r.message).toBe("User decision needed before continuing.");
	});

	it("classifies text without prefix as MALFORMED:", () => {
		const r = assertOutcome("Just some loose thoughts.", "MALFORMED");
		expect(r.reason).toContain("did not start with required prefix");
	});

	it("classifies empty string as MALFORMED:", () => {
		const r = assertOutcome("", "MALFORMED");
		expect(r.message).toBe("Empty reflection response.");
	});

	it("trims whitespace before parsing:", () => {
		const r = assertOutcome("  OK: trimmed message  ", "OK");
		expect(r.message).toBe("trimmed message");
	});

	it("preserves raw output in result:", () => {
		const r = parseReflection("OK: test");
		expect(r.raw).toBe("OK: test");
	});
});