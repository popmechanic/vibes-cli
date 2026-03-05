/**
 * Claude subprocess bridge — callback-based, decoupled from WebSocket.
 *
 * runClaude accepts an onEvent callback instead of a ws reference,
 * making it testable without mocks.
 */

import { spawn } from 'child_process';
import { buildClaudeArgs, cleanEnv } from '../lib/claude-subprocess.js';
import { createStreamParser } from '../lib/stream-parser.js';

let activeClaude = null;

/**
 * Event contract:
 *   { type: 'progress', progress, stage, elapsed }
 *   { type: 'token', text }
 *   { type: 'tool_detail', name, input_summary, elapsed }
 *   { type: 'tool_result', name, content, is_error, elapsed }
 *   { type: 'error', message }
 *   { type: 'complete', text, toolsUsed, elapsed, hasEdited }
 *   { type: 'cancelled' }
 */

/**
 * Run a Claude subprocess with streaming output.
 * @param {string} prompt - Prompt text (piped via stdin)
 * @param {object} opts - { maxTurns, model, skipChat }
 * @param {function} onEvent - Callback for status/error/complete events
 * @returns {Promise<string|null>} Result text or null on failure
 */
export async function runClaude(prompt, opts = {}, onEvent) {
  if (activeClaude) {
    onEvent({ type: 'error', message: 'Another request is in progress. Please wait.' });
    return null;
  }

  onEvent({ type: 'progress', progress: 0, stage: 'Starting Claude...', elapsed: 0 });

  return new Promise((resolve) => {
    const args = buildClaudeArgs({
      outputFormat: 'stream-json',
      maxTurns: opts.maxTurns,
      model: opts.model,
      tools: opts.tools,
    });

    console.log(`[Claude] Spawning (prompt: ${(prompt.length / 1024).toFixed(1)}KB)...`);
    const child = spawn('claude', args, {
      cwd: opts.cwd || process.cwd(),
      env: cleanEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeClaude = child;

    child.stdin.write(prompt);
    child.stdin.end();

    let stderr = '';
    let resultText = '';
    let toolsUsed = 0;
    let hasEdited = false;
    let hitRateLimit = false;
    let errorSent = false;
    const startTime = Date.now();

    function getElapsed() {
      return Math.round((Date.now() - startTime) / 1000);
    }

    let baseProgress = 0;

    function calcProgress() {
      const elapsed = getElapsed();
      const timePct = Math.round(80 * (1 - Math.exp(-elapsed / 40)));
      const toolPct = hasEdited ? 85 : toolsUsed >= 3 ? 75 : toolsUsed >= 1 ? 50 : 0;
      baseProgress = Math.max(baseProgress, timePct, toolPct);
      const progress = Math.min(baseProgress, 95);

      const stage = hasEdited ? 'Finishing up...' :
                    toolsUsed >= 3 ? 'Writing changes...' :
                    toolsUsed >= 1 ? 'Reading & analyzing...' :
                    elapsed > 10 ? 'Thinking about design...' :
                    elapsed > 3 ? 'Loading context...' : 'Starting Claude...';

      return { progress, stage };
    }

    function sendProgress(overrides) {
      const { progress, stage } = calcProgress();
      onEvent({ type: 'progress', progress, stage, elapsed: getElapsed(), ...overrides });
    }

    const parse = createStreamParser((event) => {
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            toolsUsed++;
            const toolName = block.name || '';
            if (toolName === 'Edit' || toolName === 'Write') hasEdited = true;

            const input = block.input || {};
            const inputSummary =
              (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') ? (input.file_path || '') :
              (toolName === 'Glob') ? (input.pattern || '') :
              (toolName === 'Grep') ? (input.pattern || '') :
              (toolName === 'Bash') ? (input.command || '').slice(0, 80) :
              '';

            const toolLabel = toolName === 'Read' ? 'Reading files...' :
                              toolName === 'Glob' ? 'Searching files...' :
                              toolName === 'Grep' ? 'Searching code...' :
                              toolName === 'Edit' ? 'Editing app.jsx...' :
                              toolName === 'Write' ? 'Writing app.jsx...' : null;

            const elapsed = getElapsed();
            sendProgress(toolLabel ? { stage: toolLabel } : {});
            console.log(`[Claude] Tool: ${toolName}${inputSummary ? ` → ${inputSummary}` : ''} (${elapsed}s)`);

            onEvent({ type: 'tool_detail', name: toolName, input_summary: inputSummary, elapsed });
          }
          if (block.type === 'text' && block.text) {
            resultText = block.text;
            onEvent({ type: 'token', text: block.text });
          }
        }
      } else if (event.type === 'stream_event' && event.event?.delta?.text) {
        onEvent({ type: 'token', text: event.event.delta.text });
      } else if (event.type === 'tool_result') {
        const content = typeof event.content === 'string'
          ? event.content.slice(0, 500)
          : JSON.stringify(event.content || '').slice(0, 500);
        onEvent({
          type: 'tool_result',
          name: event.tool_name || '',
          content,
          is_error: !!event.is_error,
          elapsed: getElapsed(),
        });
      } else if (event.type === 'result') {
        if (event.is_error) {
          const errMsg = event.result || 'Claude flagged the run as failed';
          console.error(`[Claude] Result is_error: ${errMsg}`);
          onEvent({ type: 'error', message: errMsg });
          errorSent = true;
        } else {
          resultText = event.result || resultText || 'Done.';
        }
      } else {
        if (event.type === 'rate_limit_event') {
          hitRateLimit = true;
          sendProgress({ stage: 'Rate limited, waiting...' });
        }
        console.log(`[Claude] Event: ${event.type} (${getElapsed()}s)`);
      }
    });

    child.stdout.on('data', parse);

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const progressInterval = setInterval(() => {
      if (!activeClaude) return;
      sendProgress();
    }, 1000);

    child.on('close', (code) => {
      clearInterval(progressInterval);
      const wasActive = activeClaude === child;
      activeClaude = null;

      if (!wasActive) { resolve(null); return; }

      if (code !== 0 || code === null) {
        console.error(`[Claude] Exit code ${code}, stderr (${stderr.length} bytes):\n${stderr}`);

        if (code === null) {
          const elapsed = getElapsed();
          onEvent({ type: 'error', message: `Claude process was interrupted after ${elapsed}s. Try again.` });
          resolve(null);
          return;
        }

        const isMaxTurns = stderr.includes('max_turns') || stderr.includes('maxTurns');
        if (isMaxTurns) {
          console.log(`[Claude] Hit max_turns (hasEdited=${hasEdited}) — treating as success`);
          onEvent({ type: 'complete', text: resultText || 'Done.', toolsUsed, elapsed: getElapsed(), hasEdited, skipChat: opts.skipChat });
          resolve(resultText);
          return;
        }
        const errMsg = stderr.slice(0, 500) || `Claude exited with code ${code}`;
        onEvent({ type: 'error', message: errMsg });
        resolve(null);
        return;
      }

      console.log(`[Claude] Completed in ${getElapsed()}s (${toolsUsed} tools used)`);
      if (stderr.trim()) {
        console.log(`[Claude] stderr (${stderr.length} bytes, truncated):\n${stderr.slice(0, 1000)}`);
      }

      if (!errorSent) {
        onEvent({ type: 'complete', text: resultText || 'Done.', toolsUsed, elapsed: getElapsed(), hasEdited, skipChat: opts.skipChat });
      }
      resolve(resultText);
    });

    child.on('error', (err) => {
      clearInterval(progressInterval);
      activeClaude = null;
      console.error('[Claude] Spawn error:', err.message);
      onEvent({ type: 'error', message: `Failed to start claude: ${err.message}` });
      resolve(null);
    });
  });
}

