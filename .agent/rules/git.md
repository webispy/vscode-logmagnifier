---
trigger: always_on
---

# Git Command Guidelines

## Shell Execution

### Use --no-pager
Always use `--no-pager` when executing `git log` or `git diff` commands.
This prevents the command from waiting for interactive user input when the output exceeds the terminal height.

```bash
# Good
git --no-pager log -n 10
git --no-pager diff

# Bad
git log -n 10
git diff
```

### Avoid interactive flags
Do not use `-i` flag (e.g., `git rebase -i`, `git add -i`) as they require interactive input.

## Branching

### Branch naming
Use `<type>/<short-description>` format:
- `feature/timestamp-analysis`
- `fix/filter-tree-crash`
- `refactor/log-processor-pipeline`

### Main branch
The main branch is `main`. Never force-push to `main`.

## Pull Requests

### PR title
- Keep under 70 characters
- Use imperative mood (e.g., "Add timestamp analysis", not "Added timestamp analysis")

### PR description
Use this format:
```markdown
## Summary
<1-3 bullet points describing the change>

## Test plan
- [ ] test steps...
```

### CI requirements
- All PRs must pass `npm test` (tsc + eslint + vscode-test)
- CI runs on Windows (primary) and Ubuntu (packaging)
- Coverage is reported to Codecov
