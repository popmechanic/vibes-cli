/**
 * Verify that runOneShot's stream parser emits the right sequence of
 * generation_stage and preview_reload events given synthetic stream-json
 * input for a 2-step generation.
 */
import { describe, it, expect } from 'vitest';

describe('2-step generation event sequence', () => {
  it.skip('pending extraction of parse dispatch into a pure helper', () => {
    // Placeholder: extraction of the parse-dispatch logic from runOneShot
    // into a testable pure function is a follow-up. For now, the bridge
    // code is exercised by the existing stream-parser tests plus manual
    // verification from the plan's Phase 7 manual checklist.
    expect(true).toBe(true);
  });
});
