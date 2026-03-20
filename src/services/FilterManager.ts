import * as crypto from 'crypto';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem, FilterType, HighlightMode } from '../models/Filter';

import { ColorService, ColorPreset } from './ColorService';
import { FilterStateService } from './FilterStateService';
import { Logger } from './Logger';
import { ProfileManager } from './ProfileManager';

export class FilterManager implements vscode.Disposable {
    private static readonly SAVE_DEBOUNCE_MS = 300;

    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;
    private _onDidChangeResultCounts: vscode.EventEmitter<FilterItem | FilterGroup | undefined | void> = new vscode.EventEmitter<FilterItem | FilterGroup | undefined | void>();
    readonly onDidChangeResultCounts: vscode.Event<FilterItem | FilterGroup | undefined | void> = this._onDidChangeResultCounts.event;
    private _onDidChangeProfile: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeProfile: vscode.Event<void> = this._onDidChangeProfile.event;

    private groups: FilterGroup[] = [];
    private colorPresets: ColorPreset[] = [];
    private activeFiltersCache: { filter: FilterItem, groupId: string }[] | null = null;
    private dirty: boolean = false;
    private logger: Logger;
    private colorService: ColorService;
    private profileManager: ProfileManager;
    private stateService: FilterStateService;
    private configDisposable: vscode.Disposable;
    private saveDebounceTimer: NodeJS.Timeout | undefined;

    public get profileManagerRef(): ProfileManager {
        return this.profileManager;
    }

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.colorService = new ColorService();
        this.profileManager = new ProfileManager(context);
        this.stateService = new FilterStateService(context);

        this.groups = this.stateService.loadFromState();
        this.resetCounts();
        this.initDefaultFilters();

        // Relay profile changes & Reload filters
        this.profileManager.onDidChangeProfile(async () => {
            this._onDidChangeProfile.fire();
            await this.reloadFromProfile();
        });

