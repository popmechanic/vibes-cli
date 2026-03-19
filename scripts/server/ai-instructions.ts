/**
 * Shared AI feature instructions for Claude prompts.
 *
 * Used by both chat.ts (iterative edits) and generate.ts (new app generation).
 */

/** Compact AI instructions for chat context (appended to edit prompts). */
export const AI_INSTRUCTIONS_CHAT = `\n\nAI FEATURES — the useAI hook is available as a global (NO import needed):

\`\`\`jsx
// Non-streaming:
const { callAI, loading, error } = useAI();
const response = await callAI({
  model: "anthropic/claude-sonnet-4",
  messages: [{ role: "user", content: userMessage }]
});
const aiText = response.choices[0].message.content;

// Streaming (for chat UIs):
const { ask, answer, loading, error } = useAI();
ask({ model: "anthropic/claude-sonnet-4", messages: [{ role: "user", content: userMessage }] });
// answer updates reactively as tokens stream in
\`\`\`

Rules: useAI() at component top level, callAI() is async, ask() is fire-and-forget.
Use Fireproof to persist conversations. Show loading state. Handle errors.
Do NOT use fetch() for AI calls — always useAI(). Do NOT simulate AI responses.`;

/** Detailed AI instructions for generation context (new apps). */
export const AI_INSTRUCTIONS_GENERATE = `
=== AI FEATURES ===

This app needs AI capabilities. Use the global \`useAI\` hook (available as window.useAI — NO import needed).

\`\`\`jsx
// Non-streaming (simple request/response):
const { callAI, loading, error } = useAI();

const response = await callAI({
  model: "anthropic/claude-sonnet-4",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: userMessage }
  ],
  temperature: 0.7,
  max_tokens: 1000
});
const aiText = response.choices[0].message.content;

// Streaming (for chat UIs — shows tokens as they arrive):
const { ask, answer, loading, error } = useAI();

// ask() starts streaming; answer updates reactively
ask({
  model: "anthropic/claude-sonnet-4",
  messages: [{ role: "user", content: userMessage }]
});
// Render: <div>{answer}</div>  — updates live as tokens stream in

// Error handling:
if (error?.code === 'LIMIT_EXCEEDED') { /* show upgrade message */ }
if (error?.code === 'API_ERROR') { /* show retry button */ }
\`\`\`

RULES for AI features:
- useAI() is a React hook — call it at the top of your component (not inside callbacks)
- callAI() is async — await it. ask() is fire-and-forget (answer updates reactively)
- Prefer streaming (ask/answer) for chat interfaces, callAI for one-shot operations
- Use Fireproof to persist AI conversations: save user messages and AI responses to the database
- Show a loading indicator while \`loading\` is true
- Handle errors gracefully — show user-friendly messages, not raw error objects
- Do NOT use fetch() to call AI APIs directly — always use useAI()
- Do NOT simulate or hardcode AI responses — use the real API via useAI()
`;
