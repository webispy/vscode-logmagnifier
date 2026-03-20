---
trigger: always_on
---

# TypeScript Code Style Guide

This project follows strict conventions for consistency. Apply these rules to every new or modified file in `src/`.

## 1. Import Ordering

Group imports in this order, separated by a blank line between groups:

```typescript
// 1) Node.js built-ins
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

// 2) VS Code API
import * as vscode from 'vscode';

// 3) Project constants and models
import { Constants } from '../Constants';
import { FilterGroup, FilterItem } from '../models/Filter';

// 4) Project services, commands, views, utils
import { FilterManager } from '../services/FilterManager';
import { RegexUtils } from '../utils/RegexUtils';
```

- Within each group, sort alphabetically by module path.
- Never mix groups (e.g., do not place a node import after a local import).

## 2. Class Member Ordering

Arrange class members in this fixed order:

```
1. Static readonly constants
2. Static mutable fields
3. EventEmitter fields (with _ prefix)
4. Public readonly event properties
5. Regular private/protected instance fields (no _ prefix)
6. Constructor
7. Public methods (getters first, then actions)
8. Protected methods
9. Private methods
10. dispose() — always last
```

Example skeleton:

```typescript
export class ExampleService implements vscode.Disposable {
    // 1. Static constants
    private static readonly MAX_CACHE_SIZE = 100;

    // 3-4. Events
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    // 5. Instance fields
    private items: Map<string, Item> = new Map();
    private logger: Logger;

    // 6. Constructor
    constructor(logger: Logger) {
        this.logger = logger;
    }

    // 7. Public methods
    public getItems(): Item[] { ... }
    public addItem(item: Item): void { ... }

    // 9. Private methods
    private validate(item: Item): boolean { ... }

    // 10. Dispose
    public dispose(): void {
        this._onDidChange.dispose();
    }
}
```

## 3. Naming Conventions

### Private fields
- **`_` prefix** is reserved exclusively for EventEmitter backing fields.
- All other private fields use plain camelCase — no prefix.

```typescript
// Correct
private _onDidChangeFilters = new vscode.EventEmitter<void>();
private groups: FilterGroup[] = [];
private debounceTimer: NodeJS.Timeout | undefined;

// Wrong
private _groups: FilterGroup[] = [];      // _ is only for EventEmitters
private _debounceTimer: NodeJS.Timeout;   // _ is only for EventEmitters
```

### Methods and variables
- camelCase for methods and local variables.
- PascalCase for classes, interfaces, enums, and type aliases.
- UPPER_SNAKE_CASE only inside `Constants` definitions, not for class-level statics (use `private static readonly camelCase`).

## 4. Error Handling

### Catch block format
Always use `e: unknown` with the standard conversion pattern:

```typescript
try {
    await riskyOperation();
} catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    this.logger.error(`[ServiceName] Operation failed: ${msg}`);
}
```

- Variable name: always `e` (not `err`, `error`, `ex`).
- Always type as `unknown` (never untyped or `any`).
- Use the `e instanceof Error ? e.message : String(e)` pattern consistently.

### User-facing errors
- Use `vscode.window.showErrorMessage()` for failures the user must know about.
- Use `vscode.window.showWarningMessage()` for non-fatal issues with data loss risk.
- Log-only (`this.logger.error()`) for internal recoverable errors.
- Never silently swallow errors in empty catch blocks — at minimum, log.

## 5. Logging

### Always use Logger — never console
```typescript
// Correct
this.logger.info(`[FilterManager] Group added: ${name}`);

// Wrong — never use console in production code
console.log(`Group added: ${name}`);
console.error(`Failed: ${e}`);
```

### Log message format
Use the `[ComponentName]` prefix pattern for traceability:

```typescript
this.logger.info(`[AdbClient] Device connected: ${deviceId}`);
this.logger.warn(`[RunbookService] File not found, skipping: ${path}`);
this.logger.error(`[WorkflowManager] Execution failed: ${msg}`);
```

## 6. Async Patterns

- Prefer `async/await` over `.then()` chains.
- Fire-and-forget async calls must have a `.catch()` handler:

```typescript
// Correct — error is handled
this.flushLogs(sessionId).catch(e =>
    this.logger.error(`[AdbLogcatService] Flush failed: ${e}`)
);

// Wrong — unhandled rejection
this.flushLogs(sessionId);
```

## 7. Dispose Pattern

- Prefer a `disposables: vscode.Disposable[]` array over individual fields.
- Always dispose EventEmitters explicitly.
- `dispose()` is the last method in the class.

```typescript
private disposables: vscode.Disposable[] = [];

constructor() {
    this.disposables.push(
        vscode.workspace.onDidChangeConfiguration(() => this.reload())
    );
}

public dispose(): void {
    this._onDidChange.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
}
```

## 8. Non-null Assertions

**Do not use `Map.get()!` or similar non-null assertions.** Use safe alternatives:

```typescript
// Correct — LRU pattern
const cached = this.cache.get(key);
if (cached) {
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached;
}

// Correct — has() then get() pattern
const items = this.map.get(key) ?? [];

// Correct — optional chaining
parentNode?.children.add(childKey);

// Wrong
const entry = this.cache.get(key)!;
```

## 9. JSDoc

Add JSDoc to:
- All public methods on service classes.
- Complex private methods (3+ parameters or non-obvious logic).
- Utility classes and their public API.

Keep JSDoc concise — one sentence for simple methods, `@param`/`@returns` for complex ones:

```typescript
/** Appends an item, overwriting the oldest entry if the buffer is full. */
push(item: T): void { ... }

/**
 * Pre-compiles filter groups into regex arrays for efficient line matching.
 *
 * @param activeGroups - Filter groups whose enabled filters should be compiled
 * @returns Compiled groups with separate include/exclude regex arrays
 */
public compileGroups(activeGroups: FilterGroup[]): CompiledGroup[] { ... }
```

Do not add JSDoc to:
- Getters/setters with obvious names (`getName()`, `isEnabled()`).
- Event declarations (`onDidChange`).
- Constructor-only parameter assignments.
