export type FilterType = 'include' | 'exclude';

export interface FilterItem {
    id: string;
    keyword: string;
    type: FilterType;
    isEnabled: boolean;
    isRegex?: boolean;
    nickname?: string;
    color?: string;
    enableFullLineHighlight?: boolean;
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
