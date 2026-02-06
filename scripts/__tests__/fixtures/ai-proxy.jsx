export default function App() {
  const [response, setResponse] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const testAI = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "Say 'AI proxy working' in exactly 3 words" }] })
      });
      setResponse(await res.json());
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>AI Proxy Test</h1>
      <button onClick={testAI} disabled={loading}>{loading ? "Testing..." : "Test AI Proxy"}</button>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {response && <pre>{JSON.stringify(response, null, 2)}</pre>}
    </div>
  );
}
