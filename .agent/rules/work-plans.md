---
trigger: always_on
---

# Work Plans Guidelines

When starting a non-trivial task (multi-step implementation, refactoring, etc.):

## Creating Plans

1. Create a plan file in `.agent/plans/` before writing code.
   - Filename: `YYYY-MM-DD-<short-topic>.md` (e.g., `2026-03-31-add-filter-panel.md`)
   - Link related design docs at the top of the plan file.

## Plan File Template

```markdown
# <Feature/Task Name>

> Design: `.agent/designs/<feature-name>.md`
> Walkthrough: `.agent/designs/<feature-name>-walkthrough.md`
> Created: YYYY-MM-DD
> Status: Not started | In progress | Done

## Goal

One-paragraph description of what this task achieves and why.

## Steps

### Phase/Section 1: <name>
- [ ] Step description
- [ ] Step description

### Phase/Section 2: <name>
- [ ] Step description

## New Files
- `src/path/to/NewFile.ts` — brief purpose

## Modified Files
- `src/path/to/Existing.ts` — what changes

## Decisions
- (Record design decisions made during implementation)

## Blockers
- (Record anything blocking progress)
```

## Updating Plans

2. Update the plan as you complete each step — check off items, note any deviations.
3. Record design decisions and blockers as they arise.

## Index Management

4. Keep `.agent/plans/INDEX.md` updated — one line per plan with status and summary.
   - Format: `- [filename.md] STATUS — one-line summary, current step`
   - STATUS: 🔧 IN PROGRESS | ✅ DONE | ⏸️ BLOCKED

## Session Start

5. On session start, read only `INDEX.md` first. Open individual plan files only when relevant to the current request.

## Completion

6. When a task is fully done, mark ✅ DONE in INDEX.md and delete the plan file.

This ensures continuity when a session is interrupted and resumed later.
