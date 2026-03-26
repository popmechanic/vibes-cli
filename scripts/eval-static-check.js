import { readFileSync, existsSync } from 'fs';

/**
 * Static analysis pre-check for generated Vibes app code.
 * Uses regex matching — no AST parsing.
 *
 * @param {string} codeOrPath - JSX source code string, or path to a .jsx file
 * @returns {{ critical: string[], warnings: string[], passed: boolean }}
 */
export function evalStaticCheck(codeOrPath) {
  const code = (!codeOrPath.includes('\n') && existsSync(codeOrPath))
    ? readFileSync(codeOrPath, 'utf8')
    : codeOrPath;
  const critical = [];
  const warnings = [];

  // C1: Missing useApp()
  if (!code.includes('useApp()')) {
    critical.push('C1: Missing useApp() call — sync will never activate');
  }

  // C2: Import statements
  if (/^\s*import\s/m.test(code)) {
    critical.push('C2: Import statement found — breaks React singleton');
  }

  // C3: Store creation
  if (/create(Mergeable)?Store\s*\(/.test(code)) {
    critical.push('C3: Store creation found — creates disconnected store');
  }

  // C4: Store constructor
  if (/new\s+(Mergeable)?Store\s*\(/.test(code)) {
    critical.push('C4: Store constructor found — creates disconnected store');
  }

  // C5: Hooks in loops — promoted from W1 to critical (guaranteed crash at runtime)
  // Matches .filter/.map/.forEach with arrow function body, then checks only
  // within the balanced braces of that body for hook calls.
  const iterMethods = /\.(filter|map|forEach)\s*\([^)]*=>\s*\{/g;
  let match;
  while ((match = iterMethods.exec(code)) !== null) {
    // Find the opening brace position
    const braceStart = match.index + match[0].length - 1;
    // Count braces to find the matching close
    let depth = 1;
    let pos = braceStart + 1;
    while (pos < code.length && depth > 0) {
      if (code[pos] === '{') depth++;
      else if (code[pos] === '}') depth--;
      pos++;
    }
    // Extract just the loop body
    const loopBody = code.slice(braceStart, pos);
    if (/use(Cell|Row|HasRow|HasCell|Value|RowIds|SortedRowIds|Table|AddRowCallback|SetCellCallback|SetRowCallback|DelRowCallback)\s*\(/.test(loopBody)) {
      critical.push(`C5: Hook call inside .${match[1]}() — crashes when list length changes (React #310)`);
      break;
    }
  }

  // W2: Direct store writes
  if (/store\.(set|del)(Cell|Row|Table|Value|PartialRow)\s*\(/.test(code)) {
    warnings.push('W2: Direct store.set/del call — bypasses React reactivity');
  }

  // W3: JSON in cells
  if (/JSON\.stringify/.test(code) && /useAddRowCallback|useSetCellCallback|useSetRowCallback/.test(code)) {
    warnings.push('W3: JSON.stringify near callback hook — cells must be scalars');
  }

  // W4: Sync status UI
  if (/"(Connected|Online|LIVE|Syncing|Offline|CREW ONLINE)"/.test(code) ||
      /'(Connected|Online|LIVE|Syncing|Offline|CREW ONLINE)'/.test(code)) {
    warnings.push('W4: Sync status string found — template already renders SyncStatusDot');
  }

  // W5: Optional chaining on email
  if (/oidcUser\?\.email|email\?\.(split|toLowerCase)/.test(code)) {
    warnings.push('W5: Optional chaining on email — email is always present in private apps');
  }

  // W6: Anonymous fallback
  if (/\|\|\s*['"`](anonymous|unknown|guest)['"`]/i.test(code)) {
    warnings.push('W6: Anonymous fallback near email — breaks multi-user identity');
  }

  return {
    critical,
    warnings,
    passed: critical.length === 0,
  };
}

// CLI entry point: bun scripts/eval-static-check.js <path.jsx>
if (typeof Bun !== 'undefined' && import.meta.main) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: bun scripts/eval-static-check.js <app.jsx>');
    process.exit(1);
  }
  const result = evalStaticCheck(filePath);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}
