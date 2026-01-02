# LogMagnifier

A stream-based log analysis tool for Visual Studio Code, designed to handle large log files efficiently.

## Features

- **Large File Support**: Efficiently stream-processes large log files (50MB+) without freezing the editor.
- **Filter Groups**: Organize your analysis with named groups of filters.
- **Include/Exclude Logic**:
  - **Include**: Keep lines containing specific keywords.
  - **Exclude**: Remove lines containing specific keywords (highest priority).
- **Match Counts**: Real-time count of keyword occurrences displayed in the sidebar.
- **Search Navigation**: Quickly navigate between matches using Previous/Next buttons in the sidebar.
- **3-Stage Highlighting**: Toggle between Word, Line, and Whole Line highlight modes.
- **Focus Mode**: Generates a new editor tab with filtered results, enabling multi-stage filtering.
- **Regex Support**: Advanced filtering using regular expressions.
- **Drag & Drop**: Reorder filters intuitively.
- **Highlighting**: Automatically highlights "include" keywords in the filtered view.
- **Robust Detection**: Works with standard files and VS Code's optimized "Large File" read-only views.
- **Expanded Colors**: 16 distinct colors for highlighting.
- **Context Lines**: View matching lines with surrounding context (±3, ±5, ±9 lines).

## Usage

1. **Open** "LogMagnifier" from the Activity Bar (List Icon).
2. **Add Group**: Click the `+` icon to create a new Filter Group (e.g., "AuthFlow").
3. **Add Filters**: Active the group, then add "Include" or "Exclude" keywords.
    - *Tip*: Hover over items to Toggle or Delete them.
    - *Tip*: Right-click items for options like **Change Color**, **Toggle Case Sensitivity**, **Context Lines** (±0/3/5/9), or **Toggle Highlighting Mode** (cycles: Word → Line → Whole Line).
    - *Tip*: Click the **Arrow Up/Down** icons on a filter item to navigate to the previous or next match in the editor.
4. **Apply**: Open your log file and click the **Play** icon in the view title.
5. **Analyze**: A new tab opens with the results.

## Requirements

- VS Code 1.104.0 or higher.


## Extension Settings

This extension contributes the following settings:

* `logmagnifier.maxFileSizeMB`: Maximum file size in MB for opening filtered logs as text documents. Larger files will open in safe mode. (Default: 50)
* `logmagnifier.highlightColor`: Background color for log highlights. (Default: `rgba(255, 255, 0, 0.3)`)
* `logmagnifier.tempFilePrefix`: Prefix for the filtered temp files. (Default: `filtered_`)
* `logmagnifier.statusBarTimeout`: Duration for status bar messages in milliseconds. (Default: 5000)
* `logmagnifier.enableRegexHighlight`: Enable highlighting for Regex filters in the editor. (Default: `false`)

## Known Limitations

### Large File Highlighting

For extremely large files, VS Code disables certain features to preserve performance. As a result, **LogMagnifier cannot apply highlights** to these files directly.
- You will see a "File too large for highlighting" message in the status bar.
- **Workaround**: Use the **Apply Word Filter** (Play button) feature to extract relevant lines into a new, smaller file. This new file will support full highlighting and analysis.

## Credits

This project was built with **Google Antigravity**.
