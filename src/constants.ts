/**
 * Centralized constants for the extension.
 * These values MUST match the definitions in package.json.
 */

export const Constants = {
    ExtensionId: 'logmagnifier',

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

        TogglePrependLineNumbers: {
            Enable: 'logmagnifier.togglePrependLineNumbers.enable',
            Disable: 'logmagnifier.togglePrependLineNumbers.disable',
        },

        ToggleWordWrap: 'logmagnifier.toggleWordWrap',
        ToggleMinimap: 'logmagnifier.toggleMinimap',
        ToggleStickyScroll: 'logmagnifier.toggleStickyScroll',
        ToggleFileSizeUnit: 'logmagnifier.toggleFileSizeUnit',

        ExportWordFilters: 'logmagnifier.exportWordFilters',
        ImportWordFilters: 'logmagnifier.importWordFilters',
        ExportRegexFilters: 'logmagnifier.exportRegexFilters',
        ImportRegexFilters: 'logmagnifier.importRegexFilters',
    },

    Views: {
        Container: 'logmagnifier-container',
        QuickAccess: 'logmagnifier-quick-access',
        Filters: 'logmagnifier-filters',
        RegexFilters: 'logmagnifier-regex-filters',
    },

    Configuration: {
        Section: 'logmagnifier',
        TempFilePrefix: 'tempFilePrefix', // relative to section
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
        Editor: {
            Section: 'editor',
            WordWrap: 'wordWrap',
            MinimapEnabled: 'minimap.enabled',
            StickyScrollEnabled: 'stickyScroll.enabled',
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
    },

    FilterTypes: {
        Include: 'include',
        Exclude: 'exclude',
    },

    ContextKeys: {
        PrependLineNumbersEnabled: 'logmagnifier.prependLineNumbersEnabled',
    },

    GlobalState: {
        FilterGroups: 'logmagnifier.filterGroups',
    },

    Labels: {
        WordWrap: 'Word Wrap',
        Minimap: 'Minimap',
        StickyScroll: 'Sticky Scroll',
        FileSize: 'File Size',
        Bytes: 'Bytes',
        KB: 'KB',
        MB: 'MB',
        NA: 'N/A',
    },

    ImportModes: {
        Merge: 'Merge (Add to existing)',
        Overwrite: 'Overwrite (Replace existing)',
    },

    ExtensionDisplayName: 'LogMagnifier',

    // Add other constants as needed
};
