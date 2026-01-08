import * as vscode from 'vscode';
import { Constants } from '../constants';
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
            if (e.affectsConfiguration(Constants.Configuration.HighlightColors.Section)) {
                this.loadColorPresets();
                this._onDidChangeFilters.fire();
            }
        });
    }

    private loadFromState() {
        const savedGroups = this.context.globalState.get<FilterGroup[]>(Constants.GlobalState.FilterGroups);
        if (savedGroups && Array.isArray(savedGroups)) {
            this.groups = savedGroups;
            this.logger.info(`Loaded ${this.groups.length} filter groups from state.`);
        }
    }

    private saveToState() {
        this.context.globalState.update(Constants.GlobalState.FilterGroups, this.groups);
    }

    private loadColorPresets() {
        const config = vscode.workspace.getConfiguration(Constants.Configuration.HighlightColors.Section);
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
            isRegex,
            isExpanded: true
        };
        this.groups.push(newGroup);
        this.logger.info(`Filter group added: ${name} (Regex: ${isRegex})`);
        this.saveToState();
        this._onDidChangeFilters.fire();
        return newGroup;
    }

    public setGroupExpanded(groupId: string, expanded: boolean): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group && group.isExpanded !== expanded) {
            group.isExpanded = expanded;
            // We save state, but NO event fired because expansion state change shouldn't trigger a full tree refresh
            // (which would defeat the purpose of tracking UI state, as refresh forces getTreeItem).
            // However, we DO want to persist it.
            this.saveToState();
        }
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
                color: (!isRegex && type === Constants.FilterTypes.Include) ? this.assignColor(group) : undefined,
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

    public renameGroup(groupId: string, newName: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.name = newName;
            this.logger.info(`Filter group renamed to: ${newName}`);
            this.saveToState();
            this._onDidChangeFilters.fire();
        }
    }

    public updateFilter(groupId: string, filterId: string, updates: { keyword?: string, nickname?: string }): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                if (updates.keyword !== undefined) {
                    filter.keyword = updates.keyword;
                }
                if (updates.nickname !== undefined) {
                    filter.nickname = updates.nickname;
                }
                this.logger.info(`Filter '${filter.id}' updated`);
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

    public refresh(): void {
        this._onDidChangeFilters.fire();
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
                // Determine next type
                const nextType = filter.type === 'include' ? 'exclude' : 'include';
                this.setFilterType(groupId, filterId, nextType);
            }
        }
    }

    public setFilterType(groupId: string, filterId: string, type: FilterType): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                if (filter.type !== type) {
                    filter.type = type;

                    // If switching to include and color is missing, assign one
                    if (filter.type === 'include' && !filter.color) {
                        filter.color = this.assignColor(group);
                    }

                    this.logger.info(`Filter '${filter.keyword}' type set to: ${filter.type}`);
                    this.saveToState();
                    this._onDidChangeFilters.fire();
                }
            }
        }
    }

    public setFilterCaseSensitivity(groupId: string, filterId: string, enable: boolean): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                if (filter.caseSensitive !== enable) {
                    filter.caseSensitive = enable;
                    this.saveToState();
                    this._onDidChangeFilters.fire();
                }
            }
        }
    }

    public setFilterHighlightMode(groupId: string, filterId: string, mode: number): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                // Ensure legacy migration if needed (though unlikely to catch here, good practice)
                if (filter.highlightMode === undefined) {
                    filter.highlightMode = (filter as any).enableFullLineHighlight ? 1 : 0;
                    delete (filter as any).enableFullLineHighlight;
                }

                if (filter.highlightMode !== mode) {
                    filter.highlightMode = mode;
                    this.saveToState();
                    this._onDidChangeFilters.fire();
                }
            }
        }
    }

    public setFilterContextLine(groupId: string, filterId: string, lines: number): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                if (filter.contextLine !== lines) {
                    filter.contextLine = lines;
                    this.saveToState();
                    this._onDidChangeFilters.fire();
                }
            }
        }
    }

    public moveFilter(sourceGroupId: string, targetGroupId: string, activeFilterId: string, targetFilterId: string | undefined, position: 'before' | 'after' | 'append'): void {
        const sourceGroup = this.groups.find(g => g.id === sourceGroupId);
        const targetGroup = this.groups.find(g => g.id === targetGroupId);

        if (!sourceGroup || !targetGroup) {
            return;
        }

        // Cross-mode prevention (Word <-> Regex)
        // Groups must either both be regex or both be non-regex
        if (!!sourceGroup.isRegex !== !!targetGroup.isRegex) {
            this.logger.warn(`Cannot move filter between different modes (Source: ${sourceGroup.isRegex}, Target: ${targetGroup.isRegex})`);
            return;
        }

        const activeIndex = sourceGroup.filters.findIndex(f => f.id === activeFilterId);
        if (activeIndex === -1) {
            return;
        }

        const activeFilter = sourceGroup.filters[activeIndex];

        // If moving to a different group, check for duplicates
        if (sourceGroupId !== targetGroupId) {
            const exists = targetGroup.filters.some(f => {
                if (targetGroup.isRegex) {
                    return f.keyword === activeFilter.keyword && f.nickname === activeFilter.nickname;
                }
                // Check keyword only, ignoring type (as requested by user)
                return f.keyword.toLowerCase() === activeFilter.keyword.toLowerCase();
            });

            if (exists) {
                this.logger.warn(`Cannot move filter: Duplicate exists in target group '${targetGroup.name}'`);
                // Optionally show a UI message? For now, we just abort.
                // Since this is a void method called from drop handler, we can't easily bubble up error message to UI 
                // without changing architecture, but logging is good.
                vscode.window.showWarningMessage(`Filter '${activeFilter.keyword}' already exists in group '${targetGroup.name}'.`);
                return;
            }
        }

        // Remove from source
        sourceGroup.filters.splice(activeIndex, 1);

        // Find insertion point in target
        // If moving within same group, references might need adjustment if using index, 
        // but here we removed first, so indices shifting is handled.
        // Wait, if source == target, and we removed 'activeFilter', 
        // we need to find 'targetFilterId' index in the *modified* array

        // However, if we removed it, 'targetFilterId' might be the one we just removed? No, target is distinct.
        // But if target was *after* active in same group, its index shifted down by 1.
        // Let's rely on finding by ID *after* removal.

        let newTargetIndex = -1;
        if (targetFilterId) {
            newTargetIndex = targetGroup.filters.findIndex(f => f.id === targetFilterId);
        }

        // If appending or target not found (shouldn't happen if ID provided and valid)
        if (position === 'append') {
            targetGroup.filters.push(activeFilter);
        } else {
            if (newTargetIndex !== -1) {
                if (position === 'after') {
                    newTargetIndex++;
                }
                targetGroup.filters.splice(newTargetIndex, 0, activeFilter);
            } else {
                // Fallback to append if target invalid
                targetGroup.filters.push(activeFilter);
            }
        }

        this.saveToState();
        this._onDidChangeFilters.fire();
    }

    public moveGroup(activeGroupId: string, targetGroupId: string | undefined, position: 'before' | 'after' | 'append'): void {
        const activeIndex = this.groups.findIndex(g => g.id === activeGroupId);
        if (activeIndex === -1) {
            return;
        }

        const activeGroup = this.groups[activeIndex];
        const targetGroup = targetGroupId ? this.groups.find(g => g.id === targetGroupId) : undefined;

        // Validation: mode match
        if (targetGroup && !!activeGroup.isRegex !== !!targetGroup.isRegex) {
            this.logger.warn(`Cannot move group between different modes.`);
            return;
        }

        // Remove from current position
        this.groups.splice(activeIndex, 1);

        if (!targetGroupId) {
            // Append to end
            this.groups.push(activeGroup);
        } else {
            // Find index again because splice might have shifted it
            let targetIndex = this.groups.findIndex(g => g.id === targetGroupId);

            if (targetIndex === -1) {
                this.groups.push(activeGroup);
            } else {
                if (position === 'after') {
                    targetIndex++;
                }
                this.groups.splice(targetIndex, 0, activeGroup);
            }
        }

        this.saveToState();
        this._onDidChangeFilters.fire();
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
                    isExpanded: group.isExpanded ?? true,
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
