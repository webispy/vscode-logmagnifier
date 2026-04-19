# Change Log

## [1.7.3]

### Fixed
- **Tool Input**: `extractLogsWithMargin` now rejects non-finite and out-of-range `marginSeconds` (negative or above 24 hours) before attempting time math, preventing downstream overflow from unbounded inputs.
- **Hierarchy**: `FileHierarchyService` keys file:// URIs case-insensitively on macOS/Windows so mixed-case paths no longer produce duplicate hierarchy entries; legacy unnormalized keys are normalized on load.
- **Regex Errors**: Deduplication of invalid-pattern popups is now keyed on the pattern alone so engine-message variation cannot produce repeat alerts for the same bad input.
- **Webview**: Replaced the inline JSON `<\/` escape in the bookmark webview with the shared `safeJson()` helper so escaping is consistent with other webviews.
- **Logging**: `WebviewUtils.safeJson()` now logs serialization failures instead of silently returning `'null'`.
- **UX**: Filter execution and profile-manager relay failures are now surfaced via a warning popup instead of being logger-only.

### Changed
- **AI Tools**: `SearchLogTool` now exposes a `prepareInvocation` summary consistent with the other Language Model Tools.
- **Style**: Import grouping in `extension.ts`, class-member ordering in the command managers, and drag/drop MIME declarations in `FilterTreeDataProvider` now match `.agent/rules/code-style.md`. LRU-eviction sites carry explanatory comments.

## [1.7.2]

### Fixed
- **Filter**: Fixed wrong file targeted when applying filters in split editor with large files (>50MB). The fallback logic incorrectly selected the opposite pane's file instead of the intended active tab.
- **Editor**: Fixed active tab resolution priority in split editor with large files. The active tab is now checked before visible editors to prevent selecting the wrong pane.
- **Highlight**: Fixed infinite loop when a regex pattern produces zero-length matches (e.g. `^`, `a*`, `(?=...)`). Zero-length matches are now skipped by advancing the match index.
- **Filter**: Fixed file handle leak in LogProcessor when stream errors occur during large file processing. Streams are now properly closed on error.
- **Stability**: Hardened error handling, type safety, disposal patterns, and resource management across 20+ services and views via comprehensive code review.
  - SearchLogTool now uses RegexUtils for ReDoS protection.
  - LineMappingService cache upgraded from FIFO to LRU eviction.
  - AdbLogcatService validates tag priority values.
  - RunbookService file reads converted from sync to async.
  - Multiple missing disposable subscriptions tracked and cleaned up.
- **Security**: Added Android package name validation in AdbTargetAppService.

### Changed
- **Build**: Updated devDependency versions (brace-expansion, picomatch, serialize-javascript).
- **Marketplace**: Migrated badge URLs from shields.io to vsmarketplacebadges.dev.
- **Tooling**: Renamed `gif-recorder` to `demo-recorder` with MP4 output support via ffmpeg.

## [1.7.1]

### Added
- **AI Agent Integration**: 28 Language Model Tools via `vscode.lm.registerTool` for Copilot Agent Mode (`#logmagnifier` tool set).
  - **Filter Tools**: getFilters, addFilter, removeFilter, updateFilter, updateFilterColor, applyFilter, toggleFilter, toggleFilterGroup, setContextLine, setCaseSensitivity, setHighlightMode.
  - **Search Tools**: getLogSummary, searchLog, filterByTimeRange, extractLogsWithMargin.
  - **Profile Tools**: listProfiles, switchProfile, createProfile (with copyFrom), getProfileFilters, deleteProfile.
  - **Workflow Tools**: listWorkflows, runWorkflow.
  - **Bookmark Tools**: getBookmarks, addBookmark, removeBookmark, removeAllBookmarks.
  - **JSON Tool**: extractJson.
  - **Time Tools**: navigateToTime.
