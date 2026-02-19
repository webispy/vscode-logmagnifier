export const Ids = {
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
        OpenChromeInspect: 'logmagnifier.openChromeInspect',
        ClearAllData: 'logmagnifier.clearAllData',

        ControlAppLaunch: 'logmagnifier.adb.controlApp.launch',
        ControlAppMore: 'logmagnifier.adb.controlApp.more',
        ControlDeviceMore: 'logmagnifier.adb.controlDevice.more',

        // Workflow
        WorkflowOpenResult: 'logmagnifier.workflow.openResult',
        WorkflowImport: 'logmagnifier.workflow.import',
        WorkflowExport: 'logmagnifier.workflow.export',
        WorkflowRun: 'logmagnifier.workflow.run',

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

        // File Hierarchy Navigation
        HierarchyOpenParent: 'logmagnifier.hierarchy.openParent',
        HierarchyOpenOriginal: 'logmagnifier.hierarchy.openOriginal',
        HierarchyShowQuickPick: 'logmagnifier.hierarchy.showQuickPick',
        HierarchyShowFullTree: 'logmagnifier.hierarchy.showFullTree',

        // Shell Commander
        AddShellGroup: 'logmagnifier.addShellGroup',
        ImportShellGroup: 'logmagnifier.importShellGroup',
        ExportShellGroup: 'logmagnifier.exportShellGroup',
        AddShellFolder: 'logmagnifier.addShellFolder',
        AddShellCommand: 'logmagnifier.addShellCommand',
        ExecuteShellCommand: 'logmagnifier.executeShellCommand',
        EditShellItem: 'logmagnifier.editShellItem',
        DeleteShellItem: 'logmagnifier.deleteShellItem',
        RefreshShellView: 'logmagnifier.refreshShellView',
        ExpandAllShellGroups: 'logmagnifier.expandAllShellGroups',
        CollapseAllShellGroups: 'logmagnifier.collapseAllShellGroups',
        ReloadShellCommander: 'logmagnifier.reloadShellCommander',
        ClearAllShellConfigs: 'logmagnifier.clearAllShellConfigs',
        OpenShellGroupConfig: 'logmagnifier.openShellGroupConfig',
        EditShellDescription: 'logmagnifier.editShellDescription',
        EditShellGroupReadme: 'logmagnifier.editShellGroupReadme',
        RenameShellGroup: 'logmagnifier.renameShellGroup',
        RenameShellFolder: 'logmagnifier.renameShellFolder',
        RenameShellCommand: 'logmagnifier.renameShellCommand',
        OpenGlobalShellConfig: 'logmagnifier.openGlobalShellConfig',
        HandleShellKey: 'logmagnifier.shellCommander.handleKey',
    },

    ShellCommander: {
        DefaultConfigFilename: 'logmagnifier_shell_cmds.json',
        GlobalTerminalKey: '__GLOBAL_SHELL_COMMANDER__',
        GlobalTerminalName: 'Shell: Commander',
        TerminalReuseStrategyDefault: 'perFolder',
        TerminalReuseStrategySetting: 'shellCommander.terminalReuseStrategy',
        InterruptChar: '\u0003',
        InterruptDelayMs: 200,
    },

    Views: {
        Container: 'logmagnifier-container',
        QuickAccess: 'logmagnifier-quick-access',
        Filters: 'logmagnifier-filters',
        RegexFilters: 'logmagnifier-regex-filters',
        ShellCommander: 'logmagnifier-shell-commander',
        Workflow: 'logmagnifier-workflow',
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
    },
} as const;
