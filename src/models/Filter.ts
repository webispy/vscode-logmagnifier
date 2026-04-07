export type FilterType = 'include' | 'exclude';

export enum HighlightMode {
    Word = 0,
    Line = 1,
    FullLine = 2,
}

/** A single text or regex filter within a group. */
export interface FilterItem {
    id: string;
    pattern: string;
    type: FilterType;
    isEnabled: boolean;
    isRegex?: boolean;
    nickname?: string;
    color?: string;
    highlightMode?: HighlightMode;
    caseSensitive?: boolean;
    resultCount?: number;
    contextLines?: number; // 0, 3, 5, 9
    excludeStyle?: 'strikethrough' | 'hidden'; // Default: strikethrough
}

/** A named collection of filters that can be toggled as a unit. */
export interface FilterGroup {
    id: string;
    name: string;
    filters: FilterItem[];
    isEnabled: boolean;
    isRegex?: boolean;
    resultCount?: number;
    isExpanded?: boolean; // UI state persistence
}

export function isFilterGroup(item: unknown): item is FilterGroup {
    return typeof item === 'object' && item !== null && 'filters' in item && Array.isArray(item.filters);
}
