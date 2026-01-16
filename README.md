# LogMagnifier

A powerful log analysis tool for Visual Studio Code, featuring advanced log filtering and diverse highlighting options.

## Features

- **Filter Groups**: Organize your analysis with named groups of filters.
- **Include/Exclude Logic**:
  - **Include**: Keep and highlight lines containing specific keywords.
  - **Exclude**: Remove lines containing specific keywords (highest priority) and display matches with a strike-through or hide them completely.
- **Match Counts**: Real-time count of keyword occurrences displayed in the sidebar.
- **Search Navigation**: Quickly navigate between matches using Previous/Next buttons in the sidebar.
- **Highlighting**: Automatically highlights include type keywords in the filtered view.
- **3-Stage Highlighting**: Toggle between Word, Line, and Full Line highlight modes.
- **Navigation Animation**: Visual flash effect when navigating to search matches (configurable).
- **Expanded Colors**: 16 distinct, high-visibility colors with standardized configuration.
- **Context Lines**: View matching lines with surrounding context (±3, ±5, ±9 lines).
- **Focus Mode**: Generates a new editor tab with filtered results, enabling multi-stage filtering.
- **Regex Support**: Advanced filtering using regular expressions.
- **Drag & Drop**: Move filters between groups and reorder groups themselves with ease.
- **Organized Context Menus**: Intuitive submenus for managing filter types, case sensitivity, and highlight modes.
- **Selection to Filter**: Quickly add selected text as a new filter via the editor context menu.
- **Persistence**: Filters are automatically saved and restored when VS Code restarts.
- **Import/Export**: Share and backup your filter configurations via JSON files.
- **Quick Access**: Toggle Word Wrap (active tab), Minimap, Sticky Scroll, and view File Size from the sidebar.
- **ADB Logcat Integration**: Directly view and filter Android logs within VS Code.
  - **Device Management**: View connected devices and their status.
  - **Process Filtering**: Filter logs by specific running applications (PID) automatically.
  - **Control Device**: Quickly take screenshots, record screen, and toggle 'Show Touches'.
  - **App Control**: Uninstall apps, clear storage, clear cache, and run dumpsys commands.
  - **Session Management**: Create multiple logcat sessions with custom tag filters, priorities, and historical time toggles.

## Usage

### Filter View

1. **Open** "LogMagnifier" from the Activity Bar (LogMagnifier icon).
2. **Open Log File**: Open the log file you wish to analyze in the editor.
3. **Manage Filters**:
    - **Add Group**: Click the folder icon to create a new Filter Group (e.g., "AuthFlow").
    - **Expand/Collapse All**: Use the **Expand/Collapse** icons in the view title to manage all groups at once.
    - **Rename**: Right-click a group or a filter item to **Rename** its keyword.
    - **Bulk Actions**: Right-click a group to **Enable All Items** or **Disable All Items**.
    - **Copy**: Right-click a group to **Copy Enabled Items** as a list or tag format.
    - **Import/Export**: Use the Export and Import icons in the view title bar to backup or share your filters.
4. **Add Filters**: Activate the group, then click the **Plus** (`+`) icon to add a keyword.
    - *Tip*: Select text in the editor, right-click, and choose **Add Selection to LogMagnifier** to instantly create a filter.
    - *Tip*: Right-click items to access organized options like **Filter Type**, **Case Sensitivity**, **Highlight Mode**, and **Context Lines**.
    - *Tip*: Click the **Arrow Up/Down** icons on a filter item to navigate to the previous or next match in the editor.
    - *Tip*: Use keyboard shortcuts **`Ctrl + Cmd + ]`** (Next) and **`Ctrl + Cmd + [`** (Previous) to navigate matches of the selected filter.
5. **Apply**: Click the **Play** icon in the view title to generate filtered results.
    - *Tip*: Toggle the **List Icon** in the view title to include original line numbers in the output.
6. **Quick Access**: Use the **Quick Access** view to toggle editor settings (Word Wrap, Minimap, Sticky Scroll) or check the current file size.
    - *Tip*: Click the **File Size** item to cycle through units (Bytes, KB, MB).

### ADB Logcat View

1.  **Devices**:
    - The "ADB Logcat" view automatically lists connected Android devices.
    - **Select Target App**: Click the "Target app" item under a device to filter logs by a specific running application.
2.  **Control Device**:
    - **Screenshot**: Capture and view a screenshot of the device immediately.
    - **Screen Record**: Start/Stop screen recording. Videos are automatically pulled to your temp folder and opened.
    - **Show Touches**: Toggle visual feedback for taps on the device screen.
3.  **Control App**:
    - When a target app is selected, a "Control app" menu appears.
    - **Actions**: Uninstall, Clear Storage, or Clear Cache for the selected application.
    - **Dumpsys**: Access `package`, `meminfo`, and `activity` dumps directly from the sidebar.
4.  **Sessions**:
    - **Create Session**: Click the `+` icon on "Logcat Sessions" or run "Add Logcat Session".
    - **History Toggle**: Toggle the clock icon on a session to switch between "Start from now" and "Show full history".
    - **Add Tags**: Right-click a session to add specific tag filters (e.g., `MyApp:D`).
    - **Start/Stop**: Use the Play/Stop icons to control log capture.
    - **Output**: Logs are streamed to a new editor document with a detailed header.

## Requirements

- VS Code 1.104.0 or higher.

## Extension Settings

This extension contributes the following settings:

* `logmagnifier.regex.enableHighlight`: Enable highlighting for Regex filters in the editor. (Default: `false`)
* `logmagnifier.editor.navigationAnimation`: Enable visual flash animation when navigating to search matches. (Default: `true`)
* `logmagnifier.regex.highlightColor`: Background color for Regex highlight. Can be a color string, a preset name, or an object with `light`/`dark` values.
* `logmagnifier.highlightColors.color01` ... `color16`: Customizable light/dark mode colors for each highlight preset.
* `logmagnifier.tempFilePrefix`: Prefix for the filtered temp files. (Default: `filtered_`)
* `logmagnifier.statusBarTimeout`: Duration for status bar messages in milliseconds. (Default: 5000)
* `logmagnifier.adbPath`: Path to the adb executable. (Default: `adb`)
* `logmagnifier.adbLogcatDefaultOptions`: Default options for adb logcat command. (Default: `-v threadtime`)

## Known Limitations

### Large File Support & Highlighting

LogMagnifier depends on VS Code's extension capabilities to provide highlighting and navigation. There are two levels of limitations for large files:

1.  **Restricted Mode (`editor.largeFileOptimizations`)**:
    * VS Code defaults to "restricted mode" for large files to allow them to open quickly. In this mode, extensions are disabled.
    * To enable Highlighting, Previous Match, and Next Match commands for these files, you must disable this optimization in your VS Code settings:
        ```json
        "editor.largeFileOptimizations": false
        ```
    * *Warning*: This may cause VS Code to freeze or perform slowly when opening very large files.

2.  **Extension Host Hard Limit (50MB)**:
    * Even with optimizations disabled, VS Code's extension host has a hard limit. Files larger than **50MB** are **not synchronized** to extensions ([reference](https://github.com/microsoft/vscode/issues/31078)).
    * For files > 50MB, **highlighting will not work** regardless of your settings because the text content is completely invisible to the plugin.
    * **Workaround**: Use the **Apply Filter** (Play button) feature. This streams the file content (bypassing the editor limit) and generates a smaller filtered log file where highlighting and navigation will work perfectly.

## Credits

All code in this project was written using **Google Antigravity**. Maintained by [webispy](https://github.com/webispy).
