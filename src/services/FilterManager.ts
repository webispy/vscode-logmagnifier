import * as vscode from 'vscode';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';

// Solarized-inspired and distinct colors for highlights
// Solarized-inspired and distinct colors for highlights
// Solarized-inspired and distinct colors for highlights
export interface ColorPreset {
    name: string;
    dark: string;
    light: string;
    icon: string; // Hex for UI
}

const COLOR_PRESETS: ColorPreset[] = [
    { name: 'Red', dark: 'rgba(220, 50, 47, 0.4)', light: 'rgba(220, 50, 47, 0.3)', icon: '#dc322f' },
    { name: 'Orange', dark: 'rgba(203, 75, 22, 0.4)', light: 'rgba(203, 75, 22, 0.3)', icon: '#cb4b16' },
    { name: 'Yellow', dark: 'rgba(181, 137, 0, 0.4)', light: 'rgba(181, 137, 0, 0.3)', icon: '#b58900' },
    { name: 'Green', dark: 'rgba(133, 153, 0, 0.4)', light: 'rgba(133, 153, 0, 0.3)', icon: '#859900' },
    { name: 'Cyan', dark: 'rgba(42, 161, 152, 0.4)', light: 'rgba(42, 161, 152, 0.3)', icon: '#2aa198' },
    { name: 'Blue', dark: 'rgba(38, 139, 210, 0.4)', light: 'rgba(38, 139, 210, 0.3)', icon: '#268bd2' },
    { name: 'Violet', dark: 'rgba(108, 113, 196, 0.4)', light: 'rgba(108, 113, 196, 0.3)', icon: '#6c71c4' },
    { name: 'Magenta', dark: 'rgba(211, 54, 130, 0.4)', light: 'rgba(211, 54, 130, 0.3)', icon: '#d33682' },

    // Additional 8 colors
    { name: 'Lime', dark: 'rgba(128, 255, 0, 0.4)', light: 'rgba(50, 205, 50, 0.3)', icon: '#32cd32' },
    { name: 'Teal', dark: 'rgba(0, 128, 128, 0.4)', light: 'rgba(0, 128, 128, 0.3)', icon: '#008080' },
    { name: 'Sky', dark: 'rgba(135, 206, 235, 0.4)', light: 'rgba(0, 191, 255, 0.3)', icon: '#87ceeb' },
    { name: 'Indigo', dark: 'rgba(75, 0, 130, 0.4)', light: 'rgba(75, 0, 130, 0.2)', icon: '#4b0082' },
    { name: 'Pink', dark: 'rgba(255, 105, 180, 0.4)', light: 'rgba(255, 105, 180, 0.3)', icon: '#ff69b4' },
    { name: 'Brown', dark: 'rgba(165, 42, 42, 0.4)', light: 'rgba(165, 42, 42, 0.3)', icon: '#a52a2a' },
    { name: 'Slate', dark: 'rgba(112, 128, 144, 0.4)', light: 'rgba(112, 128, 144, 0.3)', icon: '#708090' },
    { name: 'Emerald', dark: 'rgba(0, 201, 87, 0.4)', light: 'rgba(0, 201, 87, 0.3)', icon: '#00c957' }
];

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export class FilterManager {
    private groups: FilterGroup[] = [];
    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;

    constructor() {
        this.initDefaultFilters();
    }

    private initDefaultFilters(): void {
        const featuredGroup = this.addGroup('Presets', true);
        featuredGroup.isEnabled = true;

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
        return COLOR_PRESETS.map(p => p.name);
    }

    public getColorPresets(): ColorPreset[] {
        return COLOR_PRESETS;
    }

    public getPresetByName(name: string): ColorPreset | undefined {
        return COLOR_PRESETS.find(p => p.name === name);
    }

    public addGroup(name: string, isRegex: boolean = false): FilterGroup {
        const newGroup: FilterGroup = {
            id: generateId(),
            name,
            filters: [],
            isEnabled: false,
            isRegex
        };
        this.groups.push(newGroup);
        this._onDidChangeFilters.fire();
        return newGroup;
    }

    public addFilter(groupId: string, keyword: string, type: FilterType, isRegex: boolean = false, nickname?: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const newFilter: FilterItem = {
                id: generateId(),
                keyword,
                type,
                isEnabled: true,
                isRegex,
                nickname,
                color: (!isRegex && type === 'include') ? this.assignColor(group) : undefined
            };
            group.filters.push(newFilter);
            this._onDidChangeFilters.fire();
        }
    }

    private assignColor(group: FilterGroup): string {
        const usedColors = new Set(
            group.filters
                .filter(f => f.color)
                .map(f => f.color)
        );

        // Find first unused color
        const availableColor = COLOR_PRESETS.find(c => !usedColors.has(c.name));
        if (availableColor) {
            return availableColor.name;
        }

        // If all used, pick random from presets
        return COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)].name;
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
                filter.enableFullLineHighlight = !filter.enableFullLineHighlight;
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

    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this._onDidChangeFilters.fire();
        }
    }

    public removeGroup(groupId: string): void {
        this.groups = this.groups.filter(g => g.id !== groupId);
        this._onDidChangeFilters.fire();
    }

    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this._onDidChangeFilters.fire();
        }
    }

    public toggleFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.isEnabled = !filter.isEnabled;
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
}
