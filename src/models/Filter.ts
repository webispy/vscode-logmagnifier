export type FilterType = 'include' | 'exclude';

export interface FilterItem {
    id: string;
    keyword: string;
    type: FilterType;
    isEnabled: boolean;
    isRegex?: boolean;
    nickname?: string;
    color?: string;
    highlightMode?: number; // 0: Word, 1: Line, 2: Full Line
    caseSensitive?: boolean;
    resultCount?: number;
}

export interface FilterGroup {
    id: string;
    name: string;
    filters: FilterItem[];
    isEnabled: boolean;
    isRegex?: boolean;
    resultCount?: number;
}
