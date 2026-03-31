---
trigger: always_on
---

# Design Documents Guidelines

Feature design and UI scenario documents live in `.agent/designs/` (gitignored).

## Creating Design Docs

1. When planning a new feature or significant change, create design docs:
   - `<feature-name>.md` — feature spec (goals, data models, service APIs, settings)
   - `<feature-name>-walkthrough.md` — step-by-step UI scenarios with ASCII art

## Walkthrough Requirements

2. Walkthrough docs should include:
   - Each user action and resulting UI state as ASCII art
   - Implementation notes per step (which service/method/API to call)
   - Phase-to-UI mapping (which phase delivers which visible behavior)

## Index

3. Keep `.agent/designs/INDEX.md` updated — one line per design with summary.
   - Format: `- [filename.md] — one-line description`
   - Group related docs together (e.g., spec + walkthrough for same feature)

## Cross-referencing

4. Plan files in `.agent/plans/` must reference related design docs at the top:
   ```
   > Design: `.agent/designs/<feature-name>.md`
   > Walkthrough: `.agent/designs/<feature-name>-walkthrough.md`
   ```

## Usage

5. Reference these docs during implementation, bug fixes, and refactoring to verify intended behavior.

## Maintenance

6. Keep docs updated as design decisions change during implementation.
7. When a feature is fully shipped, archive or delete outdated design docs.
