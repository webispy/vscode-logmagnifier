export const Ids = {
    ExtensionId: 'logmagnifier',

    Schemes: {
        File: 'file',
        Untitled: 'untitled',
    },

    Commands: {
        AddTextFilterGroup: 'logmagnifier.addTextFilterGroup',
        AddRegexFilterGroup: 'logmagnifier.addRegexFilterGroup',
        AddTextFilter: 'logmagnifier.addTextFilter',
        AddRegexFilter: 'logmagnifier.addRegexFilter',
        ApplyTextFilter: 'logmagnifier.applyTextFilter',
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

        CycleFilterHighlightMode: {
            Word: 'logmagnifier.cycleFilterHighlightMode.word',
            Line: 'logmagnifier.cycleFilterHighlightMode.line',
            Full: 'logmagnifier.cycleFilterHighlightMode.full',
        },

        CycleFilterCaseSensitivity: {
            On: 'logmagnifier.cycleFilterCaseSensitivity.on',
            Off: 'logmagnifier.cycleFilterCaseSensitivity.off',
        },

        CycleFilterType: {
            Include: 'logmagnifier.cycleFilterType.include',
            Exclude: 'logmagnifier.cycleFilterType.exclude',
        },

        NextMatch: 'logmagnifier.nextMatch',
        PreviousMatch: 'logmagnifier.previousMatch',

        CycleFilterContextLine: {
            None: 'logmagnifier.cycleFilterContextLine.cl0',
            PlusMinus3: 'logmagnifier.cycleFilterContextLine.cl3',
            PlusMinus5: 'logmagnifier.cycleFilterContextLine.cl5',
            PlusMinus9: 'logmagnifier.cycleFilterContextLine.cl9',
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

        SetPrependLineNumbers: {
            Enable: 'logmagnifier.setPrependLineNumbers.enable',
            Disable: 'logmagnifier.setPrependLineNumbers.disable',
        },

        ToggleWordWrap: 'logmagnifier.toggleWordWrap',
        ToggleMinimap: 'logmagnifier.toggleMinimap',
        ToggleStickyScroll: 'logmagnifier.toggleStickyScroll',
        ToggleJsonPreview: 'logmagnifier.toggleJsonPreview',
        ToggleOccurrencesHighlight: 'logmagnifier.toggleOccurrencesHighlight',
        ToggleFileSizeUnit: 'logmagnifier.toggleFileSizeUnit',

        ExportTextFilters: 'logmagnifier.exportTextFilters',
        ImportTextFilters: 'logmagnifier.importTextFilters',
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
        PickAndLaunchInstalledApp: 'logmagnifier.pickAndLaunchInstalledApp',

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
        OpenChromeInspect: 'logmagnifier.openChromeInspect',
        ClearAllData: 'logmagnifier.clearAllData',
        ClearTextFilterData: 'logmagnifier.clearTextFilterData',
        ClearRegexFilterData: 'logmagnifier.clearRegexFilterData',
        ClearBookmarkData: 'logmagnifier.clearBookmarkData',
        ClearWorkflowData: 'logmagnifier.clearWorkflowData',
        ClearRunbookData: 'logmagnifier.clearRunbookData',

        ControlAppLaunch: 'logmagnifier.adb.controlApp.launch',
        ControlAppMore: 'logmagnifier.adb.controlApp.more',
        ControlDeviceMore: 'logmagnifier.adb.controlDevice.more',

        // Workflow
        WorkflowOpenResult: 'logmagnifier.workflow.openResult',
        WorkflowImport: 'logmagnifier.workflow.import',
        WorkflowExport: 'logmagnifier.workflow.export',
        WorkflowRun: 'logmagnifier.workflow.run',
        WorkflowRunActive: 'logmagnifier.workflow.runActive',
        WorkflowSetActive: 'logmagnifier.workflow.setActive',
        WorkflowCreate: 'logmagnifier.workflow.create',
        WorkflowRename: 'logmagnifier.workflow.rename',
        WorkflowOpenAllResults: 'logmagnifier.workflow.openAllResults',
        WorkflowCloseAllResults: 'logmagnifier.workflow.closeAllResults',

        // Filter execution
        RunFilterGroup: 'logmagnifier.runFilterGroup',

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
            Strikethrough: 'logmagnifier.setExcludeStyle.strikethrough',
            Hidden: 'logmagnifier.setExcludeStyle.hidden',
        },

        // Aliases / Shortcuts
        CreateTextFilter: 'logmagnifier.createTextFilter',
        CreateRegexFilter: 'logmagnifier.createRegexFilter',
        DeleteGroup: 'logmagnifier.deleteGroup',
        RenameFilterGroup: 'logmagnifier.renameFilterGroup',
        ExportGroup: 'logmagnifier.exportGroup',
        EditFilterItem: 'logmagnifier.editFilterItem',
        AddSelectionToTextFilter: 'logmagnifier.addSelectionToTextFilter',
        RemoveMatchesWithSelection: 'logmagnifier.removeMatchesWithSelection',
        ExpandAllTextGroups: 'logmagnifier.expandAllTextGroups',
        CollapseAllTextGroups: 'logmagnifier.collapseAllTextGroups',
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

        // File Hierarchy Navigation
        HierarchyOpenParent: 'logmagnifier.hierarchy.openParent',
        HierarchyOpenOriginal: 'logmagnifier.hierarchy.openOriginal',
        HierarchyShowQuickPick: 'logmagnifier.hierarchy.showQuickPick',
        HierarchyShowFullTree: 'logmagnifier.hierarchy.showFullTree',

        // Runbook
        RunbookOpenWebview: 'logmagnifier.runbook.openWebview',
        RunbookEditMarkdown: 'logmagnifier.runbook.editMarkdown',
        RunbookAddGroup: 'logmagnifier.runbook.addGroup',
        RunbookAddItem: 'logmagnifier.runbook.addItem',
        RunbookDeleteGroup: 'logmagnifier.runbook.deleteGroup',
        RunbookDeleteItem: 'logmagnifier.runbook.deleteItem',
        RunbookRenameGroup: 'logmagnifier.runbook.renameGroup',
        RunbookRenameItem: 'logmagnifier.runbook.renameItem',
        RunbookExport: 'logmagnifier.runbook.export',
        RunbookImport: 'logmagnifier.runbook.import',
        RefreshRunbookView: 'logmagnifier.refreshRunbookView',

        // Timestamp / Time Range
        TimeRangeJumpToLine: 'logmagnifier.timeRange.jumpToLine',
        TimeRangeInclude: 'logmagnifier.timeRange.include',
        TimeRangeIncludeWithMargin: 'logmagnifier.timeRange.includeWithMargin',
        TimeRangeTrimBefore: 'logmagnifier.timeRange.trimBefore',
        TimeRangeTrimAfter: 'logmagnifier.timeRange.trimAfter',
        TimeRangeTrimBeforeLine: 'logmagnifier.timeRange.trimBeforeLine',
        TimeRangeTrimAfterLine: 'logmagnifier.timeRange.trimAfterLine',
        TimestampGotoTime: 'logmagnifier.timestamp.gotoTime',
    },

    Views: {
        Container: 'logmagnifier-container',
        Dashboard: 'logmagnifier-quick-access',
        TextFilters: 'logmagnifier-text-filters',
        RegexFilters: 'logmagnifier-regex-filters',
        Runbook: 'logmagnifier-runbook',
        Workflow: 'logmagnifier-workflow',
        TimeRange: 'logmagnifier-time-range',
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
            EnablePublicIpLookup: 'adbEnablePublicIpLookup',
        },
        Timestamp: {
            Enabled: 'timestamp.enabled',
            AutoDetect: 'timestamp.autoDetect',
            CustomPatterns: 'timestamp.customPatterns',
            GapThreshold: 'timestamp.gapThreshold',
        },
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
        ShellConfigPaths: 'logmagnifier.shellConfigPaths',
        Bookmarks: 'logmagnifier.bookmarks',
        BookmarkIncludeLnMap: 'logmagnifier.bookmarks_include_ln_map',
        BookmarkWordWrap: 'logmagnifier.bookmarks_wordWrap',
        BookmarkFileOrder: 'logmagnifier.bookmarks_fileOrder',
        Workflows: 'logmagnifier.workflows',
        ActiveWorkflow: 'logmagnifier.activeWorkflow',
    },

    Defaults: {
        TempFilePrefix: 'filtered_',
        AdbPath: 'adb',
        AdbDefaultOptions: '-v threadtime',
        LargeFileSizeLimitMB: 50,
        ContextLineLevels: [0, 3, 5, 9] as readonly number[],
        MaxPatternLength: 500,
        MaxNameLength: 100,
        FlashDurationMs: 500,
        NavigationWindowMs: 10_000,
        ChunkedProcessingThreshold: 5_000,
        RegexCacheSize: 500,
        DecorationCacheSize: 1_000,
    },
} as const;
