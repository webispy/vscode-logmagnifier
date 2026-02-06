/**
 * Centralized constants for the extension.
 * These values MUST match the definitions in package.json.
 */

export const Constants = {
    ExtensionId: 'logmagnifier',

    Schemes: {
        File: 'file',
        Untitled: 'untitled',
    },

    Commands: {
        AddFilterGroup: 'logmagnifier.addFilterGroup',
        AddRegexFilterGroup: 'logmagnifier.addRegexFilterGroup',
        AddFilter: 'logmagnifier.addFilter',
        AddRegexFilter: 'logmagnifier.addRegexFilter',
        ApplyWordFilter: 'logmagnifier.applyWordFilter',
        ApplyRegexFilter: 'logmagnifier.applyRegexFilter',
        DeleteFilter: 'logmagnifier.deleteFilter',
        EnableGroup: 'logmagnifier.enableGroup',
        DisableGroup: 'logmagnifier.disableGroup',
        EnableFilter: 'logmagnifier.enableFilter',
        DisableFilter: 'logmagnifier.disableFilter',
        ToggleFilter: 'logmagnifier.toggleFilter',
        ToggleGroup: 'logmagnifier.toggleGroup',

        ChangeFilterColor: {
            Prefix: 'logmagnifier.changeFilterColor',
            Color01: 'logmagnifier.changeFilterColor.color01',
            Color02: 'logmagnifier.changeFilterColor.color02',
            Color03: 'logmagnifier.changeFilterColor.color03',
            Color04: 'logmagnifier.changeFilterColor.color04',
            Color05: 'logmagnifier.changeFilterColor.color05',
            Color06: 'logmagnifier.changeFilterColor.color06',
            Color07: 'logmagnifier.changeFilterColor.color07',
            Color08: 'logmagnifier.changeFilterColor.color08',
            Color09: 'logmagnifier.changeFilterColor.color09',
            Color10: 'logmagnifier.changeFilterColor.color10',
            Color11: 'logmagnifier.changeFilterColor.color11',
            Color12: 'logmagnifier.changeFilterColor.color12',
            Color13: 'logmagnifier.changeFilterColor.color13',
            Color14: 'logmagnifier.changeFilterColor.color14',
            Color15: 'logmagnifier.changeFilterColor.color15',
            Color16: 'logmagnifier.changeFilterColor.color16',
        },

        ToggleFilterHighlightMode: {
            Word: 'logmagnifier.toggleFilterHighlightMode.word',
            Line: 'logmagnifier.toggleFilterHighlightMode.line',
            Full: 'logmagnifier.toggleFilterHighlightMode.full',
        },

        ToggleFilterCaseSensitivity: {
            On: 'logmagnifier.toggleFilterCaseSensitivity.on',
            Off: 'logmagnifier.toggleFilterCaseSensitivity.off',
        },

        ToggleFilterType: {
            Include: 'logmagnifier.toggleFilterType.include',
            Exclude: 'logmagnifier.toggleFilterType.exclude',
        },

        NextMatch: 'logmagnifier.nextMatch',
        PreviousMatch: 'logmagnifier.previousMatch',

        ToggleFilterContextLine: {
            None: 'logmagnifier.toggleFilterContextLine_cl0',
            PlusMinus3: 'logmagnifier.toggleFilterContextLine_cl3',
            PlusMinus5: 'logmagnifier.toggleFilterContextLine_cl5',
            PlusMinus9: 'logmagnifier.toggleFilterContextLine_cl9',
        },

        SetFilterType: {
            Include: 'logmagnifier.setFilterType.include',
            Exclude: 'logmagnifier.setFilterType.exclude',
        },

        SetFilterCaseSensitivity: {
            On: 'logmagnifier.setFilterCaseSensitivity.on',
            Off: 'logmagnifier.setFilterCaseSensitivity.off',
        },

        SetFilterHighlightMode: {
            Word: 'logmagnifier.setFilterHighlightMode.word',
            Line: 'logmagnifier.setFilterHighlightMode.line',
            Full: 'logmagnifier.setFilterHighlightMode.full',
        },

        SetFilterContextLine: {
            None: 'logmagnifier.setFilterContextLine.none', // cl0
            PlusMinus3: 'logmagnifier.setFilterContextLine.cl3',
            PlusMinus5: 'logmagnifier.setFilterContextLine.cl5',
            PlusMinus9: 'logmagnifier.setFilterContextLine.cl9',
        },

        TogglePrependLineNumbers: {
            Enable: 'logmagnifier.togglePrependLineNumbers.enable',
            Disable: 'logmagnifier.togglePrependLineNumbers.disable',
        },

        ToggleWordWrap: 'logmagnifier.toggleWordWrap',
        ToggleMinimap: 'logmagnifier.toggleMinimap',
        ToggleStickyScroll: 'logmagnifier.toggleStickyScroll',
        ToggleJsonPreview: 'logmagnifier.toggleJsonPreview',
        ToggleOccurrencesHighlight: 'logmagnifier.toggleOccurrencesHighlight',
        ToggleFileSizeUnit: 'logmagnifier.toggleFileSizeUnit',

        ExportWordFilters: 'logmagnifier.exportWordFilters',
        ImportWordFilters: 'logmagnifier.importWordFilters',
        ExportRegexFilters: 'logmagnifier.exportRegexFilters',
        ImportRegexFilters: 'logmagnifier.importRegexFilters',
        ManageProfiles: 'logmagnifier.manageProfiles',

        // ADB Devices
        RefreshDevices: 'logmagnifier.refreshDevices',
        AddLogcatSession: 'logmagnifier.addLogcatSession',
        StartLogcatSession: 'logmagnifier.startLogcatSession',
        StopLogcatSession: 'logmagnifier.stopLogcatSession',
        RemoveLogcatSession: 'logmagnifier.removeLogcatSession',
        SessionEnableTimeFilter: 'logmagnifier.session.enableTimeFilter',
        SessionDisableTimeFilter: 'logmagnifier.session.disableTimeFilter',
        AddLogcatTag: 'logmagnifier.addLogcatTag',
        EditLogcatTag: 'logmagnifier.editLogcatTag',
        RemoveLogcatTag: 'logmagnifier.removeLogcatTag',
        PickTargetApp: 'logmagnifier.pickTargetApp',

        ControlUninstall: 'logmagnifier.control.uninstall',
        ControlClearStorage: 'logmagnifier.control.clearStorage',
        ControlClearCache: 'logmagnifier.control.clearCache',
        ControlDumpsys: 'logmagnifier.control.dumpsys',
        ControlDumpsysMeminfo: 'logmagnifier.control.dumpsysMeminfo',
        ControlDumpsysActivity: 'logmagnifier.control.dumpsysActivity',
        ControlScreenshot: 'logmagnifier.control.screenshot',
        ControlStartScreenRecord: 'logmagnifier.control.startScreenRecord',
        ControlStopScreenRecord: 'logmagnifier.control.stopScreenRecord',
        ControlToggleShowTouches: 'logmagnifier.control.toggleShowTouches',
        ClearAllData: 'logmagnifier.clearAllData',

        // Bookmark
        AddBookmark: 'logmagnifier.addBookmark',
        AddMatchListToBookmark: 'logmagnifier.addMatchListToBookmark',
        AddSelectionMatchesToBookmark: 'logmagnifier.addSelectionMatchesToBookmark',
        RemoveBookmark: 'logmagnifier.removeBookmark',
        ToggleBookmark: 'logmagnifier.toggleBookmark',
        JumpToBookmark: 'logmagnifier.jumpToBookmark',
        JumpToSource: 'logmagnifier.jumpToSource',
        CopyAllBookmarks: 'logmagnifier.copyAllBookmarks',
        OpenAllBookmarks: 'logmagnifier.openAllBookmarks',
        RemoveAllBookmarks: 'logmagnifier.removeAllBookmarks',
        ToggleBookmarkWordWrap: 'logmagnifier.bookmark.toggleWordWrap',

        // Other shortcuts / Context menu
        CopyGroupEnabledItems: 'logmagnifier.copyGroupEnabledItems',
        CopyGroupEnabledItemsSingleLine: 'logmagnifier.copyGroupEnabledItemsSingleLine',
        CopyGroupEnabledItemsWithTag: 'logmagnifier.copyGroupEnabledItemsWithTag',

        SetExcludeStyle: {
            LineThrough: 'logmagnifier.setExcludeStyle.lineThrough',
            Hidden: 'logmagnifier.setExcludeStyle.hidden',
        },

        // Aliases / Shortcuts
        CreateFilter: 'logmagnifier.createFilter',
        CreateRegexFilter: 'logmagnifier.createRegexFilter',
        DeleteGroup: 'logmagnifier.deleteGroup',
        RenameFilterGroup: 'logmagnifier.renameFilterGroup',
        ExportGroup: 'logmagnifier.exportGroup',
        EditFilterItem: 'logmagnifier.editFilterItem',
        AddSelectionToFilter: 'logmagnifier.addSelectionToFilter',
        RemoveMatchesWithSelection: 'logmagnifier.removeMatchesWithSelection',
        ExpandAllWordGroups: 'logmagnifier.expandAllWordGroups',
        CollapseAllWordGroups: 'logmagnifier.collapseAllWordGroups',
        ExpandAllRegexGroups: 'logmagnifier.expandAllRegexGroups',
        CollapseAllRegexGroups: 'logmagnifier.collapseAllRegexGroups',
        EnableAllItemsInGroup: 'logmagnifier.enableAllItemsInGroup',
        DisableAllItemsInGroup: 'logmagnifier.disableAllItemsInGroup',
        ApplyJsonPretty: 'logmagnifier.applyJsonPretty',

        // Bookmark internal
        RemoveBookmarkFile: 'logmagnifier.removeBookmarkFile',
        CopyBookmarkFile: 'logmagnifier.copyBookmarkFile',
        OpenBookmarkFile: 'logmagnifier.openBookmarkFile',
        RemoveBookmarkGroup: 'logmagnifier.removeBookmarkGroup',
    },

    Views: {
        Container: 'logmagnifier-container',
        QuickAccess: 'logmagnifier-quick-access',
        Filters: 'logmagnifier-filters',
        RegexFilters: 'logmagnifier-regex-filters',
        ADBDevices: 'logmagnifier-adb-devices',
        Bookmark: 'logmagnifier-bookmark',
    },

    Configuration: {
        Section: 'logmagnifier',
        TempFilePrefix: 'tempFilePrefix', // relative to section
        JsonPreviewEnabled: 'jsonPreview.enabled',
        JsonPreviewMaxLines: 'jsonPreview.maxLines',
        StatusBarTimeout: 'statusBarTimeout',
        HighlightColors: {
            Section: 'logmagnifier.highlightColors',
            // Individual colors are constructed dynamically or accessed via loop, but base is here
        },
        Regex: {
            Section: 'regex',
            EnableHighlight: 'regex.enableHighlight',
            HighlightColor: 'regex.highlightColor',
            DefaultHighlightColor: 'rgba(255, 255, 0, 0.3)',
        },
        Bookmark: {
            Section: 'bookmark',
            HighlightColor: 'rgba(255, 0, 0, 0.5)', // Red like the icon
            MaxMatches: 'bookmark.maxMatches',
        },
        Editor: {
            Section: 'editor',
            WordWrap: 'wordWrap',
            MinimapEnabled: 'minimap.enabled',
            StickyScrollEnabled: 'stickyScroll.enabled',
            RemoveMatchesMaxLines: 'removeMatches.maxLines',
            LargeFileOptimizations: 'largeFileOptimizations',
        },
        Adb: {
            Path: 'adbPath',
            DefaultOptions: 'adbLogcatDefaultOptions',
        },
    },

    Prompts: {
        EnterFilterKeyword: 'Enter Filter Keyword',
        EnterFilterNickname: 'Enter Filter Nickname (e.g. ADB Logcat)',
        EnterRegexPattern: 'Enter Regex Pattern',
        SelectColor: 'Select a highlight color',
        EnterFilterGroupName: 'Enter Word Filter Group Name',
        EnterRegexFilterGroupName: 'Enter Regex Filter Group Name',
        SelectImportMode: 'Select import mode',
        EnterProfileName: 'Enter Profile Name',
        SelectProfileFromList: 'Select a Profile',
        EnterSessionName: 'Enter Session Name',
        EnterTagTimestamp: 'Enter Tag and Priority (e.g. MyApp:D)',
        EditTag: 'Edit Tag',

        EnterNewGroupName: 'Enter new group name',
        EnterNickname: 'Enter Name (Nickname)',
        EnterNewKeyword: 'Enter new keyword',
        EnterNewProfileName: 'Enter name for new profile',
        EnterDuplicateProfileName: 'Enter name for duplicated profile',
        SelectOccurrencesHighlightMode: 'Select Occurrences Highlight Mode (Current: {0})',

        ExportWordFilters: 'Export Word Filters',
        ExportRegexFilters: 'Export Regex Filters',
        ExportGroup: 'Export Group: {0}',
        ImportWordFilters: 'Import Word Filters',
        ImportRegexFilters: 'Import Regex Filters',
        ConfirmClearAllData: 'Are you sure you want to clear ALL persistent data? This includes all profiles, filters, and bookmarks. This action cannot be undone.',
        ReloadConfirm: 'Reload window now to apply changes?',
    },

    PlaceHolders: {
        SessionName: 'My App Debug',
        TagFormat: 'Tag:Priority',
        SelectTargetApp: 'Select Target Application (filters by PID)',
    },

    FilterTypes: {
        Include: 'include' as const,
        Exclude: 'exclude' as const,
    },

    ContextKeys: {
        PrependLineNumbersEnabled: 'logmagnifier.prependLineNumbersEnabled',
        BookmarkMouseOver: 'logmagnifier.bookmark.mouseOver',
    },

    GlobalState: {
        FilterGroups: 'logmagnifier.filterGroups',
        FilterProfiles: 'logmagnifier.filterProfiles',
        ActiveProfile: 'logmagnifier.activeProfile',
        Bookmarks: 'logmagnifier.bookmarks',
    },

    Labels: {
        WordWrap: 'Word Wrap',
        Minimap: 'Minimap',
        StickyScroll: 'Sticky Scroll',
        JsonPreview: 'Auto JSON Preview',
        OccurrencesHighlight: 'Occurrences Highlight',
        FileSize: 'File Size',
        Bytes: 'Bytes',
        KB: 'KB',
        MB: 'MB',
        NA: 'N/A',
        DefaultProfile: 'Default',
        All: 'all',
        ShowAllLogs: 'Show all logs',
        Running: '(running)',
        UserApps: 'User Apps (3rd-Party)',
        SystemApps: 'System Apps',
        Off: 'Off',
        SingleFile: 'Single File',
        MultiFile: 'Multi File',
        NewProfile: 'New Profile...',
        DuplicateProfile: 'Duplicate Profile...',
    },

    Descriptions: {
        OccurrencesOff: 'Disable occurrences highlight',
        OccurrencesSingle: 'Highlight occurrences in the current file only',
        OccurrencesMulti: 'Highlight occurrences across all open files',
        CreateNewProfile: 'Create a new empty profile',
        DuplicateProfile: 'Make a copy of the current profile',
        SwitchProfile: 'Switch to this profile',
    },

    ImportModes: {
        Merge: 'Merge (Add to existing)',
        Overwrite: 'Overwrite (Replace existing)',
    },

    ExtensionDisplayName: 'LogMagnifier',

    Messages: {
        Info: {
            NoTextToProcess: 'LogMagnifier: No text to process.',
            NoJsonFound: 'LogMagnifier: No JSON-like content found in the selection.',
            SelectTextToSearch: 'Please select a text to search for matches.',
            AddedBookmarks: 'Added {0} bookmarks.',
            AddedBookmarksLimited: 'Added {0} bookmarks (Limited to first {1} matches).',
            NoMatchesFound: 'No matches found in the active editor.',
            BookmarksCopied: 'Bookmarks copied to clipboard.',
            UninstallCompleted: 'Uninstall completed. Please refresh the device list.',
            ClearStorageCompleted: 'Clear storage completed. Please refresh if needed.',
            ClearCacheCompleted: 'Clear cache completed. Please refresh if needed.',
            ClearAllDataCompleted: 'All data cleared.',
            RecordingStarted: 'Recording started... (Max 3 mins)',
            SelectTextFirst: 'Please select some text first.',
            NoMatchesForText: 'No matches found for \'{0}\'.',
            RemovedLines: 'Removed {0} lines matching \'{1}\'.',
            CopiedItems: 'Copied {0} items to clipboard.',
            CopiedItemsSingleLine: 'Copied {0} items to clipboard (single line).',
            CopiedItemsTags: 'Copied {0} items as tags to clipboard.',
            NoEnabledItems: 'No enabled items to copy (excluded filters ignored).',
            ProfileDeleted: 'Profile \'{0}\' deleted.',
            ProfileCreated: 'Profile \'{0}\' created and activated.',
            ProfileDuplicated: 'Profile duplicated as \'{0}\'.',
            ProfileSwitched: 'Switched to profile \'{0}\'.',
            SelectFilterFirst: 'Please select a filter in the Word Filters view first.',
            FilterDisabled: 'Filter \'{0}\' is disabled.',
            NoMatchesForFilter: 'No matches found for: {0}',
            ExportSuccess: '{0} filters exported successfully to {1}',
            ExportGroupSuccess: 'Group \'{0}\' exported successfully to {1}',
            ImportSuccess: 'Successfully imported {0} {1} filter groups.',
            NoSourceMapping: 'No source mapping found for this line.',
            FallbackToOpen: 'Failed to open text document (likely too large), falling back to vscode.open: {0}',
            AllBookmarksCopied: 'All bookmarks copied to clipboard.',
            RemovedBookmarks: 'Removed {0} bookmarks matching selection \'{1}\'.',

        },
        Warn: {
            UninstallConfirm: 'Are you sure you want to uninstall {0}?',
            ClearStorageConfirm: 'Are you sure you want to clear storage for {0}?',
            RemoveMatchesConfirm: 'Are you sure you want to remove {0} lines matching \'{1}\'?',
            NoLinesToRemove: 'No lines found matching selection to remove.',
            ConfirmDeleteProfile: 'Are you sure you want to delete profile \'{0}\'?',
            NoActiveGroups: 'No active {0} groups selected.',
            EmptyImport: '{0} Check your filter keywords (case-sensitive).',
            NoMatchingFilters: 'No matching filters found in the selected file.',
            FilterAlreadyExistsInGroup: 'Filter \'{0}\' already exists in group \'{1}\'.',
            AppNotRunning: 'App {0} is not running. Starting logcat without PID filter.',
            OriginalFileClosed: 'LogMagnifier: Original file is closed or not available.',
            JsonPreviewLimited: 'JSON Preview limited to first {0} selected lines.',
            FoundMoreThanMaxMatches: 'Found more than {0} matches. Limited to {0} bookmarks based on your settings.',
            FilteredLogViewBookmark: 'Note: This is a filtered log view. Bookmarks added here may be lost if you re-apply filters or close this temporary file.',
        },
        Error: {
            InvalidTagFormat: 'Invalid Tag format. Use "Tag" or "Tag:Priority" (V, D, I, W, E, F, S)',
            UninstallFailed: 'Uninstall failed.',
            ClearStorageFailed: 'Clear storage failed.',
            ClearCacheFailed: 'Clear cache failed (App might need to be debuggable).',
            DumpsysNoOutput: 'Dumpsys returned no output.',
            DumpsysFailed: 'Dumpsys failed: {0}',
            ScreenshotFailed: 'Screenshot capture failed.',
            JsonProcessError: 'LogMagnifier: Error processing JSON.',
            NoActiveEditor: 'No active text editor found.',
            OpenBookmarkFailed: 'Failed to open bookmark: {0}',
            OpenBookmarkTabFailed: 'Failed to open bookmark tab: {0}',
            WordFilterGroupExists: 'Word Filter Group \'{0}\' already exists.',
            RegexFilterGroupExists: 'Regex Filter Group \'{0}\' already exists.',
            FilterExistsInGroup: 'Filter \'{0}\' ({1}) already exists in this group.',
            RegexFilterExists: 'Regex Filter with pattern \'{0}\' or nickname \'{1}\' already exists in this group.',
            ProfileCreateFailed: 'Failed to create profile \'{0}\'.',
            NoFilterGroups: 'No {0} filter groups exist. Create a group first.',
            NoActiveFile: 'No active file found. Please ensure a log file is open and visible.',
            ApplyFiltersError: 'Error applying filters: {0}',
            ExportFailed: 'Failed to export filters: {0}',
            ExportGroupFailed: 'Failed to export group: {0}',
            ImportFailed: 'Failed to import filters: {0}',
            ReadFilterFileFailed: 'Failed to read filter file: {0}',
            JumpToSourceFailed: 'Failed to jump to source: {0}',
            FileTooLarge: 'Cannot {0}: File is too large (>50MB). Please reduce file size or use a different viewer.',
            FailedToOpenBookmarks: 'Failed to open all bookmarks: {0}',

            ImportInvalidFormat: 'Invalid filter data format: expected an object with a "groups" array.',
            InvalidFilterPattern: 'Invalid filter pattern: "{0}"',
            InvalidRegularExpression: 'Invalid Regular Expression',
            LogcatStartFailed: 'Failed to start logcat process: {0}',
            RecordingFailed: 'Screen recording failed: {0}',
            RecordingEmpty: 'Screen recording file is empty.',
            RetrieveRecordingFailed: 'Failed to retrieve screen recording.',
        },
        Progress: {
            Processing: 'Processing...',
            Downloading: 'Downloading...',
        }
    },

    Defaults: {
        TempFilePrefix: 'filtered_',
        AdbPath: 'adb',
        AdbDefaultOptions: '-v threadtime',
    },
} as const;
