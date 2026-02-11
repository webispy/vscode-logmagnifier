# Change Log

## [1.6.0]

### Added
- **Workflow**: Introduced Automated Log Analysis Workflow to chain multiple filter profiles for complex analysis.
- **Shell Commander**: Added a powerful Shell Commander to execute and organize custom shell scripts with context-aware terminal reuse.
- **ADB**: Added support for "Chrome Inspect" to debug webviews on connected devices directly from the device tree.

### Changed
- **Internal**: Refactored CommandManager into focused sub-modules for better maintainability.

### Fixed
- **Highlight**: Fixed issue where highlights were not correctly applied in some edge cases.
- **Filter Export**: Resolved issues with group selection and layout during filter export.
- **Stability**: Improved terminal execution reliability in Shell Commander.

## [1.5.6]

### Refactor
- **Internal**: Converted file operations to asynchronous to improve performance and stability.
- **Cleanup**: Extensive code cleanup including removal of unused variables and stale comments.
- **Quality**: Improved type safety and linting compliance across the codebase.

## [1.5.5]

### Added
- **Data Management**: Added "Clear All Persistent Data" command to reset all extension state (Filters, Profiles, Bookmarks).
- **CI**: Added Codecov support for test coverage reporting.
- **Documentation**: Added CI/CD and Marketplace badges to README.

### Changed
- **Performance**: Optimized Auto JSON Preview with debouncing for smoother experience.
- **Internal**: Refactored code to remove dependencies and improve type safety.

### Fixed
- **Security**: Prevented potential ADB command injection vulnerabilities.
- **Security**: Enforced Content Security Policy (CSP) in webviews.
- **Stability**: Resolved memory leaks and logic errors in bookmark handling.

## [1.5.4]

### Changed
- **Bookmark UX**: Improved bookmark navigation with quick-nav and auto-scroll behavior. Removed redundant history buttons.
- **Bookmark Labels**: Manual bookmarks now use line numbers as default labels.
- **JSON Preview**: Added depth control and selection size limits (default 10 lines) to prevent freezing.
- **Context Menu**: Reorganized LogMagnifier context menu for better usability.
- **Filter Tree**: Enhanced icons to better distinguish enabled vs disabled states.

### Fixed
- **Bookmark Stability**: Resolved memory leaks and fixed incorrect history state handling.
- **Webview**: Fixed horizontal scrolling issues in bookmark webview.
- **Large Files**: Updated error messages for clearer feedback.

## [1.5.3]

### Added
- **Highlight Colors**: Added `color00` ("Bold Only") option for subtle highlighting.
- **Bookmark Tags**: Added support for keyword tags on bookmarks.
- **Clear All**: Added "Clear All" action to remove all bookmarks for the current file.

### Changed
- **Bookmark UI**: Moved action icons to the top toolbar for better access.
- **Word Wrap**: Improved smart word wrap to target specific views based on mouse position.

## [1.5.2]

### Changed
- **JSON Preview**: Replaced text-based pretty print with an interactive Webview (Tree/Text modes, search).
- **Navigation**: Removed duplicate highlight navigation toggle from UI (now controlled via settings).

### Fixed
- **Navigation**: Fixed "Jump to source" functionality from the JSON preview view.

## [1.5.1]

### Refactor
- **Internal**: Improved code style and centralized constants.
- **Performance**: Optimized highlighting logic, filter service, and reduced memory usage.

## [1.5.0]

### Added
- **JSON Pretty**: Added "Apply JSON Pretty" command to format JSON strings in log lines (Cmd+Ctrl+J).
- **Config**: Added `logmagnifier.removeMatches.maxLines` setting to configure threshold for removing matches.

### Changed
- **Context Menu**: Renamed "Add Selection to LogMagnifier" to "Add Selection to LogMagnifier Filter".
- **Internal**: Refactored ADB components naming for consistency.

