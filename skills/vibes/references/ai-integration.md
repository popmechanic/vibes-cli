---
name: AI Integration
description: useAI hook — callAI, streamAI, OpenRouter integration, deploying AI-enabled apps, chatbot and content generation patterns
---

# AI Features Integration

Complete guide for adding AI capabilities to Vibes apps via the `useAI` hook.

---

## Detecting AI Requirements

Look for these patterns in the user's prompt:
- "chatbot", "chat with AI", "ask AI"
- "summarize", "generate", "write", "create content"
- "analyze", "classify", "recommend"
- "AI-powered", "intelligent", "smart" (in context of features)

## Collecting OpenRouter Key

When AI is needed, ask the user:

> This app needs AI capabilities. Please provide your OpenRouter API key.
> Get one at: https://openrouter.ai/keys

Store the key for use with the `--ai-key` flag during deployment.

---

## Using the useAI Hook

The `useAI` hook is automatically included in the template when AI features are detected.

**Isolate `useAI()` in a child component** to prevent AI loading/error state changes from re-rendering your data components:

```jsx
// AI interactions in a child component — isolated from data re-renders
function AIChatInput({ onSend }) {
  const { callAI, loading, error } = useAI();
  const [input, setInput] = React.useState("");

  const handleSend = async () => {
    if (!input.trim()) return;
    const message = input;
    setInput("");
    onSend({ role: "user", content: message });

    const aiText = await callAI({
      model: "anthropic/claude-sonnet-4",
      messages: [{ role: "user", content: message }]
    });
    if (aiText) onSend({ role: "assistant", content: aiText });
  };

  return (
    <div>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." />
      <button onClick={handleSend} disabled={loading}>{loading ? "Thinking..." : "Send"}</button>
      {error && <p style={{ color: "red" }}>{error.message}</p>}
    </div>
  );
}

// Main app — TinyBase hooks for data, AI in child component
export default function App() {
  const messageIds = useRowIds('messages');

  const addMessage = useAddRowCallback(
    'messages',
    (msg) => ({ role: msg.role, content: msg.content, timestamp: Date.now() }),
  );

  return (
    <div>
      {messageIds.map(id => <MessageRow key={id} id={id} />)}
      <AIChatInput onSend={addMessage} />
    </div>
  );
}

function MessageRow({ id }) {
  const role = useCell('messages', id, 'role');
  const content = useCell('messages', id, 'content');
  return <p><b>{role}:</b> {content}</p>;
}
```

---

## useAI API

```jsx
const { callAI, streamAI, loading, error, clearError } = useAI();
```

### callAI — Non-Streaming (One-Shot Requests)

```jsx
const text = await callAI({
  model: "anthropic/claude-sonnet-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" }
  ],
});
if (!text) return; // error state set automatically
```

Returns `string` on success, `null` on error (never throws).

### streamAI — Streaming (Chat UIs)

```jsx
const stream = streamAI({
  model: "anthropic/claude-sonnet-4",
  messages: [{ role: "user", content: userMessage }],
});
if (!stream) return; // error state set

let accumulated = "";
for await (const chunk of stream) {
  accumulated += chunk;
  setResponse(accumulated);
}
```

Returns an async iterator on success, `null` on error. App controls its own state.

### OpenRouter Parameters

Pass any [OpenRouter API param](https://openrouter.ai/docs/api/reference/overview) directly:

```jsx
const text = await callAI({
  messages: [...],
  temperature: 0.7,
  max_tokens: 1000,
  response_format: { type: "json_object" },
  tools: [...],
});
```

### raw: true — Full Response Object

For tool calls or usage stats, get the full OpenRouter response object:

```jsx
const response = await callAI({ messages: [...], raw: true });
const toolCalls = response.choices[0].message.tool_calls;
```

### Error Codes

```
error = {
  code: "NOT_CONFIGURED" | "AUTH_REQUIRED" | "UNAUTHORIZED" | "RATE_LIMITED" | "API_ERROR" | "NETWORK_ERROR",
  message: "Human-readable error message"
}
```

---

## Deployment with AI

When deploying AI-enabled apps, include the OpenRouter key:

```bash
VIBES_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(dirname "${CLAUDE_SKILL_DIR}")")}"
bun "$VIBES_ROOT/scripts/deploy-cloudflare.js" \
  --name myapp \
  --file index.html \
  --ai-key "sk-or-v1-your-key"
```
