import { describe, test, expect } from "bun:test";
import {
	calcProgressFromCounters,
	acquireLock,
	releaseLock,
	isLocked,
} from "../claude-manager.ts";

describe("calcProgressFromCounters", () => {
	test("starts at 5% minimum", () => {
		const { progress } = calcProgressFromCounters(0, 0, false);
		expect(progress).toBeGreaterThanOrEqual(5);
	});

	test("increases with elapsed time", () => {
		const early = calcProgressFromCounters(2, 0, false);
		const later = calcProgressFromCounters(30, 0, false);
		expect(later.progress).toBeGreaterThan(early.progress);
	});

	test("jumps when hasEdited is true", () => {
		const noEdit = calcProgressFromCounters(10, 2, false);
		const withEdit = calcProgressFromCounters(10, 2, true);
		expect(withEdit.progress).toBeGreaterThan(noEdit.progress);
	});

	test("never exceeds 95", () => {
		const { progress } = calcProgressFromCounters(999, 50, true);
		expect(progress).toBeLessThanOrEqual(95);
	});

	test("provides stage labels", () => {
		const { stage } = calcProgressFromCounters(5, 0, false);
		expect(stage).toBeTruthy();
		expect(typeof stage).toBe("string");
	});
});

describe("operation lock", () => {
	test("acquires and releases", () => {
		expect(isLocked()).toBe(false);
		const acquired = acquireLock("test", () => {});
		expect(acquired).toBe(true);
		expect(isLocked()).toBe(true);
		releaseLock();
		expect(isLocked()).toBe(false);
	});

	test("rejects when already locked", () => {
		acquireLock("test1", () => {});
		const second = acquireLock("test2", () => {});
		expect(second).toBe(false);
		releaseLock();
	});
});
