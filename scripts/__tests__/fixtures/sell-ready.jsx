export default function App() {
  const { dbName } = useTenant();
  const { database, useLiveQuery, useDocument } = useFireproofClerk(dbName);
  const { doc, merge, submit } = useDocument({ text: "", type: "item", ts: Date.now() });
  const { docs } = useLiveQuery("type", { key: "item" });
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Sell Test App</h1>
      <p style={{ fontSize: "0.8rem", color: "#666" }}>Database: {dbName}</p>
      <form onSubmit={(e) => { merge({ ts: Date.now() }); submit(e); }}>
        <input value={doc.text} onChange={(e) => merge({ text: e.target.value })} placeholder="Add item..." />
        <button type="submit">Add</button>
      </form>
      <ul>{docs.map(d => <li key={d._id}>{d.text}</li>)}</ul>
    </div>
  );
}