- **Legacy Compatibility**: Auto-migrate legacy filters in stored profiles on upgrade; import compatibility for pre-1.7.1 export files (keyword→pattern, contextLine→contextLines, line-through→strikethrough).

### Changed
- **Terminology**: Renamed "Word Filter" to "Text Filter" across all user-facing UI, commands, and view IDs to accurately reflect plain-text substring matching behavior.
- **Terminology**: Renamed "Quick Access" to "Dashboard", "keyword" to "pattern", "sequential/cumulative" to "independent/aggregated", "SimulationResult" to "ExecutionResult".
- **Terminology**: Renamed internal field names — `FilterItem.keyword` → `FilterItem.pattern`, `contextLine` → `contextLines`, `line-through` → `strikethrough`, `SourceMapService` → `LineMappingService`.
- **Terminology**: Renamed cycling commands from `Toggle~` to `Cycle~/Set~` for semantic clarity.
- **Filter**: Split "Clear Filter Data" into separate "Clear Text Filter Data" and "Clear Regex Filter Data" commands.
- **Filter**: Internal filter mode type renamed from `'word'` to `'text'`.

### Fixed
- **Migration**: Added globalState migrations for all renamed fields and enum values to ensure seamless upgrade from v1.7.0.

## [1.7.0]

### Added
- **Timestamp Analysis**: New timestamp-based log analysis feature for time-aware log navigation and extraction.
  - **Auto Detection**: Recognizes 8 built-in timestamp formats (ISO 8601, Apache, syslog, Android logcat, etc.) with support for custom patterns.
  - **Time Range Explorer**: Hierarchical tree view (hour → 10min → minute) with density bar icons for visualizing log distribution over time.
  - **Time Range Extract**: Extract log segments by time range via tree context menus or editor context menus — supports "Extract This Time → End", "Extract Start → This Time", "Extract This Range", and "Extract Range ± Margin".
  - **Go to Timestamp**: Jump to a specific time (`Ctrl+Cmd+G`) with absolute (`14:30`, `14:30:05.123`) or relative (`+5m`, `-30s`) input.
  - **Selection Gap Display**: Select multiple lines to analyze time gaps — clock gutter icons mark gap locations, hover tooltips show duration, and status bar summarizes the selection.
  - **Index Cache**: Cached timestamp index for fast repeated lookups with flash effect on tree navigation.
- **Test**: Added comprehensive test suites for TimestampService, ProfileManager, SourceMapService, WebviewUtils, IconUtils, and Filter model.

### Changed
- **Code Quality**: Applied code review fixes — hardened error handling, improved type safety, consistent member ordering, and resource disposal patterns across services and views.

### Fixed
- **Stability**: Fixed FilterTreeDataProvider icon cache race condition and improved disposal safety in AdbLogcatService.
- **Security**: Added missing input validation in FilterExportImportCommandManager and FileHierarchyService.

## [1.6.6]

### Changed
- **CI**: Added Windows lint and test job running in parallel with the existing Ubuntu job to catch platform-specific issues early.
- **Build**: Promoted all ESLint warnings to errors so lint issues are caught immediately in CI.
- **Code Quality**: Applied code review fixes — proper error handling with `catch (e: unknown)`, consistent URI scheme constants, correct class member ordering, and import ordering cleanup.

### Fixed
- **ADB**: Fixed Chrome Inspect not opening on Windows. Windows Chrome blocks `chrome://` URLs via command-line; the extension now copies the URL to clipboard and shows a paste-guidance notification.
- **Filter**: Fixed encoding-safe filtering on Windows by reading decoded document text from VS Code instead of raw disk bytes, resolving match failures for non-UTF-8 files (e.g. CP949, UTF-16).
- **Workflow**: Fixed `LogProcessor` output path casing mismatch on Windows by normalizing through `Uri.fsPath`.
- **Runbook**: Fixed Windows shell execution by switching from `cmd.exe` to `powershell.exe` with explicit UTF-8 output encoding, resolving garbled non-ASCII error messages.
- **Runbook**: Added platform-specific default health-check content — Windows gets PowerShell-native commands instead of Unix-only ones.
- **Runbook**: Fixed default System Check group not appearing in the sidebar until a manual add, by firing the tree-view change event after async initialization.