### Fixed
- **UI**: Fixed context menu visibility in Output/Debug panels.
- **Filters**: Fixed issue with whitespace stripping in word filters.

## [1.4.2]

### Added
- **Editor**: Added "Remove Matches With Selection" command.

### Fixed
- **Config**: Fixed "Occurrences Highlight" setting persistence.

## [1.4.1]

### Added
- **Bookmarks**: Added "Add matches to bookmark" context menu action.
- **Logcat**: Display "No devices connected" message when device list is empty.

### Changed
- **Bookmarks**: Enhanced file-level bookmark management.

### Fixed
- **UI**: Fixed bookmark welcome message casing.

## [1.4.0]

### Added
- **Log Bookmarks**: Add, remove, and persist bookmarks for important log lines. Includes a dedicated view in the LogMagnifier Panel for easy navigation.
- **Navigation Animation**: Added a visual flash animation when navigating to search matches or bookmarks (configurable).

## [1.3.0]

### Added
- **Screen Recording**: Capture device screen directly from VS Code.
- **Device Control**: Added "Screenshot" feature and "Show Touches" toggle.
- **Dumpsys**: Added dedicated commands for Activity, Meminfo, and Package dumps.
- **Logcat**: Added toggle to start logcat from current time.

### Changed
- **UI**: Improved filter item color change interaction by making the icon clickable.

### Fixed
- **Filters**: Fixed issue where untitled documents were not filtered correctly.
## [1.2.2]

### Added
- **Logcat**: Add action button to toggle between starting logcat from "now" or "beginning".

### Fixed
- **Filters**: Fix highlight counts persisting after file closure and ensure filter context is correctly applied.
- **Logcat**: Fix incorrect tab name when applying word filters to a logcat session.

## [1.2.1]

### Changed
- **Logcat Header**: Refine session header format and separator.
- **Session Management**: Ensure new editor tab on session restart if saved.

## [1.2.0]

### Added
- **Session Input**: Suggest default name for new logcat session.
- **Logcat Header**: Enhance logcat session header with detailed info.
- **ADB Control**: Add control app menu (Uninstall, Clear Storage, Clear Cache).
- **Process Filtering**: Implement ADB logcat viewer with PID filtering.

### Changed
- **Performance**: Defer ADB device fetching on startup.

### Fixed
- **UI**: Fix quick pick persistence on focus loss.

## [1.1.0]

### Added
- **Profiles**: Enhanced filter profile management and persistence.
- **Export**: Added support for exporting individual filter groups.
- **Context Menu**: Added copy commands, and enable/disable all items for filter groups.
- **Exclude Style**: Added "Hidden" style for exclude filters.
- **Quick Access**: Added occurrences highlight toggle.

### Changed
- **Quick Access**: Improved layout and item naming for better usability.
- **Refactor**: Enhanced type safety and usage of core services.

## [1.0.0]

### Added
- **Drag and Drop**: Reordering support for filter groups.
- **Group Management**: Added support for renaming filter groups.
- **Filter Editing**: Added support for editing existing filters.
- **Tree View**: Added "Expand All" and "Collapse All" actions for filter groups.

### Changed
- **Quick Access**: "Toggle Word Wrap" now works per active editor tab.
- **UI**: Improved filter item count display in group headers.
- **Context Menus**: Refactored and simplified context menus for better usability.

### Refactored
- **Performance**: Optimized LogProcessor context buffer and match logic.

## [0.9.0]

### Added
- **Filter Types**: Added toggle for include/exclude filter types.
- **Context Menu**: Added "Add Selection to LogMagnifier" context menu command.
- **Export**: Included version in exported JSON.

### Changed
- **UI**: Enabled cross-group filter movement.
- **UX**: Simplified word filter creation workflow.

### Fixed
- **Filters**: Removed background color for exclude filters.

### Refactored
- **Codebase**: Centralized configuration keys.
- **Performance**: Optimized LogProcessor and fixed highlight sync.

