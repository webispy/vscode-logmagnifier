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
}

export interface FilterGroup {
    id: string;
    name: string;
    filters: FilterItem[];
    isEnabled: boolean;
    isRegex?: boolean;
}
