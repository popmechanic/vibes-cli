/**
 * TinyBase Fixture: Form Editing Patterns
 * Tests: Two approaches — live editing (useCellState) vs draft-then-save (useState + useSetPartialRowCallback).
 * Pattern: Contacts list with inline live editing and a modal form for creating new entries.
 * Demonstrates when to use each approach.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const [showForm, setShowForm] = React.useState(false);
  const count = useRowCount('contacts');

  const addContact = useAddRowCallback(
    'contacts',
    (data) => ({
      name: data.name,
      email: data.email,
      phone: data.phone || '',
      notes: data.notes || '',
      createdAt: Date.now(),
    }),
    [],
  );

  const seedDemo = () => {
    addContact({ name: 'Alice Chen', email: 'alice@example.com', phone: '555-0101' });
    addContact({ name: 'Bob Smith', email: 'bob@example.com', notes: 'Met at conference' });
    addContact({ name: 'Carol Davis', email: 'carol@example.com', phone: '555-0303' });
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Form Editing Test</h1>
      {count === 0 ? (
        <button onClick={seedDemo}>Load Demo Data</button>
      ) : (
        <>
          <button onClick={() => setShowForm(true)} style={{ marginBottom: '1rem' }}>
            + New Contact
          </button>
          {showForm && (
            <NewContactForm
              onSave={(data) => { addContact(data); setShowForm(false); }}
              onCancel={() => setShowForm(false)}
            />
          )}
          <ContactList />
        </>
      )}
    </div>
  );
}

/**
 * Draft-then-save pattern: buffer input in useState, write to TinyBase only on submit.
 * Use this when: the user might want to cancel, or when you want to validate before saving.
 */
function NewContactForm({ onSave, onCancel }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    onSave({ name: name.trim(), email: email.trim(), phone: phone.trim() });
  };

  return (
    <form onSubmit={handleSubmit} style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem', borderRadius: '4px' }}>
      <h3 style={{ margin: '0 0 0.5rem' }}>New Contact</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name *" />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email *" type="email" />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit">Save</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </form>
  );
}

function ContactList() {
  const ids = useRowIds('contacts');
  return (
    <div>
      {ids.map(id => <ContactCard key={id} id={id} />)}
    </div>
  );
}

/**
 * Live editing pattern: useCellState writes to TinyBase on every keystroke.
 * Use this when: changes should be visible to other users immediately,
 * or when there's no concept of "saving" (collaborative editing).
 */
function ContactCard({ id }) {
  const [name, setName] = useCellState('contacts', id, 'name');
  const email = useCell('contacts', id, 'email');
  const [phone, setPhone] = useCellState('contacts', id, 'phone');
  const [notes, setNotes] = useCellState('contacts', id, 'notes');
  const deleteContact = useDelRowCallback('contacts', id);

  return (
    <div style={{ border: '1px solid #eee', padding: '0.75rem', marginBottom: '0.5rem', borderRadius: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <input
          value={String(name || '')}
          onChange={e => setName(e.target.value)}
          style={{ fontWeight: 'bold', border: 'none', fontSize: '1rem', flex: 1, background: 'transparent' }}
        />
        <button onClick={deleteContact} style={{ color: 'red', border: 'none', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ color: '#666', fontSize: '0.85rem' }}>{String(email || '')}</div>
      <input
        value={String(phone || '')}
        onChange={e => setPhone(e.target.value)}
        placeholder="Phone"
        style={{ border: 'none', borderBottom: '1px solid #eee', width: '100%', padding: '0.25rem 0', marginTop: '0.25rem', background: 'transparent' }}
      />
      <textarea
        value={String(notes || '')}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes..."
        rows={2}
        style={{ border: 'none', borderBottom: '1px solid #eee', width: '100%', padding: '0.25rem 0', marginTop: '0.25rem', resize: 'vertical', background: 'transparent' }}
      />
    </div>
  );
}
