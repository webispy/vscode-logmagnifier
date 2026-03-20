# Project Guidelines

## Code Style

Follow the rules in `.agent/rules/code-style.md` for every new or modified file.

Key points:
- Imports: node → vscode → constants/models → local services
- Class members: static → events → fields → constructor → public → private → dispose()
- `_` prefix only for EventEmitter backing fields; all other private fields plain camelCase
- Error handling: `catch (e: unknown)` with `e instanceof Error ? e.message : String(e)`
- Logging: always `this.logger`, never `console.log/error`
- No `Map.get()!` non-null assertions — use `?? fallback` or optional chaining

## Commit Messages

Follow the rules in `.agent/rules/commit-style.md` for every commit.

Key points:
- Subject: `<subsystem>: <description>` — max 60 characters, imperative mood
- Body: explain what and why (not how), wrap at 72 characters per line
- Body must not be empty
