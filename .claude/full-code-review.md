# Claude Code Review Configuration

This configuration defines the rules and instructions for Claude Code when performing automated code reviews in CI.

## Project Context: LogMagnifier

**LogMagnifier** is a powerful VS Code extension for log analysis. Key features and architectural points:
- **Core Purpose**: Advanced log filtering and multi-stage highlighting to simplify complex log analysis.
- **Key Features**:
    - **Filter Groups**: Include/Exclude logic with organization into groups.
    - **Highlighting**: 3-stage highlighting (Word, Line, Full Line) with custom color presets.
    - **ADB Logcat**: Direct integration for Android debugging, including device control and app filtering.
    - **Log Bookmarks**: Persistent bookmarking with custom tags and panel-based navigation.
    - **Interactive JSON Preview**: Tree view for exploring JSON objects within logs.
    - **File Hierarchy**: Visual tracking of relationships between original logs and filtered files.
- **Technology Stack**: TypeScript, VS Code API, and developed primarily using AI (Antigravity).

## Review Focus

1.  **Structural Integrity**: 
    - Evaluate the project's file and directory organization.
    - Check if filenames follow established conventions (e.g., PascalCase for classes, camelCase for utilities).
    - Verify that class names match their respective filenames and that each file has a clear, single responsibility.
    - Identify any files that are misplaced or should be refactored into smaller modules.
2.  **Code Quality**: Check for readability, maintainability, and adherence to TypeScript best practices.
3.  **Security**: Identify potential vulnerabilities (e.g., command injection, unsafe regex, improper data handling).
4.  **Performance**: Look for inefficient algorithms, unnecessary re-renders (if applicable), or memory leaks.
5.  **Error Handling**: Ensure proper try-catch blocks, error logging, and graceful degradation.

## Instructions for Claude

- Perform a comprehensive review of the codebase, focusing on recent changes if context is available.
- Provide specific, actionable feedback for each issue identified.
- Use code snippets to illustrate suggested improvements.
- Assign a **Code Quality Score** from 0 to 100 based on the overall health of the code reviewed.

## Output Format

The review report must be in Markdown format with the following sections:

1.  **Summary**: A high-level overview of the code quality.
2.  **Key Improvements**: A list of major issues and suggested fixes.
3.  **Minor Suggestions**: Nitpicks or small refactoring ideas.
4.  **Code Quality Score**: A numerical score with a brief justification.
5.  **Conclusion**: Final thoughts and next steps.
