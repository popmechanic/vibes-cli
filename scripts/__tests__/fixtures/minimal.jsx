export default function App() {
  const [count, setCount] = React.useState(0);
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Vibes Test App</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <p style={{ color: "#888" }}>If you see this, template + Babel + import map work.</p>
    </div>
  );
}
