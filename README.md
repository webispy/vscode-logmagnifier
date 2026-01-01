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

## Usage

1. **Open** "LogMagnifier" from the Activity Bar (List Icon).
2. **Add Group**: Click the `+` icon to create a new Filter Group (e.g., "AuthFlow").
3. **Add Filters**: Active the group, then add "Include" or "Exclude" keywords.
    - *Tip*: Hover over items to Toggle or Delete them.
    - *Tip*: Right-click items for options like **Change Color**, **Toggle Case Sensitivity**, or **Toggle Highlighting Mode** (cycles: Word → Line → Whole Line).
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

## Credits

This project was built with **Google Antigravity**.
