export type FilterType = 'include' | 'exclude';

export enum HighlightMode {
    Word = 0,
    Line = 1,
    FullLine = 2,
}

export interface FilterItem {
    id: string;
    keyword: string;
    type: FilterType;
    isEnabled: boolean;
    isRegex?: boolean;
    nickname?: string;
    color?: string;
    highlightMode?: HighlightMode;
    caseSensitive?: boolean;
    resultCount?: number;
    contextLine?: number; // 0, 3, 5, 9
    excludeStyle?: 'line-through' | 'hidden'; // Default: line-through
}

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
    return typeof item === 'object' && item !== null && Array.isArray((item as FilterGroup).filters);
}
