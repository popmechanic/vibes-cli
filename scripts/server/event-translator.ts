/**
 * Event translator for stream-json bridge.
 *
 * Translates raw stream-json events from Claude CLI into simplified
 * WebSocket messages for the editor UI.
 *
 * Vocabulary:
 *   init        — session started (model, tools, session_id)
 *   token       — text delta (zero-buffered, forwarded immediately)
 *   tool_start  — tool invocation beginning (name, id)
 *   tool_result — tool result, content capped at 10KB
 *   complete    — run finished successfully
 *   error       — run flagged as failed or fatal error
 *   status      — misc state: rate_limited, context_compacted, retrying
 *
 * Per-turn state (tool_input progress tracking) is captured in a closure
 * via `createStreamTranslator()` so each bridge instance gets its own
 * state. The default `translateStreamEvent` export is a singleton kept
 * for tests and existing call sites that don't need isolation.
 */

const MAX_TOOL_RESULT_SIZE = 10 * 1024; // 10KB cap for UI delivery
const PROGRESS_INTERVAL = 1024; // Emit progress every ~1KB of tool input

const DROPPED_TYPES = new Set([
  'hook_started',
  'hook_progress',
  'hook_response',
  'task_notification',
  'task_started',
  'task_progress',
]);

export type StreamTranslator = (event: any) => object[];

/**
 * Create a stateful stream translator. Each bridge instance should
 * call this once and reuse the returned function across its stream
 * events, so per-turn progress tracking is isolated.
 */
export function createStreamTranslator(): StreamTranslator {
  // Accumulated tool input bytes — lets the UI show a progress bar during long Write calls
  let toolInputBytes = 0;
  let lastProgressEmit = 0;
  let currentToolName = '';

  return function translateStreamEvent(event: any): object[] {
    if (DROPPED_TYPES.has(event.type)) return [];

    if (event.type === 'system') {
      if (event.subtype === 'init') {
        return [{ type: 'init', model: event.model, tools: event.tools, session_id: event.session_id }];
      }
      if (event.subtype === 'compact_boundary') {
        return [{ type: 'status', status: 'context_compacted' }];
      }
      if (event.subtype === 'api_retry') {
        return [{ type: 'status', status: 'retrying', attempt: event.attempt }];
      }
      return [];
    }

    if (event.type === 'stream_event') {
      const inner = event.event;
      if (!inner) return [];

      // Text delta — forward immediately
      if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
        return [{ type: 'token', text: inner.delta.text }];
      }

      // Tool use starting — reset progress tracking
      if (inner.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
        currentToolName = inner.content_block.name;
        toolInputBytes = 0;
        lastProgressEmit = 0;
        return [{ type: 'tool_start', name: inner.content_block.name, id: inner.content_block.id }];
      }

      // Input JSON delta — accumulate bytes, emit periodic progress for Write/Edit tools
      if (inner.type === 'content_block_delta' && inner.delta?.type === 'input_json_delta') {
        toolInputBytes += (inner.delta.partial_json || '').length;
        if (currentToolName === 'Write' || currentToolName === 'Edit') {
          if (toolInputBytes - lastProgressEmit >= PROGRESS_INTERVAL) {
            lastProgressEmit = toolInputBytes;
            const kb = (toolInputBytes / 1024).toFixed(1);
            // Asymptotic curve: grows visibly for typical apps (5-20KB), never hits 100%
            const progress = Math.min(95, Math.round(100 * (1 - Math.exp(-toolInputBytes / 15000))));
            return [{ type: 'status', progress, stage: `Writing code\u2026 ${kb} KB` }];
          }
        }
        return [];
      }

      return [];
    }

    if (event.type === 'tool_result') {
      // Reset progress tracking
      currentToolName = '';
      toolInputBytes = 0;
      lastProgressEmit = 0;
      const raw = typeof event.content === 'string' ? event.content : JSON.stringify(event.content || '');
      const truncated = raw.length > MAX_TOOL_RESULT_SIZE;
      return [{
        type: 'tool_result',
        name: event.tool_name || '',
        content: truncated ? raw.slice(0, MAX_TOOL_RESULT_SIZE) : raw,
        is_error: !!event.is_error,
        truncated,
      }];
    }

    if (event.type === 'result') {
      if (event.is_error) {
        return [{ type: 'error', message: event.result || 'Claude flagged the run as failed' }];
      }
      return [{
        type: 'complete',
        result: event.result || '',
        usage: event.usage || null,
        cost: event.total_cost_usd || null,
        duration: event.duration_ms || null,
      }];
    }

    if (event.type === 'rate_limit_event') {
      return [{ type: 'status', status: 'rate_limited' }];
    }

    // assistant messages with complete content blocks — drop when streaming is active
    // (with --include-partial-messages, text arrives via stream_event text_delta AND
    // again as complete assistant blocks, causing duplication)
    if (event.type === 'assistant') {
      return [];
    }

    return [];
  };
}

/**
 * Default singleton translator. Retained so tests and any caller that
 * doesn't need per-instance state continue to work. Callers that care
 * about isolation between turns (e.g. the persistent bridge, which runs
 * many turns in its lifetime) should call `createStreamTranslator()`.
 */
export const translateStreamEvent: StreamTranslator = createStreamTranslator();
