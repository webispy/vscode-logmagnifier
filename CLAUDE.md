# Project Guidelines

## Project Structure

```
.agent/
├── rules/        (committed) — code style, build, test, git, workflow rules
├── plans/        (gitignored) — task progress tracking with INDEX.md
└── designs/      (gitignored) — feature design specs and UI walkthroughs with INDEX.md
```

## Code Style

Follow the rules in `.agent/rules/code-style.md` for every new or modified file.

Key points:
- Imports: node → vscode → constants/models → local services
- Class members: static → events → fields → constructor → public → private → dispose()
- `_` prefix only for EventEmitter backing fields; all other private fields plain camelCase
- Error handling: `catch (e: unknown)` with `e instanceof Error ? e.message : String(e)`
- Logging: always `this.logger`, never `console.log/error`
- No `Map.get()!` non-null assertions — use `?? fallback` or optional chaining

## Build & Test

Follow the rules in `.agent/rules/build-test.md` for build and test workflows.

Key points:
- Dev build: `tsc` → `out/`, Production build: `esbuild` → `dist/`
- `npm test` runs `tsc` + `eslint` + `vscode-test`
- Never change `"main"` in `package.json` to `./dist/extension.js` permanently
- Always verify with `rm -rf out/ dist/ && npm test` before considering work done

## Testing

Follow the rules in `.agent/rules/testing.md` for writing tests.

Key points:
- Tests in `src/test/`, mirroring source structure, named `*.test.ts`
- Mocha TDD style: `suite()` / `test()` / `setup()`, not `describe()` / `it()`
- Assertions: Node.js `assert` module (`strictEqual`, `deepStrictEqual`, `ok`)
- New public methods need tests; bug fixes need regression tests

## Git

Follow the rules in `.agent/rules/git.md` for git commands and PR workflows.

Key points:
- Always use `--no-pager` for `git log` and `git diff`
- No interactive flags (`-i`), no force-push to `main`
- Branch naming: `<type>/<short-description>`
- PR title under 70 characters, imperative mood

## Commit Messages

Follow the rules in `.agent/rules/commit-style.md` for every commit.

Key points:
- Subject: `<subsystem>: <description>` — max 60 characters, imperative mood
- Body: explain what and why (not how), wrap at 72 characters per line
- Body must not be empty

## Code Review

Follow the rules in `.agent/rules/code-review.md` when performing full codebase reviews.

Key points:
- Review focus: rules compliance, structure, quality, security, performance, error handling, dependencies
- Classify findings by severity: Critical / Major / Minor / Info
- Save reports to `reports/` (gitignored), named `<model>_review_<version>_v<iteration>.md`

## Work Plans

Follow the rules in `.agent/rules/work-plans.md` for task tracking.

Key points:
- Create plan files in `.agent/plans/` before starting non-trivial tasks
- Each step 완료 시 즉시 체크박스 갱신, decisions/blockers 기록, INDEX.md 상태 반영
- Keep `.agent/plans/INDEX.md` updated with one-line status per plan
- On session start, read only `INDEX.md` first
- Link related design docs at the top of each plan file

## Design Documents

Follow the rules in `.agent/rules/design-docs.md` for feature design.

Key points:
- Design and walkthrough docs live in `.agent/designs/` (gitignored)
- Keep `.agent/designs/INDEX.md` updated with one-line summary per design
- Walkthroughs include ASCII art UI states and implementation notes per step
- Reference during implementation, bug fixes, and refactoring
