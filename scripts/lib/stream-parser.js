/**
 * Shared stream-json parser for claude -p subprocess output.
 *
 * Buffers stdout chunks into complete JSON lines, handling:
 * - Lines split across TCP chunks
 * - Multi-byte UTF-8 characters split at chunk boundaries
 * - Malformed JSON (warns, does not throw)
 */

/**
 * @param {function} onEvent - Called with each parsed JSON object
 * @returns {function} Parser function — call with each stdout Buffer/Uint8Array chunk
 */
export function createStreamParser(onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';

  return (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch (err) {
        console.warn('[stream-parser] JSON parse error:', err.message, line.slice(0, 200));
      }
    }
  };
}
