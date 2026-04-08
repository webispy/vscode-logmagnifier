---
trigger: always_on
---

# Code Review Guidelines

This document defines the rules for performing full codebase reviews.
When a code review is requested, follow these guidelines automatically.

## Project Context: LogMagnifier

**LogMagnifier** is a VS Code extension for advanced log analysis.

- **Core Purpose**: Advanced log filtering and multi-stage highlighting to simplify complex log analysis.
- **Key Features**:
    - **Filter Groups**: Include/Exclude logic with organization into groups.
    - **Highlighting**: 3-stage highlighting (Word, Line, Full Line) with custom color presets.
    - **ADB Logcat**: Direct integration for Android debugging, including device control and app filtering.
    - **Log Bookmarks**: Persistent bookmarking with custom tags and panel-based navigation.
    - **Interactive JSON Preview**: Tree view for exploring JSON objects within logs.
    - **File Hierarchy**: Visual tracking of relationships between original logs and filtered files.
- **Technology Stack**: TypeScript, VS Code API

## Review Focus

### 1. Rules Compliance
- Verify adherence to `.agent/rules/code-style.md` (imports, naming, error handling, logging)
- Verify adherence to `.agent/rules/testing.md` (test coverage, patterns, naming)
- Check that new public methods have corresponding tests
- Check that bug fixes include regression tests

### 2. Structural Integrity
- Evaluate file and directory organization
- Check filenames follow conventions (PascalCase for classes, camelCase for utilities)
- Verify class names match filenames, each file has single responsibility
- Identify misplaced files or candidates for refactoring into smaller modules

### 3. Code Quality
- Readability, maintainability, TypeScript best practices
- Dead code, unused imports, duplicated logic
- Proper use of types (no `any`, no unnecessary type assertions)

### 4. Security
- Command injection (especially in ADB/shell commands)
- Unsafe regex (ReDoS potential)
- Improper data handling, path traversal risks

### 5. Performance
- Inefficient algorithms, unnecessary iterations
- Memory leaks (missing dispose, unbounded caches, event listener leaks)
- Large file handling (streaming vs. loading entire file)

### 6. Error Handling
- Proper `catch (e: unknown)` with `e instanceof Error ? e.message : String(e)` pattern
- Error logging via `this.logger`, never `console.log/error`
- Graceful degradation for user-facing operations

### 7. Dependencies
- Outdated or vulnerable packages
- Unnecessary dependencies that increase bundle size
- Missing `devDependencies` vs `dependencies` classification

## Verification Requirements

Every finding MUST be backed by code evidence, not pattern-based inference.

### Stale reference / object identity claims
Before claiming a variable holds a stale or wrong reference:
1. Read the **getter implementation** — does it return the original object or a copy?
2. Read the **mutator implementation** — does it mutate in-place or replace with a new object?
3. Only report if the getter returns a copy AND the mutator modifies the original (or vice versa).

Example false alarm: "variable captured before toggle holds stale state" — but `getGroups()` returns `this.groups` directly, and `toggleGroup()` mutates the same object in-place, so the reference is never stale.

### Cross-location inconsistency claims
Before claiming two call sites handle the same value differently:
1. **Grep all usage sites** of the constant/function in question.
2. Compare the actual code at each site — do not assume "the other site probably uses the raw value".
3. Only report if the actual code differs in a way that causes a bug.

Example false alarm: "cleanup uses sanitized prefix but processFile uses original" — but both sites apply the identical `.replace()` transform.

### VS Code extension lifecycle claims
Do not flag module-level `vscode.workspace.getConfiguration()` reads as bugs.
VS Code loads extension modules immediately before calling `activate()` — the workspace API is available at module load time. This is a standard VS Code extension pattern.

### Map.has() + Map.get() patterns
`Map.has(key)` followed by `Map.get(key)` is not a bug — the value is guaranteed to exist at runtime. It is a Minor style issue (TypeScript cannot narrow after `has()`), not a Major or Critical finding. Recommend `const v = map.get(key); if (v !== undefined)` as an alternative, but do not overstate severity.

## Severity Levels

Classify each finding by severity:

| Severity | Description | Action |
|----------|-------------|--------|
| **Critical** | Security vulnerabilities, data loss risks, crashes | Must fix before release |
| **Major** | Performance issues, missing error handling, broken patterns | Should fix in current cycle |
| **Minor** | Style inconsistencies, small refactoring opportunities | Fix when convenient |
| **Info** | Suggestions, alternative approaches, future considerations | Optional |

## Review Report

### Output location
Save reports to `reports/` directory (gitignored).

### Naming convention
`<model>_review_<version>_v<iteration>.md`
- Example: `opus_review_v170_v1.md`
- Increment iteration for re-reviews of the same version

### Report format

```markdown
# Code Review: <version or scope>

> Date: YYYY-MM-DD
> Reviewer: <agent name/model>
> Scope: full codebase | specific files/features

## Summary
High-level overview of code quality and key observations.

## Findings

### Critical
- [C1] **<title>** (`src/path/file.ts:line`)
  Description and suggested fix.

### Major
- [M1] **<title>** (`src/path/file.ts:line`)
  Description and suggested fix.

### Minor
- [m1] **<title>** (`src/path/file.ts:line`)
  Description and suggested fix.

### Info
- [i1] **<title>**
  Suggestion or observation.

## Code Quality Score
**Score: XX/100**
Brief justification.

## Conclusion
Final thoughts and recommended next steps.
```
