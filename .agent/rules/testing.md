---
trigger: always_on
---

# Testing Guidelines

## Framework

- **Test runner**: VS Code Test CLI (`@vscode/test-cli`, `@vscode/test-electron`)
- **Framework**: Mocha
- **Assertions**: Node.js built-in `assert` module (`assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`)

## File Structure

Tests mirror the source structure under `src/test/`:

```
src/test/
├── services/       ← service layer tests
├── commands/       ← command handler tests
├── views/          ← UI component tests
└── utils/          ← utility tests
```

### Naming convention
- `<SourceFileName>.test.ts` (e.g., `LogProcessor.test.ts` for `LogProcessor.ts`)
- Place in the matching subdirectory (e.g., `src/test/services/` for `src/services/`)

## Test Structure

### Suite and test format
Use `suite()` and `test()` (Mocha TDD style), not `describe()` / `it()`:

```typescript
suite('FilterManager Test Suite', () => {
    let service: FilterManager;

    setup(() => {
        service = new FilterManager(/* ... */);
    });

    suite('addGroup', () => {
        test('Should add a new filter group', () => {
            service.addGroup('test');
            assert.strictEqual(service.getGroups().length, 1);
        });
    });
});
```

### Naming
- Suite: `'<ClassName> Test Suite'`
- Nested suite: `'<methodName>'` for logical grouping
- Test: `'Should <expected behavior>'`

## Patterns

### Setup/teardown
- Use `setup()` hooks for per-test initialization
- Instantiate services fresh in `setup()` for test isolation

### Mocking
- Manual object construction for complex types (no external mocking library)
- `RegexUtils.create()` for regex test fixtures
- Create minimal stub objects that satisfy the interface

### Assertions
- `assert.strictEqual()` for value comparison
- `assert.deepStrictEqual()` for object/array comparison
- `assert.ok()` for boolean checks
- `assert.throws()` for error cases

## Rules

### When to write tests
- New public service methods must have corresponding tests
- Bug fixes should include a regression test
- Refactoring should not remove existing tests without replacement

### Running tests
- `npm test` runs the full pipeline: `tsc` + `eslint` + `vscode-test`
- Tests run on Windows (CI primary) and Ubuntu (packaging)
- Coverage is reported via lcov to Codecov
