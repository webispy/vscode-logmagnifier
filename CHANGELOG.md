# Change Log

All notable changes to the "LogMagnifier" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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