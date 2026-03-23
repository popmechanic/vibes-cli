/**
 * TinyBase Fixture: Master-Detail Navigation
 * Tests: useState for view routing, useHasRow for safe detail views,
 *        useSetPartialRowCallback for editing, back navigation.
 * Pattern: Recipe book — list view with clickable items → detail view with editing.
 */
export default function App() {
  const { isReady, isSyncing } = useApp();
  const [selectedId, setSelectedId] = React.useState(null);
  const count = useRowCount('recipes');

  const addRecipe = useAddRowCallback(
    'recipes',
    (item) => item,
    [],
  );

  const seedDemo = () => {
    addRecipe({ title: 'Pasta Carbonara', time: 25, servings: 4, ingredients: 'pasta, eggs, bacon, parmesan', instructions: 'Cook pasta. Fry bacon. Mix eggs and cheese. Combine.', createdAt: Date.now() });
    addRecipe({ title: 'Avocado Toast', time: 5, servings: 1, ingredients: 'bread, avocado, salt, lemon', instructions: 'Toast bread. Mash avocado with salt and lemon. Spread.', createdAt: Date.now() });
    addRecipe({ title: 'Chicken Stir Fry', time: 20, servings: 3, ingredients: 'chicken, vegetables, soy sauce, rice', instructions: 'Cut chicken. Stir fry with vegetables. Add sauce. Serve over rice.', createdAt: Date.now() });
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Recipe Book</h1>
      {count === 0 ? (
        <button onClick={seedDemo}>Load Demo Recipes</button>
      ) : selectedId ? (
        <RecipeDetail id={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <RecipeList onSelect={setSelectedId} />
      )}
    </div>
  );
}

function RecipeList({ onSelect }) {
  const ids = useSortedRowIds('recipes', 'createdAt', true);
  return (
    <div>
      {ids.map(id => <RecipeCard key={id} id={id} onClick={() => onSelect(id)} />)}
    </div>
  );
}

function RecipeCard({ id, onClick }) {
  const title = useCell('recipes', id, 'title');
  const time = useCell('recipes', id, 'time');
  const servings = useCell('recipes', id, 'servings');

  return (
    <div
      onClick={onClick}
      style={{
        padding: '1rem', marginBottom: '0.5rem', border: '1px solid #eee',
        borderRadius: '8px', cursor: 'pointer',
      }}
    >
      <h3 style={{ margin: '0 0 0.25rem' }}>{String(title || '')}</h3>
      <div style={{ color: '#888', fontSize: '0.85rem' }}>
        {String(time || '?')} min · {String(servings || '?')} servings
      </div>
    </div>
  );
}

function RecipeDetail({ id, onBack }) {
  // Safety check: the recipe might have been deleted by another user
  const exists = useHasRow('recipes', id);
  if (!exists) {
    return (
      <div>
        <p>This recipe was deleted.</p>
        <button onClick={onBack}>← Back to recipes</button>
      </div>
    );
  }
  return <RecipeEditor id={id} onBack={onBack} />;
}

function RecipeEditor({ id, onBack }) {
  const [title, setTitle] = useCellState('recipes', id, 'title');
  const [time, setTime] = useCellState('recipes', id, 'time');
  const [servings, setServings] = useCellState('recipes', id, 'servings');
  const [ingredients, setIngredients] = useCellState('recipes', id, 'ingredients');
  const [instructions, setInstructions] = useCellState('recipes', id, 'instructions');
  const deleteRecipe = useDelRowCallback('recipes', id);

  const handleDelete = () => {
    deleteRecipe();
    onBack();
  };

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: '1rem' }}>← Back</button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <input
          value={String(title || '')}
          onChange={e => setTitle(e.target.value)}
          style={{ fontSize: '1.5rem', fontWeight: 'bold', border: 'none', borderBottom: '2px solid #eee', padding: '0.25rem 0' }}
          placeholder="Recipe name"
        />
        <div style={{ display: 'flex', gap: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Time:
            <input
              type="number"
              value={String(time || '')}
              onChange={e => setTime(Number(e.target.value) || 0)}
              style={{ width: '60px', padding: '0.25rem' }}
            /> min
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Servings:
            <input
              type="number"
              value={String(servings || '')}
              onChange={e => setServings(Number(e.target.value) || 0)}
              style={{ width: '60px', padding: '0.25rem' }}
            />
          </label>
        </div>
        <div>
          <h3 style={{ margin: '0 0 0.25rem' }}>Ingredients</h3>
          <textarea
            value={String(ingredients || '')}
            onChange={e => setIngredients(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '0.5rem' }}
            placeholder="comma-separated ingredients"
          />
        </div>
        <div>
          <h3 style={{ margin: '0 0 0.25rem' }}>Instructions</h3>
          <textarea
            value={String(instructions || '')}
            onChange={e => setInstructions(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '0.5rem' }}
            placeholder="Step-by-step instructions"
          />
        </div>
        <button onClick={handleDelete} style={{ color: 'red', alignSelf: 'flex-start', marginTop: '1rem' }}>
          Delete Recipe
        </button>
      </div>
    </div>
  );
}
