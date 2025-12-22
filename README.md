# LogLens

A high-performance log analysis tool for Visual Studio Code, designed to handle large log files efficiently.

## Features

- **Large File Support**: Efficiently stream-processes large log files (50MB+) without freezing the editor.
- **Filter Groups**: Organize your analysis with named groups of filters.
- **Include/Exclude Logic**:
  - **Include**: Keep lines containing specific keywords.
  - **Exclude**: Remove lines containing specific keywords (highest priority).
- **Focus Mode**: Generates a new editor tab with filtered results, enabling multi-stage filtering.
- **Regex Support**: Advanced filtering using regular expressions.
- **Drag & Drop**: Reorder filters intuitively.
- **Highlighting**: Automatically highlights "include" keywords in the filtered view.
- **Robust Detection**: Works with standard files and VS Code's optimized "Large File" read-only views.
- **Expanded Colors**: 16 distinct colors for highlighting.

## Usage

1. **Open** the "Log Viewer" from the Activity Bar (List Icon).
2. **Add Group**: Click the `+` icon to create a new Filter Group (e.g., "AuthFlow").
3. **Add Filters**: Active the group, then add "Include" or "Exclude" keywords.
   - *Tip*: Hover over items to Toggle or Delete them.
4. **Apply**: Open your log file and click the **Play** icon in the view title.
5. **Analyze**: A new tab opens with the results.

## Requirements

- VS Code 1.104.0 or higher.

## Release Notes

### 0.1.0
- Initial release.
- Stream-based large file processing.
- Persistent filter groups per session.
- Inline UX for managing filters.

## Credits

This project was built with **Google Antigravity**.
