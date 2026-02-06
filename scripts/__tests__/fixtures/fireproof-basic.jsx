export default function App() {
  const { database, useLiveQuery, useDocument } = useFireproofClerk("test-db");
  const { doc, merge, submit } = useDocument({ text: "", type: "note", ts: Date.now() });
  const { docs } = useLiveQuery("type", { key: "note" });
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>Fireproof Test</h1>
      <form onSubmit={(e) => { merge({ ts: Date.now() }); submit(e); }}>
        <input value={doc.text} onChange={(e) => merge({ text: e.target.value })} placeholder="Type..." />
        <button type="submit">Save</button>
      </form>
      <ul>{docs.map(d => <li key={d._id}>{d.text} <button onClick={() => database.del(d._id)}>x</button></li>)}</ul>
      <p style={{ color: "#888" }}>{docs.length} doc(s). No console errors = React singleton OK.</p>
    </div>
  );
}