        // Listen for configuration changes
        this.configDisposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(Constants.Configuration.HighlightColors.Section)) {
                this.colorService.loadColorPresets();
                this._onDidChangeFilters.fire();
            }
        });
    }

    private async reloadFromProfile() {
        const activeProfileName = this.profileManager.getActiveProfile();
        const groups = await this.profileManager.getProfileGroups(activeProfileName);

        if (groups) {
            this.groups = this.stateService.deepCopy(groups);
        } else if (activeProfileName === Constants.Labels.DefaultProfile) {
            // If Default Profile is selected but has no saved data, init defaults
            this.groups = [];
            this.initDefaultFilters();
        } else {
            this.logger.warn(`Failed to load groups for profile: ${activeProfileName}`);
        }

        this.notifyChange();
    }

    private resetCounts() {
        for (const group of this.groups) {
            group.resultCount = 0;
            for (const filter of group.filters) {
                filter.resultCount = 0;
            }
        }
    }

    public async saveFilters(): Promise<void> {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = undefined;
        }
        try {
            this.stateService.saveToState(this.groups);
            const activeWrapper = this.profileManager.getActiveProfile();
            await this.profileManager.updateProfileData(activeWrapper, this.groups);
            this.dirty = false;
        } catch (e) {
            this.logger.error(`Failed to save state: ${e}`);
        }
    }

    private debouncedSaveToState() {
        this.dirty = true;
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveFilters();
        }, FilterManager.SAVE_DEBOUNCE_MS);
    }

    private initDefaultFilters(): void {
        const hasRegexGroups = this.groups.some(g => g.isRegex);
        if (!hasRegexGroups) {
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
    }

    public getGroups(): FilterGroup[] {
        return this.groups;
    }

    public getActiveFilters(): { filter: FilterItem, groupId: string }[] {
        if (this.activeFiltersCache === null) {
            this.activeFiltersCache = [];
            for (const group of this.groups) {
                if (group.isEnabled) {
                    for (const filter of group.filters) {
                        if (filter.isEnabled) {
                            this.activeFiltersCache.push({ filter, groupId: group.id });
                        }
                    }
                }
            }
        }
        return this.activeFiltersCache;
    }

    private invalidateCache() {
        this.activeFiltersCache = null;
    }

    private notifyChange() {
        this.invalidateCache();
        this.debouncedSaveToState();
        this._onDidChangeFilters.fire();
    }

    public getAvailableColors(): string[] {
        return this.colorService.getAvailableColors();
    }

    public getColorPresets(): ColorPreset[] {
        return this.colorService.getColorPresets();
    }

    public getPresetById(id: string): ColorPreset | undefined {
        return this.colorService.getPresetById(id);
    }

    private findFilter(groupId: string, filterId: string): { group: FilterGroup, filter: FilterItem } | undefined {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                return { group, filter };
            }
        }
        return undefined;
    }

    public findGroupByFilterId(filterId: string): FilterGroup | undefined {
        return this.groups.find(g => g.filters.some(f => f.id === filterId));
    }

    public addGroup(name: string, isRegex: boolean = false): FilterGroup | undefined {
        const exists = this.groups.some(g => g.name.toLowerCase() === name.toLowerCase() && !!g.isRegex === !!isRegex);
        if (exists) {
            return undefined;
        }

        const newGroup: FilterGroup = {
            id: crypto.randomUUID(),
            name,
            filters: [],
            isEnabled: false,
            isRegex,
            isExpanded: true
        };
        this.groups.push(newGroup);
        this.logger.info(`Filter group added: ${name} (Regex: ${isRegex})`);
        this.notifyChange();
        return newGroup;
    }

    public setGroupExpanded(groupId: string, expanded: boolean): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group && group.isExpanded !== expanded) {
            group.isExpanded = expanded;
            // We save state, but NO event fired because expansion state change shouldn't trigger a full tree refresh
            // (which would defeat the purpose of tracking UI state, as refresh forces getTreeItem).
            // However, we DO want to persist it.
            this.debouncedSaveToState();
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
                id: crypto.randomUUID(),
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
            this.notifyChange();
            return newFilter;
        }
        return undefined;
    }

    private assignColor(group: FilterGroup): string {
        const usedColors = new Set(group.filters.map(f => f.color).filter(Boolean));
        const allColors = this.colorService.getAvailableColors().filter(c => c !== 'color00');

        const unusedColor = allColors.find(c => !usedColors.has(c));
        if (unusedColor) {
            return unusedColor;
        }

        return this.colorService.assignColor(group);
    }

    public updateFilterColor(groupId: string, filterId: string, color: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            found.filter.color = color;
            this.notifyChange();
        }
    }

    public renameGroup(groupId: string, newName: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.name = newName;
            this.logger.info(`Filter group renamed to: ${newName}`);
            this.notifyChange();
        }
    }

    public updateFilter(groupId: string, filterId: string, updates: { keyword?: string, nickname?: string }): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            const { filter } = found;
            if (updates.keyword !== undefined) {
                filter.keyword = updates.keyword;
            }
            if (updates.nickname !== undefined) {
                filter.nickname = updates.nickname;
            }
            this.logger.info(`Filter '${filter.id}' updated`);
            this.notifyChange();
        }
    }

    public toggleFilterHighlightMode(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            const { filter } = found;
            // Cycle: Word -> Line -> FullLine -> Word
            const nextMode: Record<HighlightMode, HighlightMode> = {
                [HighlightMode.Word]: HighlightMode.Line,
                [HighlightMode.Line]: HighlightMode.FullLine,
                [HighlightMode.FullLine]: HighlightMode.Word,
            };
            filter.highlightMode = nextMode[filter.highlightMode ?? HighlightMode.Word];
            this.notifyChange();
        }
    }

    public toggleFilterCaseSensitivity(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            found.filter.caseSensitive = !found.filter.caseSensitive;
            this.notifyChange();
        }
    }

    public toggleFilterContextLine(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            const { filter } = found;
            const levels = Constants.Defaults.ContextLineLevels;
            const currentIndex = levels.indexOf(filter.contextLine ?? 0);
            const nextIndex = (currentIndex + 1) % levels.length;
            filter.contextLine = levels[nextIndex];
            this.notifyChange();
        }
    }

    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this.logger.info(`Filter removed from group '${group.name}': ${filterId}`);
            this.notifyChange();
        }
    }

    public removeGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            this.groups = this.groups.filter(g => g.id !== groupId);
            this.logger.info(`Filter group removed: ${group.name}`);

            // If all regex groups are gone, restore defaults
            if (group.isRegex) {
                this.initDefaultFilters();
            }

            this.notifyChange();
        }
    }

    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this.logger.info(`Filter group '${group.name}' ${group.isEnabled ? 'enabled' : 'disabled'}`);
            this.notifyChange();
        }
    }

    public enableAllFiltersInGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            let changed = false;
            for (const filter of group.filters) {
                if (!filter.isEnabled) {
                    filter.isEnabled = true;
                    changed = true;
                }
            }
            if (changed) {
                this.logger.info(`All filters enabled in group '${group.name}'`);
                this.notifyChange();
            }
        }
    }

    public disableAllFiltersInGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            let changed = false;
            for (const filter of group.filters) {
                if (filter.isEnabled) {
                    filter.isEnabled = false;
                    changed = true;
                }
            }
            if (changed) {
                this.logger.info(`All filters disabled in group '${group.name}'`);
                this.notifyChange();
            }
        }
    }

    public refresh(): void {
        this._onDidChangeFilters.fire();
    }

    public toggleFilter(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            const { group, filter } = found;
            filter.isEnabled = !filter.isEnabled;
            this.logger.info(`Filter '${filter.keyword}' in group '${group.name}' ${filter.isEnabled ? 'enabled' : 'disabled'}`);
            this.notifyChange();
        }
    }

    public toggleFilterType(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            // Determine next type
            const nextType = found.filter.type === 'include' ? 'exclude' : 'include';
            this.setFilterType(groupId, filterId, nextType);
        }
    }

    public setFilterType(groupId: string, filterId: string, type: FilterType): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            const { group, filter } = found;
            if (filter.type !== type) {
                filter.type = type;

                // If switching to include and color is missing, assign one
                if (filter.type === 'include' && !filter.color) {
                    filter.color = this.assignColor(group);
                }

                this.logger.info(`Filter '${filter.keyword}' type set to: ${filter.type}`);
                this.notifyChange();
            }
        }
    }

    public setFilterCaseSensitivity(groupId: string, filterId: string, enable: boolean): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.caseSensitive !== enable) {
                found.filter.caseSensitive = enable;
                this.notifyChange();
            }
        }
    }

    public setFilterExcludeStyle(groupId: string, filterId: string, style: 'line-through' | 'hidden'): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.excludeStyle !== style) {
                found.filter.excludeStyle = style;
                this.notifyChange();
            }
        }
    }

    public setFilterHighlightMode(groupId: string, filterId: string, mode: HighlightMode): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.highlightMode !== mode) {
                found.filter.highlightMode = mode;
                this.notifyChange();
            }
        }
    }

    public setFilterContextLine(groupId: string, filterId: string, lines: number): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.contextLine !== lines) {
                found.filter.contextLine = lines;
                this.notifyChange();
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
                vscode.window.showWarningMessage(Constants.Messages.Warn.FilterAlreadyExistsInGroup.replace('{0}', activeFilter.keyword).replace('{1}', targetGroup.name));
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

        this.notifyChange();
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

        this.notifyChange();
    }

    public exportFilters(mode: 'word' | 'regex', groupIds?: string[]): string {
        const groupsToExport = this.groups
            .filter(g => {
                const modeMatch = mode === 'regex' ? g.isRegex : !g.isRegex;
                if (!modeMatch) { return false; }
                if (groupIds) {
                    return groupIds.includes(g.id);
                }
                return true;
            })
            .map(g => {
                const { resultCount: _1, id: _2, ...rest } = g;
                return {
                    ...rest,
                    filters: g.filters.map(f => {
                        const { resultCount: _3, id: _4, ...itemRest } = f;
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

    public exportGroup(groupId: string): string | undefined {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) {
            return undefined;
        }

        const { resultCount: _1, id: _2, ...rest } = group;
        const exportedGroup = {
            ...rest,
            filters: group.filters.map(f => {
                const { resultCount: _3, id: _4, ...itemRest } = f;
                return itemRest;
            })
        };

        const exportData = {
            version: this.context.extension.packageJSON.version,
            groups: [exportedGroup]
        };

        this.logger.info(`Exporting filter group '${group.name}' (v${exportData.version}).`);
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
                this.logger.info(`Importing ${importedGroups.length} groups from JSON (File Version: ${importedVersion || 'unknown'}).`);
            } else if (Array.isArray(parsedData)) {
                // Old format: Root is an array of groups
                importedGroups = parsedData;
                this.logger.info(`Importing ${importedGroups.length} groups from JSON (Array format).`);
            } else {
                throw new Error(Constants.Messages.Error.ImportInvalidFormat);
            }

            if (overwrite) {
                // Remove existing groups of the same mode
                this.groups = this.groups.filter(g => mode === 'regex' ? !g.isRegex : !!g.isRegex);
                this.logger.info(`Existing ${mode} filters cleared for overwrite.`);
            }

            let addedCount = 0;
            for (const group of importedGroups) {
                if (!group || typeof group !== 'object') {
                    continue;
                }

                // Validate group and ensure it matches the mode
                if (!!group.isRegex !== (mode === 'regex')) {
                    continue;
                }

                // If not overwriting, we might want to ensure unique names or just append.
                // Usually append with a new ID is safer.
                const newGroupId = crypto.randomUUID();
                const newGroup: FilterGroup = {
                    id: newGroupId,
                    name: typeof group.name === 'string' ? group.name.slice(0, 200) : 'Imported Group',
                    isEnabled: typeof group.isEnabled === 'boolean' ? group.isEnabled : true,
                    isRegex: !!group.isRegex,
                    isExpanded: group.isExpanded ?? true,
                    filters: (group.filters || []).map((f: unknown) => this.sanitizeImportedFilter(f as Record<string, unknown>))
                };

                this.groups.push(newGroup);
                addedCount++;
            }

            if (addedCount > 0) {
                this.notifyChange();
            }

            this.logger.info(`Import completed: ${addedCount} ${mode} filter groups added.`);
            return { count: addedCount };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.logger.error(`Import failed: ${errorMessage}`);
            return { count: 0, error: errorMessage };
        }
    }

    private sanitizeImportedFilter(f: Record<string, unknown>): FilterItem {
        const validContextLines = Constants.Defaults.ContextLineLevels as readonly number[];
        const contextLine = typeof f.contextLine === 'number' && validContextLines.includes(f.contextLine) ? f.contextLine : 0;
        const highlightMode = typeof f.highlightMode === 'number' && [0, 1, 2].includes(f.highlightMode) ? f.highlightMode as HighlightMode : undefined;

        const keyword = typeof f.keyword === 'string' ? f.keyword.slice(0, 500) : '';
        const isRegex = typeof f.isRegex === 'boolean' ? f.isRegex : false;

        // Validate regex syntax at import time to prevent invalid patterns from persisting in state
        let isEnabled = typeof f.isEnabled === 'boolean' ? f.isEnabled : true;
        if (isRegex && keyword) {
            try {
                new RegExp(keyword);
            } catch {
                this.logger.warn(`Imported filter has invalid regex, disabling: ${keyword}`);
                isEnabled = false;
            }
        }

        return {
            id: crypto.randomUUID(),
            keyword,
            type: f.type === 'include' || f.type === 'exclude' ? f.type : 'include',
            isEnabled,
            isRegex,
            nickname: typeof f.nickname === 'string' ? f.nickname.slice(0, 200) : undefined,
            color: typeof f.color === 'string' ? f.color : undefined,
            highlightMode,
            caseSensitive: typeof f.caseSensitive === 'boolean' ? f.caseSensitive : undefined,
            contextLine,
            excludeStyle: f.excludeStyle === 'hidden' ? 'hidden' : undefined,
        };
    }

    public updateResultCounts(counts: { filterId: string, count: number }[], groupCounts: { groupId: string, count: number }[]): void {
        const filterCountMap = new Map(counts.map(c => [c.filterId, c.count]));
        const groupCountMap = new Map(groupCounts.map(c => [c.groupId, c.count]));

        let changed = false;
        for (const group of this.groups) {
            const gCount = groupCountMap.get(group.id);
            if (gCount !== undefined && group.resultCount !== gCount) {
                group.resultCount = gCount;
                changed = true;
            }

            for (const filter of group.filters) {
                const fCount = filterCountMap.get(filter.id);
                if (fCount !== undefined && filter.resultCount !== fCount) {
                    filter.resultCount = fCount;
                    this._onDidChangeResultCounts.fire(filter);
                    changed = true;
                }
            }
        }

        if (changed) {
            // Optional: fire a general event if many things changed,
            // but for partial refresh we want specific events which we fired above.
            // If the tree view needs a general "something changed, check everything" signal,
            // we could fire a void event here, but we are firing specific ones.
            // this._onDidChangeResultCounts.fire();
        }
    }

    // Profile Management

    public getActiveProfile(): string {
        return this.profileManager.getActiveProfile();
    }

    public getProfileNames(): string[] {
        return this.profileManager.getProfileNames();
    }

    public getProfilesMetadata(): { name: string, wordCount: number, regexCount: number }[] {
        return this.profileManager.getProfilesMetadata();
    }

    public async deleteProfile(name: string): Promise<boolean> {
        const success = await this.profileManager.deleteProfile(name);
        if (success) {
            if (this.profileManager.getActiveProfile() === Constants.Labels.DefaultProfile) {
                await this.loadProfile(Constants.Labels.DefaultProfile);
            }
        }
        return success;
    }

    public async saveProfile(name: string): Promise<void> {
        await this.profileManager.updateProfileData(name, this.groups);
    }

    public async createProfile(name: string): Promise<boolean> {
        // Build default filters in a temporary variable to avoid mutating live state
        const previousGroups = this.groups;
        const tempGroups: FilterGroup[] = [];
        this.groups = tempGroups;
        this.initDefaultFilters();
        const newProfileGroups = this.stateService.deepCopy(tempGroups);
        // Restore live state immediately
        this.groups = previousGroups;

        const success = await this.profileManager.createProfile(name, newProfileGroups);
        if (success) {
            this.groups = tempGroups;
            this.stateService.saveToState(this.groups);
            await this.profileManager.loadProfile(name);
            this.invalidateCache();
            this._onDidChangeFilters.fire();
            this.logger.info(`Created and switched to new profile: ${name}`);
            return true;
        }
        return false;
    }

    public async duplicateProfile(name: string): Promise<boolean> {
        // Just save detailed current groups to the new profile name
        // This effectively duplicates the current state
        try {
            // Check if profile exists first to prevent overwrite if desired,
            // but createProfile already checks this.
            // saveProfile updates if exists, createProfile checks collision.
            // We want 'Create copy' semantic, so fail if exists.

            // Check existence via profile manager logic or just try create
            const profiles = this.profileManager.getProfileNames();
            if (profiles.includes(name)) {
                return false;
            }

            await this.profileManager.updateProfileData(name, this.groups);
            this.logger.info(`Duplicated current profile to: ${name}`);
            return true;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[FilterManager] Failed to duplicate profile: ${msg}`);
            return false;
        }
    }

    public async loadProfile(name: string): Promise<boolean> {
        // Flush any pending debounced save before switching
        if (this.dirty && this.saveDebounceTimer) {
            await this.saveFilters();
        }

        const groups = await this.profileManager.loadProfile(name);

        if (groups) {
            this.groups = this.stateService.deepCopy(groups);
            this.resetCounts();
            this.stateService.saveToState(this.groups);
            this._onDidChangeFilters.fire();
            this.logger.info(`Switched to profile: ${name}`);
            return true;
        } else if (name === Constants.Labels.DefaultProfile) {
            // Default profile explicit switch
            this.groups = [];
            this.initDefaultFilters();
            this.stateService.saveToState(this.groups);
            this._onDidChangeFilters.fire();
            return true;
        }
        return false;
    }

    public dispose() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = undefined;
            this.stateService.saveToState(this.groups);
        }
        this._onDidChangeFilters.dispose();
        this._onDidChangeResultCounts.dispose();
        this._onDidChangeProfile.dispose();
        this.configDisposable.dispose();
    }
}
