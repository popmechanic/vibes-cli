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
 */

const MAX_TOOL_RESULT_SIZE = 10 * 1024; // 10KB cap for UI delivery

const DROPPED_TYPES = new Set([
  'hook_started',
  'hook_progress',
  'hook_response',
  'task_notification',
  'task_started',
  'task_progress',
]);

export function translateStreamEvent(event: any): object[] {
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

    // Tool use starting
    if (inner.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
      return [{ type: 'tool_start', name: inner.content_block.name, id: inner.content_block.id }];
    }

    // Input JSON delta — buffer internally, don't send to UI
    if (inner.type === 'content_block_delta' && inner.delta?.type === 'input_json_delta') {
      return [];
    }

    return [];
  }

  if (event.type === 'tool_result') {
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

  // assistant messages with complete content blocks (non-streaming)
  if (event.type === 'assistant' && event.message?.content) {
    const msgs: object[] = [];
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        msgs.push({ type: 'token', text: block.text });
      }
      if (block.type === 'tool_use') {
        msgs.push({ type: 'tool_start', name: block.name, id: block.id ?? null });
      }
    }
    return msgs;
  }

  return [];
}