/**
 * Cancel the active Claude process.
 * @returns {boolean} true if a process was cancelled
 */
export function cancelClaude() {
  if (!activeClaude) return false;
  console.log('[Claude] Cancelled by user');
  activeClaude.kill('SIGTERM');
  activeClaude = null;
  return true;
}

/**
 * Create an onEvent callback that forwards events to a WebSocket.
 * Translates internal event types to the client-facing message format.
 */
export function wsAdapter(ws) {
  return (event) => {
    try {
      if (event.type === 'progress') {
        ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: event.progress, stage: event.stage, elapsed: event.elapsed }));
      } else if (event.type === 'complete') {
        ws.send(JSON.stringify({ type: 'status', status: 'thinking', progress: 100, stage: 'Done!', elapsed: event.elapsed }));
        if (!event.skipChat) {
          ws.send(JSON.stringify({ type: 'chat', role: 'assistant', content: event.text }));
        }
        ws.send(JSON.stringify({ type: 'app_updated' }));
      } else if (event.type === 'token') {
        ws.send(JSON.stringify({ type: 'token', text: event.text }));
      } else if (event.type === 'tool_detail') {
        ws.send(JSON.stringify(event));
      } else if (event.type === 'tool_result') {
        ws.send(JSON.stringify({ type: 'tool_result', name: event.name, content: event.content, is_error: event.is_error }));
      } else if (event.type === 'cancelled') {
        ws.send(JSON.stringify({ type: 'cancelled' }));
      } else if (event.type === 'error') {
        ws.send(JSON.stringify(event));
      } else {
        // Forward any other event types as-is
        ws.send(JSON.stringify(event));
      }
    } catch {
      // ws may be closed
    }
  };
}
