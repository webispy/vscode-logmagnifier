import * as vscode from 'vscode';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';
import { Logger } from './Logger';

// Solarized-inspired and distinct colors for highlights
export interface ColorPreset {
    id: string; // color1 ~ color16
    dark: string;
    light: string;
}

const COLOR_PRESETS: ColorPreset[] = [
    { id: 'color1', dark: 'rgba(220, 50, 47, 0.4)', light: 'rgba(220, 50, 47, 0.3)' }, // Red
    { id: 'color2', dark: 'rgba(38, 139, 210, 0.4)', light: 'rgba(38, 139, 210, 0.3)' }, // Blue
    { id: 'color3', dark: 'rgba(255, 140, 0, 0.4)', light: 'rgba(255, 140, 0, 0.3)' }, // Orange
    { id: 'color4', dark: 'rgba(133, 153, 0, 0.4)', light: 'rgba(133, 153, 0, 0.3)' }, // Green
    { id: 'color5', dark: 'rgba(108, 113, 196, 0.4)', light: 'rgba(108, 113, 196, 0.3)' }, // Violet
    { id: 'color6', dark: 'rgba(255, 215, 0, 0.4)', light: 'rgba(255, 215, 0, 0.3)' }, // Yellow
    { id: 'color7', dark: 'rgba(42, 161, 152, 0.4)', light: 'rgba(42, 161, 152, 0.3)' }, // Cyan
    { id: 'color8', dark: 'rgba(255, 0, 255, 0.4)', light: 'rgba(255, 0, 255, 0.3)' }, // Magenta
    { id: 'color9', dark: 'rgba(50, 205, 50, 0.4)', light: 'rgba(50, 205, 50, 0.3)' }, // Lime
    { id: 'color10', dark: 'rgba(75, 0, 130, 0.4)', light: 'rgba(75, 0, 130, 0.2)' }, // Indigo
    { id: 'color11', dark: 'rgba(255, 105, 180, 0.4)', light: 'rgba(255, 105, 180, 0.3)' }, // Pink
    { id: 'color12', dark: 'rgba(0, 150, 136, 0.4)', light: 'rgba(0, 150, 136, 0.3)' }, // Teal
    { id: 'color13', dark: 'rgba(139, 69, 19, 0.4)', light: 'rgba(139, 69, 19, 0.3)' }, // Brown
    { id: 'color14', dark: 'rgba(0, 191, 255, 0.4)', light: 'rgba(0, 191, 255, 0.3)' }, // Sky
    { id: 'color15', dark: 'rgba(106, 90, 205, 0.4)', light: 'rgba(106, 90, 205, 0.3)' }, // Slate
    { id: 'color16', dark: 'rgba(46, 204, 113, 0.4)', light: 'rgba(46, 204, 113, 0.3)' }  // Emerald
];

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export class FilterManager {
    private groups: FilterGroup[] = [];
    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;

    private _onDidChangeResultCounts: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeResultCounts: vscode.Event<void> = this._onDidChangeResultCounts.event;

    private logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
        this.initDefaultFilters();
    }

    private initDefaultFilters(): void {
        const featuredGroup = this.addGroup('Presets', true);
        if (!featuredGroup) {
            return;
        }
        featuredGroup.isEnabled = false;

        this.addFilter(
            featuredGroup.id,
            '^\\d{2}-\\d{2}\\s\\d{2}:\\d{2}:\\d{2}\\.\\d{3}',
            'include',
            true,
            'Logcat style'
        );

        this.addFilter(
            featuredGroup.id,
            '^\\s*\\d+\\s+\\d+\\s+[a-zA-Z_]\\S*\\s+\\S+\\s+-?\\d+',
            'include',
            true,
            'Process Info'
        );
    }

    public getGroups(): FilterGroup[] {
        return this.groups;
    }

    public getAvailableColors(): string[] {
        return COLOR_PRESETS.map(p => p.id);
    }

    public getColorPresets(): ColorPreset[] {
        return COLOR_PRESETS;
    }

    public getPresetById(id: string): ColorPreset | undefined {
        return COLOR_PRESETS.find(p => p.id === id);
    }

    public addGroup(name: string, isRegex: boolean = false): FilterGroup | undefined {
        const exists = this.groups.some(g => g.name.toLowerCase() === name.toLowerCase() && !!g.isRegex === !!isRegex);
        if (exists) {
            return undefined;
        }

        const newGroup: FilterGroup = {
            id: generateId(),
            name,
            filters: [],
            isEnabled: false,
            isRegex
        };
        this.groups.push(newGroup);
        this.logger.info(`Filter group added: ${name} (Regex: ${isRegex})`);
        this._onDidChangeFilters.fire();
        return newGroup;
    }

    public addFilter(groupId: string, keyword: string, type: FilterType, isRegex: boolean = false, nickname?: string): FilterItem | undefined {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const exists = group.filters.some(f => {
                if (isRegex) {
                    return f.keyword === keyword && f.nickname === nickname;
                }
                return f.keyword.toLowerCase() === keyword.toLowerCase() && f.type === type;
            });

            if (exists) {
                return undefined;
            }

            const newFilter: FilterItem = {
                id: generateId(),
                keyword,
                type,
                isEnabled: true,
                isRegex,
                nickname,
                color: (!isRegex && type === 'include') ? this.assignColor(group) : undefined,
                contextLine: 0
            };
            group.filters.push(newFilter);
            this.logger.info(`Filter added to group '${group.name}': ${keyword} (Type: ${type}, Regex: ${isRegex})`);
            this._onDidChangeFilters.fire();
            return newFilter;
        }
        return undefined;
    }

    private assignColor(group: FilterGroup): string {
        const usedColors = new Set(
            group.filters
                .filter(f => f.color)
                .map(f => f.color)
        );

        // Find first unused color
        const availableColor = COLOR_PRESETS.find(c => !usedColors.has(c.id));
        if (availableColor) {
            return availableColor.id;
        }

        // If all used, pick random from presets
        return COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)].id;
    }

    public updateFilterColor(groupId: string, filterId: string, color: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.color = color;
                this._onDidChangeFilters.fire();
            }
        }
    }

    public toggleFilterHighlightMode(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                // If it was the old boolean flag, migrate it
                if (filter.highlightMode === undefined) {
                    filter.highlightMode = (filter as any).enableFullLineHighlight ? 1 : 0;
                    delete (filter as any).enableFullLineHighlight;
                }

                // Cycle: 0 (Word) -> 1 (Line) -> 2 (Whole Line) -> 0
                filter.highlightMode = (filter.highlightMode + 1) % 3;
                this._onDidChangeFilters.fire();
            }
        }
    }

    public toggleFilterCaseSensitivity(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.caseSensitive = !filter.caseSensitive;
                this._onDidChangeFilters.fire();
            }
        }
    }

    public toggleFilterContextLine(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                const levels = [0, 3, 5, 9];
                const currentIndex = levels.indexOf(filter.contextLine ?? 0);
                const nextIndex = (currentIndex + 1) % levels.length;
                filter.contextLine = levels[nextIndex];
                this._onDidChangeFilters.fire();
            }
        }
    }

    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this.logger.info(`Filter removed from group '${group.name}': ${filterId}`);
            this._onDidChangeFilters.fire();
        }
    }

    public removeGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            this.groups = this.groups.filter(g => g.id !== groupId);
            this.logger.info(`Filter group removed: ${group.name}`);
            this._onDidChangeFilters.fire();
        }
    }

    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this.logger.info(`Filter group '${group.name}' ${group.isEnabled ? 'enabled' : 'disabled'}`);
            this._onDidChangeFilters.fire();
        }
    }

    public toggleFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.isEnabled = !filter.isEnabled;
                this.logger.info(`Filter '${filter.keyword}' in group '${group.name}' ${filter.isEnabled ? 'enabled' : 'disabled'}`);
                this._onDidChangeFilters.fire();
            }
        }
    }

    public moveFilter(groupId: string, activeFilterId: string, targetFilterId: string, position: 'before' | 'after'): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const activeIndex = group.filters.findIndex(f => f.id === activeFilterId);
            const targetIndex = group.filters.findIndex(f => f.id === targetFilterId);

            if (activeIndex !== -1 && targetIndex !== -1 && activeIndex !== targetIndex) {
                const [activeFilter] = group.filters.splice(activeIndex, 1);

                // If we removed an item before the target, the target index shifts down by 1
                let newTargetIndex = group.filters.findIndex(f => f.id === targetFilterId);

                if (position === 'after') {
                    newTargetIndex++;
                }

                group.filters.splice(newTargetIndex, 0, activeFilter);
                this._onDidChangeFilters.fire();
            }
        }
    }

    public updateResultCounts(counts: { filterId: string, count: number }[], groupCounts: { groupId: string, count: number }[]): void {
        let changed = false;
        for (const group of this.groups) {
            const gCount = groupCounts.find(c => c.groupId === group.id);
            if (gCount !== undefined && group.resultCount !== gCount.count) {
                group.resultCount = gCount.count;
                changed = true;
            }

            for (const filter of group.filters) {
                const fCount = counts.find(c => c.filterId === filter.id);
                if (fCount !== undefined && filter.resultCount !== fCount.count) {
                    filter.resultCount = fCount.count;
                    changed = true;
                }
            }
        }

        if (changed) {
            this._onDidChangeResultCounts.fire();
        }
    }
}