## [1.6.5]

### Added
- **Runbook**: Added "Allow All for this Runbook" option to the script execution confirmation dialog, bypassing per-block confirmation for trusted runbooks. The flag resets when the panel is closed or a different runbook is loaded.
- **Test**: Added comprehensive test suites for FilterTreeDataProvider, QuickAccess, ExportImport, LogBookmarkService, ColorService, and JsonPrettyService.

### Changed
- **Build**: Bundled the extension with esbuild for a significantly smaller `.vsix` package size.
- **CI**: Upgraded GitHub Actions to Node.js 24-compatible versions.
- **ADB**: Capped logcat per-session buffer at 10,000 lines to prevent unbounded memory growth.
- **ADB**: Consolidated `findPid`/`parsePsForPid` into AdbClient for better cohesion.
- **Code Quality**: Applied project-wide code style rules — consistent import ordering, member ordering, JSDoc on public methods, `[ClassName]` logger prefixes, and no `console.log/error` usage.

### Fixed
- **Security**: Hardened Runbook script execution and import with path validation and content sanitization.
- **Security**: Added validation for untrusted filter/workflow imports and bounded user inputs (filter name length, group count limits).
- **Security**: Strengthened ReDoS detection in RegexUtils with additional vulnerability patterns.
- **Highlight**: Fixed memory leak in highlight decorations and added cancellation support for long-running highlight operations.
- **Filter**: Fixed pending filter state not being flushed on dispose, preventing data loss.
- **Workflow**: Fixed redundant step ID mapping in `duplicateWorkflow` that caused incorrect step references.
- **Workflow**: Session temp files are now deleted on dispose to prevent disk accumulation.
- **Editor**: Fixed crash when resolving active file on virtual (non-file) documents.
- **UI**: Added eviction cap to FilterTreeDataProvider icon cache to prevent unbounded memory growth.
- **Runbook**: Fixed missing codicons in Runbook webview by adding codicons dist to `localResourceRoots`.

## [1.6.4]

### Fixed
- **Filter**: New filters added to a group now receive unique colors instead of all sharing the same color derived from the group name. The first unused color preset is selected, falling back to the hash-based assignment only when all presets are exhausted.

### Build
- **Marketplace**: Added `Debuggers` category and search keywords (`log`, `filter`, `logcat`, `adb`, `android`, etc.) to improve discoverability. Added explicit `Apache-2.0` license field.

## [1.6.3]

### Added
- **Runbook**: Completely reimplemented Shell Commander as an interactive, Markdown-based notebook (Jupyter-style).
  - Shell code blocks (`sh`, `bash`, `shell`) are executed directly in the Webview with real-time streaming output.
  - **Stop** button replaces Play while a command is running, allowing the process to be killed.
  - **Clear** button dismisses completed command output.
  - **Edit** button enables inline editing of shell code blocks, with changes persisted to the Markdown file.
  - Multiple Runbook panels can be opened simultaneously.
  - Import/Export runbook configurations as JSON.
  - Custom SVG icons for consistent tree item indentation across themes.
  - Default runbook replaced with a universal system health check (disk, memory, network, processes, uptime).
- **Workflow**: Create new profiles and rename/delete existing ones directly from the "Add Profile" quick pick.
- **Workflow**: Improved tree visualization with structural metadata (rails, connections) for complex workflow hierarchies.
- **Commands**: Added `LogMagnifier:` category prefix to all user-facing commands for cleaner command palette discovery.
- **Data Management**: Added per-module clear commands: `Clear Filter Data`, `Clear Bookmark Data`, `Clear Workflow Data`, `Clear Runbook Data`.
- **Test**: Added comprehensive test suite for RunbookService (28 tests), RunbookTreeDataProvider (6 tests), and WebviewUtils (2 tests).

