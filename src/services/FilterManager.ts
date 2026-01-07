import * as vscode from 'vscode';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';
import { Logger } from './Logger';

// Solarized-inspired and distinct colors for highlights
export interface ColorPreset {
    id: string; // color1 ~ color16
    dark: string;
    light: string;
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export class FilterManager {
    private groups: FilterGroup[] = [];
    private colorPresets: ColorPreset[] = [];
    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;

    private _onDidChangeResultCounts: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeResultCounts: vscode.Event<void> = this._onDidChangeResultCounts.event;

    private logger: Logger;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.loadColorPresets();
        this.loadFromState();
        this.initDefaultFilters();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('logmagnifier.highlightColors')) {
                this.loadColorPresets();
                this._onDidChangeFilters.fire();
            }
        });
    }

    private loadFromState() {
        const savedGroups = this.context.globalState.get<FilterGroup[]>('logmagnifier.filterGroups');
        if (savedGroups && Array.isArray(savedGroups)) {
            this.groups = savedGroups;
            this.logger.info(`Loaded ${this.groups.length} filter groups from state.`);
        }
    }

    private saveToState() {
        this.context.globalState.update('logmagnifier.filterGroups', this.groups);
    }

    private loadColorPresets() {
        const config = vscode.workspace.getConfiguration('logmagnifier.highlightColors');
        const presets: ColorPreset[] = [];

        this.logger.info('Loading color presets...');

        // Load all defined color presets from configuration (package.json provides defaults)
        for (let i = 1; i <= 16; i++) {
            const id = `color${i.toString().padStart(2, '0')}`;
            const colorConfig = config.get<{ dark: string, light: string }>(id);
            const inspection = config.inspect<{ dark: string, light: string }>(id);

            const userValue = inspection?.workspaceFolderValue || inspection?.workspaceValue || inspection?.globalValue;
            const isUserDefined = userValue !== undefined;
            const isCompleteUserValue = isUserDefined && userValue?.dark && userValue?.light;

            if (colorConfig && colorConfig.dark && colorConfig.light) {
                let source = 'Default';
                if (isCompleteUserValue) {
                    source = 'User setting';
                } else if (isUserDefined) {
                    source = 'Partial (Default fallback)';
                    this.logger.error(`Invalid/Partial user setting for color preset: ${id}. It should have both "dark" and "light" properties. Falling back to defaults for missing keys.`);
                }

                this.logger.info(`Loaded color preset: ${id} (${source}) - dark: ${colorConfig.dark}, light: ${colorConfig.light}`);

                presets.push({
                    id,
                    dark: colorConfig.dark,
                    light: colorConfig.light
                });
            } else {
                // This case handles where even the merged value is invalid (shouldn't happen with defaults)
                if (isUserDefined) {
                    this.logger.error(`Invalid user setting for color preset: ${id}. It must be an object with both "dark" and "light" color strings.`);
                } else {
                    this.logger.warn(`Missing or invalid default configuration for color preset: ${id}`);
                }
            }
        }

        if (presets.length > 0) {
            this.colorPresets = presets;
        } else {
            this.logger.error('No color presets found in configuration.');
        }
    }

    private initDefaultFilters(): void {
        if (this.groups.length > 0) {
            return;
        }
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
        return this.colorPresets.map(p => p.id);
    }

    public getColorPresets(): ColorPreset[] {
        return this.colorPresets;
    }

    public getPresetById(id: string): ColorPreset | undefined {
        return this.colorPresets.find(p => p.id === id);
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
        this.saveToState();
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
            this.saveToState();
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
        const availableColor = this.colorPresets.find(c => !usedColors.has(c.id));
        if (availableColor) {
            return availableColor.id;
        }

        // If all used, pick random from presets
        return this.colorPresets[Math.floor(Math.random() * this.colorPresets.length)].id;
    }

    public updateFilterColor(groupId: string, filterId: string, color: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.color = color;
                this.saveToState();
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
                this.saveToState();
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
                this.saveToState();
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
                this.saveToState();
                this._onDidChangeFilters.fire();
            }
        }
    }

    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this.logger.info(`Filter removed from group '${group.name}': ${filterId}`);
            this.saveToState();
            this._onDidChangeFilters.fire();
        }
    }

    public removeGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            this.groups = this.groups.filter(g => g.id !== groupId);
            this.logger.info(`Filter group removed: ${group.name}`);
            this.saveToState();
            this._onDidChangeFilters.fire();
        }
    }

    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this.logger.info(`Filter group '${group.name}' ${group.isEnabled ? 'enabled' : 'disabled'}`);
            this.saveToState();
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
                this.saveToState();
                this._onDidChangeFilters.fire();
            }
        }
    }

    public toggleFilterType(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.type = filter.type === 'include' ? 'exclude' : 'include';

                // If switching to include and color is missing, assign one
                if (filter.type === 'include' && !filter.color) {
                    filter.color = this.assignColor(group);
                }

                this.logger.info(`Filter '${filter.keyword}' type toggled to: ${filter.type}`);
                this.saveToState();
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
                this.saveToState();
                this._onDidChangeFilters.fire();
            }
        }
    }

    public exportFilters(mode: 'word' | 'regex'): string {
        const groupsToExport = this.groups
            .filter(g => mode === 'regex' ? g.isRegex : !g.isRegex)
            .map(g => {
                const { resultCount, id, ...rest } = g;
                return {
                    ...rest,
                    filters: g.filters.map(f => {
                        const { resultCount: itemResultCount, id: itemId, ...itemRest } = f;
                        return itemRest;
                    })
                };
            });

        const exportData = {
            version: this.context.extension.packageJSON.version,
            groups: groupsToExport
        };

        this.logger.info(`Exporting ${groupsToExport.length} ${mode} filter groups (v${exportData.version}).`);
        return JSON.stringify(exportData, null, 4);
    }

    public importFilters(json: string, mode: 'word' | 'regex', overwrite: boolean): { count: number, error?: string } {
        this.logger.info(`Starting ${mode} filters import (Overwrite: ${overwrite})...`);
        try {
            const parsedData = JSON.parse(json);

            let importedGroups: FilterGroup[] = [];
            let importedVersion: string | undefined;

            if (typeof parsedData === 'object' && parsedData !== null && Array.isArray(parsedData.groups)) {
                // New format: Root is object with version and groups
                importedGroups = parsedData.groups;
                importedVersion = parsedData.version;
                this.logger.info(`Detected import data (Version: ${importedVersion || 'unknown'}).`); // Removed "new" as it's the only one
            } else {
                throw new Error('Invalid filter data format: expected an object with a "groups" array. Legacy array format is no longer supported.');
            }

            this.logger.info(`Importing ${importedGroups.length} groups from JSON.`);

            if (overwrite) {
                this.groups = this.groups.filter(g => mode === 'regex' ? !g.isRegex : !!g.isRegex);
            }

            let addedCount = 0;
            for (const group of importedGroups) {
                // Validate group and ensure it matches the mode
                if (!!group.isRegex !== (mode === 'regex')) {
                    continue;
                }

                // If not overwriting, we might want to ensure unique names or just append.
                // Usually append with a new ID is safer.
                const newGroupId = generateId();
                const newGroup: FilterGroup = {
                    ...group,
                    id: newGroupId,
                    filters: group.filters.map(f => ({
                        ...f,
                        id: generateId()
                    }))
                };

                this.groups.push(newGroup);
                addedCount++;
            }

            if (addedCount > 0) {
                this.saveToState();
                this._onDidChangeFilters.fire();
            }

            this.logger.info(`Import completed: ${addedCount} ${mode} filter groups added.`);
            return { count: addedCount };
        } catch (e: any) {
            this.logger.error(`Import failed: ${e.message}`);
            return { count: 0, error: e.message };
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
