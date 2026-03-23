/**
 * TinyBase Fixture: Multiplayer Chat
 * Tests: useAddRowCallback with user attribution, useSortedRowIds for chronological display,
 *        useRef for auto-scroll, useRowCount for message count,
 *        simulated multi-user pattern (public app without auth).
 * Pattern: Real-time chat room with message history and auto-scroll.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();

  // In a real private app, you'd use useUser() for identity.
  // For this public fixture, simulate with a localStorage-based name.
  const [userName, setUserName] = React.useState(() => {
    return localStorage.getItem('chat_username') || '';
  });

  if (!userName) {
    return <NamePrompt onSetName={(name) => {
      localStorage.setItem('chat_username', name);
      setUserName(name);
    }} />;
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '500px', margin: '0 auto', display: 'flex', flexDirection: 'column', height: '80vh' }}>
      <h1 style={{ margin: '0 0 0.5rem' }}>Chat Room</h1>
      <p style={{ color: '#888', fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Chatting as <strong>{userName}</strong> · {isSyncing ? 'synced' : 'local only'}
      </p>
      <MessageList userName={userName} />
      <MessageInput userName={userName} />
    </div>
  );
}

function NamePrompt({ onSetName }) {
  const [input, setInput] = React.useState('');
  const handleSubmit = () => {
    if (input.trim()) onSetName(input.trim());
  };
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h2>Enter your name</h2>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSubmit()}
        placeholder="Your name..."
        style={{ padding: '0.5rem', fontSize: '1rem' }}
        autoFocus
      />
      <button onClick={handleSubmit} style={{ marginLeft: '0.5rem', padding: '0.5rem 1rem' }}>Join</button>
    </div>
  );
}

function MessageList({ userName }) {
  const messageIds = useSortedRowIds('messages', 'timestamp', false);
  const messagesEndRef = React.useRef(null);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messageIds.length]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', marginBottom: '0.5rem', border: '1px solid #eee', borderRadius: '8px', padding: '0.5rem' }}>
      {messageIds.length === 0 && (
        <p style={{ color: '#888', textAlign: 'center', padding: '2rem' }}>No messages yet. Say hello!</p>
      )}
      {messageIds.map(id => <MessageBubble key={id} id={id} currentUser={userName} />)}
      <div ref={messagesEndRef} />
    </div>
  );
}

function MessageBubble({ id, currentUser }) {
  const text = useCell('messages', id, 'text');
  const sender = useCell('messages', id, 'sender');
  const timestamp = useCell('messages', id, 'timestamp');
  const isMe = sender === currentUser;

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isMe ? 'flex-end' : 'flex-start',
      marginBottom: '0.5rem',
    }}>
      <div style={{
        maxWidth: '70%',
        padding: '0.5rem 0.75rem',
        borderRadius: '12px',
        background: isMe ? '#2563eb' : '#f0f0f0',
        color: isMe ? '#fff' : '#333',
      }}>
        {!isMe && <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.15rem' }}>{String(sender || '?')}</div>}
        <div>{String(text || '')}</div>
        <div style={{ fontSize: '0.65rem', opacity: 0.6, textAlign: 'right', marginTop: '0.15rem' }}>{timeStr}</div>
      </div>
    </div>
  );
}

function MessageInput({ userName }) {
  const [input, setInput] = React.useState('');

  const addMessage = useAddRowCallback(
    'messages',
    (text) => ({
      text,
      sender: userName,
      timestamp: Date.now(),
    }),
    [userName],
  );

  const handleSend = () => {
    if (!input.trim()) return;
    addMessage(input.trim());
    setInput('');
  };

  return (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSend()}
        placeholder="Type a message..."
        style={{ flex: 1, padding: '0.5rem', borderRadius: '20px', border: '1px solid #ddd' }}
      />
      <button onClick={handleSend} style={{ padding: '0.5rem 1rem', borderRadius: '20px' }}>Send</button>
    </div>
  );
}