## [0.8.0]

### Added
- **Quick Access View**: Added new Quick Access view for utility toggles and file size display.
- **Import/Export**: Added support for importing and exporting Word and Regex filters.
- **File Size Display**: Display file size in Quick Access view with improved formatting.

### Fixed
- **Regex Filters**: Fixed issue where regex keyword was not displayed in filter items.
- **Line Numbers**: Corrected behavior of line number toggle and fixed potential format issues.
- **UI**: Standardized helper text and tooltips.

### Refactored
- **Color Presets**: Centralized and standardized color presets configuration.
- **Settings**: Grouped Regex settings for better usability.

## [0.7.0]

### Added
- **Line Numbers**: Added toggle to prepend original line numbers to filtered output.
- **Exclude Filters**: Enhanced exclude filter behavior with navigation (prev/next match) and strike-through styling.
- **UI**: Added color code to "Change color" tooltip and updated filter group creation icons.
- **Large Files**: Improved large file handling with status messages.

### Refactored
- **Performance**: Optimized highlighting logic, fixed recursion loops, and improved internal structure.

## [0.6.0]

### Added
- **Debug Logger**: Implemented internal debug logger for better diagnostics.

### Fixed
- **Large File Handling**: Improved stability by disabling highlights and clearing counts for large parsed files.
- **Icon**: Fixed extension icon transparent background.

### Refactored
- **Color Presets**: Refined color presets for better distinction and optimized color usage.
- **Configuration**: Renamed `logmagnifier.highlightColor` to `logmagnifier.regexHighlightColor` and added support for theme-specific colors.
- **UI**: Enhanced inline action buttons for filters.

## [0.5.0]

### Added
- **Context Line Feature**: View surrounding log lines for better context.
- **License**: Added Apache 2.0 LICENSE file.

### Fixed
- **Icon Visibility**: Resolved transparent background and dark mode visibility issues for icons.
- **Documentation**: Synced README with current features and removed unused files.
- **Naming**: Consistent extension renaming to "LogMagnifier".

## [0.4.0]

### Added
- **3-Stage Highlight Mode**: Supports cycling through Word, Line, and Whole Line highlight modes for better visibility.
- **Search Navigation**: Added Previous/Next match buttons to each filter item in the Word/Regex filters side panel.
- **Match Counts**: Display the number of keyword occurrences directly in the TreeView for easier analysis.

### Fixed
- **Stability**: Prevented creation of duplicate filter groups and items.
- **Filtering Logic**: Improved separation between Word and Regex filtering for a more predictable experience.

## [0.3.0]

### Added
- **Drag and Drop**: Reorder filters easily within the list using drag and drop.
- **Improved Filter Context Menu**: Reordered actions for better accessibility (Color > Highlight > Case > Delete > Toggle).
- **Refined UI**: Updated word filter icons to be more distinct and highlight icon to be a rounded box.
- **Expanded Colors**: Added 8 more color presets (total 16) and improved color selection dialog with previews.
- **Temp File Naming**: Updated temporary file timestamp format to `YYMMDD_HHMMSS` for better sorting.

## [0.2.0]

### Added
- **Regex Filtering**: Use regular expressions to filter logs with a dedicated side panel view.
- **Default Filters**: Included standard presets for "Logcat" and "Process Info".
- **Large File Support**: Improved handling for large filtered files with configurable size thresholds (`logmagnifier.maxFileSizeMB`).
- **Configuration**: Added user settings for highlight colors, temp file prefixes, and status bar timeouts.

### Fixed
- **Icon Rendering**: Resolved issues with LogMagnifier icon not appearing correctly in the Activity Bar.
- **Performance**: Disabled keyword highlighting for regex-based filters to improve performance.

## [0.1.0]
- Initial release.
- Stream-based large file processing.
- Persistent filter groups per session.
- Inline UX for managing filters.
