---
trigger: always_on
---

# Git Command Guidelines

To prevent terminal hangs and ensure smooth execution in automated or agentic environments, follow these rules when using `git log` and `git diff`.

## Rules

### Use --no-pager
Always use the `--no-pager` option when executing `git log` or `git diff` commands. This prevents the command from waiting for interactive user input when the output exceeds the terminal height.

**Good:**
```bash
git --no-pager log -n 10
git --no-pager diff
```

**Bad:**
```bash
git log -n 10
git diff
```