### Changed
- **Runbook**: Renamed from "Shell Commander" to "Runbook" to better reflect its interactive notebook nature.
- **Runbook**: Tree enforces folder-only root level with single-level hierarchy. Inline buttons simplified — groups: [Add Item] + [Remove], items: [Edit] + [Remove]; Rename moved to context menu.
- **Runbook**: Panel title prefix changed from `Shell:` to `Runbook:`.
- **Clear All**: `Clear All Persistent Data` now also removes Runbook storage.
- **Workflow**: `LogProcessor` returns string arrays instead of concatenated strings, reducing memory usage for large log files.
- **Workflow**: File badge aligned to the far right of workflow entries for improved readability.

### Fixed
- **Security**: Fixed XSS vulnerabilities in Runbook webview — added CSP meta tag, sanitized markdown HTML output, replaced inline `onclick` handlers with data attributes and event delegation.
- **Security**: Fixed XSS in workflow tree template where error messages were inserted via `innerHTML`.
- **Stability**: Fixed orphaned child processes when closing the Runbook webview during script execution.
- **Stability**: Fixed shell code block rendering issue where `sanitize-html` stripped required `button`, `class`, `id`, and `data-*` attributes.
- **Workflow**: Fixed word filter match counts during workflow execution by preserving original filter IDs on cloned filters.
- **UI**: Fixed Runbook group item indentation loss caused by VS Code's compact folder heuristics on native ThemeIcons.
- **Build**: Resolved npm audit security vulnerabilities (`ajv`, `minimatch`, `diff`, `serialize-javascript`).
- **Compatibility**: Fixed `ps` command in default Runbook sample for macOS vs. Linux compatibility.

## [1.6.2]

### Added
- **ADB**: Added "Launch Installed App" to quickly select and launch any launchable app from the device's sidebar.
- **ADB**: Added comprehensive device and app control features (Install APK, System Info, Dumpsys Audio, etc.).
- **ADB**: Enhanced system info with detailed network and storage statistics.
- **Test**: Added comprehensive test coverage for services, commands, and webviews.

### Changed
- **ADB**: Refactored monolithic AdbService into focused micro-services (AdbDeviceService, AdbTargetAppService, AdbLogcatService) with shared AdbClient.
- **Core**: Refactored LogProcessor to remove async IIFE anti-pattern.
- **Refactor**: Restructured constants.ts into Constants.ts with Ids and Messages modules.
- **Refactor**: Renamed FilterTreeView to FilterTreeDataProvider.
- **Performance**: Implemented LRU cache for decoration types in HighlightService.
- **Performance**: Cached SVG icon generation for filter tree.

### Fixed
- **Security**: Fixed ReDoS vulnerability in regex validation.
- **Security**: Fixed unsafe shell invocation in OpenChromeInspect command.
- **Stability**: Resolved memory leaks in FilterManager and LogBookmarkWebviewProvider.
- **Stability**: Registered missing disposables and fixed resource leaks.
- **Filter**: Fixed previous match navigation logic.
- **ADB**: Fixed missing Dumpsys Audio Flinger handler in device control menu.

## [1.6.1]

### Added
- **File Hierarchy**: Added recursive delete action to quickly remove original files and all derived filters/bookmarks.
- **Shell Commander**: Added support for executing multi-line commands via temporary scripts.

### Changed
- **Shell Commander**: Updated default configuration and unified action handling.
- **Build**: Enabled stricter TypeScript compiler options for better code quality.
- **ADB**: Replaced unsafe dynamic property assignment with type-safe alternatives.

### Fixed
- **Workflow**: Fixed execution and result handling for large files.
- **Stability**: Enhanced error handling and removed dead code in activation logic.
- **Security**: Improved Content Security Policy (CSP) nonce generation and sanitized webview HTML.

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
