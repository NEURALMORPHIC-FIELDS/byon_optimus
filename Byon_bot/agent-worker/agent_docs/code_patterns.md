# Code Patterns - Agent Worker

## Codebase Indexing

### File Scanning
```typescript
async function scanCodebase(rootPath: string): Promise<FileIndex[]> {
  const patterns = ['**/*.ts', '**/*.tsx', '**/*.py', '**/*.js'];
  const ignorePatterns = ['node_modules/**', 'dist/**', '.git/**'];

  return glob(patterns, { ignore: ignorePatterns, cwd: rootPath });
}
```

### AST Parsing (TypeScript)
```typescript
import * as ts from 'typescript';

function extractSymbols(sourceFile: ts.SourceFile): Symbol[] {
  const symbols: Symbol[] = [];

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        type: 'function',
        name: node.name.getText(),
        line: sourceFile.getLineAndCharacterOfPosition(node.pos).line
      });
    }
    // Similar for classes, interfaces, etc.
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}
```

### Embedding Generation
```typescript
async function generateEmbedding(text: string): Promise<number[]> {
  // Use sentence-transformers via Python bridge or API
  const response = await embeddingModel.encode(text);
  return response.embedding;
}
```

## Context Selection

### Semantic Search
```typescript
async function findRelevantFiles(
  query: string,
  topK: number = 5
): Promise<RelevantFile[]> {
  const queryEmbedding = await generateEmbedding(query);

  // Search in FHRSS
  const results = await fhrss.search(queryEmbedding, topK);

  return results.map(r => ({
    path: r.metadata.path,
    relevance: r.score,
    sections: r.metadata.sections
  }));
}
```

### Dependency Resolution
```typescript
function resolveDependencies(
  targetFile: string,
  depth: number = 2
): string[] {
  const deps = new Set<string>();
  const queue = [{ file: targetFile, currentDepth: 0 }];

  while (queue.length > 0) {
    const { file, currentDepth } = queue.shift()!;
    if (currentDepth >= depth) continue;

    const imports = parseImports(file);
    for (const imp of imports) {
      if (!deps.has(imp)) {
        deps.add(imp);
        queue.push({ file: imp, currentDepth: currentDepth + 1 });
      }
    }
  }

  return Array.from(deps);
}
```

### Context Pack Building
```typescript
interface ContextPack {
  primaryFiles: FileContent[];
  dependencies: FileSummary[];
  totalTokens: number;
}

async function buildContextPack(
  task: string,
  maxTokens: number = 50000
): Promise<ContextPack> {
  const relevantFiles = await findRelevantFiles(task);
  const pack: ContextPack = {
    primaryFiles: [],
    dependencies: [],
    totalTokens: 0
  };

  for (const file of relevantFiles) {
    const content = await readFile(file.path);
    const tokens = countTokens(content);

    if (pack.totalTokens + tokens <= maxTokens) {
      pack.primaryFiles.push({ path: file.path, content });
      pack.totalTokens += tokens;

      // Add dependency signatures (not full content)
      const deps = resolveDependencies(file.path, 1);
      for (const dep of deps) {
        const summary = await getFileSummary(dep);
        pack.dependencies.push(summary);
      }
    }
  }

  return pack;
}
```

## Error Handling
```typescript
class WorkerError extends Error {
  constructor(
    message: string,
    public code: 'PARSE_ERROR' | 'INDEX_ERROR' | 'MEMORY_ERROR',
    public recoverable: boolean
  ) {
    super(message);
  }
}

// Usage
try {
  await indexFile(path);
} catch (e) {
  throw new WorkerError(
    `Failed to index ${path}: ${e.message}`,
    'INDEX_ERROR',
    true
  );
}
```
