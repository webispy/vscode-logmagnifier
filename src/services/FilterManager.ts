import * as crypto from 'crypto';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem, FilterType, HighlightMode } from '../models/Filter';

import { ColorService, ColorPreset } from './ColorService';
import { FilterStateService } from './FilterStateService';
import { Logger } from './Logger';
import { ProfileManager } from './ProfileManager';

export class FilterManager implements vscode.Disposable {
    private static readonly saveDebounceMs = 300;

    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;
    private _onDidChangeResultCounts: vscode.EventEmitter<FilterItem | FilterGroup | undefined | void> = new vscode.EventEmitter<FilterItem | FilterGroup | undefined | void>();
    readonly onDidChangeResultCounts: vscode.Event<FilterItem | FilterGroup | undefined | void> = this._onDidChangeResultCounts.event;
    private _onDidChangeProfile: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeProfile: vscode.Event<void> = this._onDidChangeProfile.event;

    private groups: FilterGroup[] = [];
    private activeFiltersCache: { filter: FilterItem, groupId: string }[] | null = null;
    private dirty: boolean = false;
    private logger: Logger;
    private colorService: ColorService;
    private profileManager: ProfileManager;
    private stateService: FilterStateService;
    private configDisposable: vscode.Disposable;
    private saveDebounceTimer: NodeJS.Timeout | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.colorService = new ColorService();
        this.profileManager = new ProfileManager(context);
        this.stateService = new FilterStateService(context, this.logger);

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

    public get profileManagerRef(): ProfileManager {
        return this.profileManager;
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
            this.logger.warn(`[FilterManager] Failed to load groups for profile: ${activeProfileName}`);
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

    /** Persists all filter groups to extension state and the active profile. */
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
        } catch (e: unknown) {
            this.logger.error(`[FilterManager] Failed to save state: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private debouncedSaveToState() {
        this.dirty = true;
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveFilters().catch(e =>
                this.logger.error(`[FilterManager] Debounced save failed: ${e instanceof Error ? e.message : String(e)}`)
            );
        }, FilterManager.saveDebounceMs);
    }

    private initDefaultFilters(target?: FilterGroup[]): void {
        const groups = target ?? this.groups;
        const hasRegexGroups = groups.some(g => g.isRegex);
        if (!hasRegexGroups) {
            if (target) {
                // Build directly into the target array without side effects
                const featuredGroup: FilterGroup = {
                    id: crypto.randomUUID(),
                    name: 'Presets',
                    filters: [],
                    isEnabled: false,
                    isRegex: true,
                    isExpanded: true
                };
                featuredGroup.filters.push(
                    { id: crypto.randomUUID(), keyword: '^\\d{2}-\\d{2}\\s\\d{2}:\\d{2}:\\d{2}\\.\\d{3}', type: 'include', isEnabled: true, isRegex: true, nickname: 'Logcat style', contextLine: 0 },
                    { id: crypto.randomUUID(), keyword: '^\\s*\\d+\\s+\\d+\\s+[a-zA-Z_]\\S*\\s+\\S+\\s+-?\\d+', type: 'include', isEnabled: true, isRegex: true, nickname: 'Process Info', contextLine: 0 }
                );
                target.push(featuredGroup);
            } else {
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
    }

    /** Returns all filter groups. */
    public getGroups(): FilterGroup[] {
        return this.groups;
    }

    /** Returns all enabled filters from enabled groups, using a cached result when available. */
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

    /** Returns the list of available highlight color identifiers. */
    public getAvailableColors(): string[] {
        return this.colorService.getAvailableColors();
    }

    /** Returns all configured color presets. */
    public getColorPresets(): ColorPreset[] {
        return this.colorService.getColorPresets();
    }

    /** Returns a color preset by its identifier, or undefined if not found. */
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

    /** Finds the group that contains the filter with the given ID. */
    public findGroupByFilterId(filterId: string): FilterGroup | undefined {
        return this.groups.find(g => g.filters.some(f => f.id === filterId));
    }

    /** Creates a new filter group, returning undefined if a group with the same name and mode already exists. */
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
        this.logger.info(`[FilterManager] Filter group added: ${name} (Regex: ${isRegex})`);
        this.notifyChange();
        return newGroup;
    }

    /** Sets the expanded/collapsed UI state of a group without triggering a filter change event. */
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

    /**
     * Adds a new filter to the specified group, returning undefined if a duplicate exists.
     *
     * @param groupId - Target group identifier
     * @param keyword - Filter pattern (plain text or regex)
     * @param type - Whether this filter includes or excludes matching lines
     * @param isRegex - Whether the keyword is a regular expression
     * @param nickname - Optional display name for the filter
     * @returns The created filter item, or undefined if the group was not found or a duplicate exists
     */
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
            this.logger.info(`[FilterManager] Filter added to group '${group.name}': ${keyword} (Type: ${type}, Regex: ${isRegex})`);
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

    /** Updates the highlight color of a filter. */
    public updateFilterColor(groupId: string, filterId: string, color: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            found.filter.color = color;
            this.notifyChange();
        }
    }

    /** Renames a filter group. */
    public renameGroup(groupId: string, newName: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.name = newName;
            this.logger.info(`[FilterManager] Filter group renamed to: ${newName}`);
            this.notifyChange();
        }
    }

    /** Updates a filter's keyword and/or nickname. */
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
            this.logger.info(`[FilterManager] Filter '${filter.id}' updated`);
            this.notifyChange();
        }
    }

    /** Cycles the filter's highlight mode through Word, Line, and FullLine. */
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

    /** Toggles case-sensitive matching for a filter. */
    public toggleFilterCaseSensitivity(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            found.filter.caseSensitive = !found.filter.caseSensitive;
            this.notifyChange();
        }
    }

    /** Cycles the filter's context line count through the predefined levels. */
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

    /** Removes a filter from the specified group. */
    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this.logger.info(`[FilterManager] Filter removed from group '${group.name}': ${filterId}`);
            this.notifyChange();
        }
    }

    /** Removes a filter group, restoring default regex presets if all regex groups are removed. */
    public removeGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            this.groups = this.groups.filter(g => g.id !== groupId);
            this.logger.info(`[FilterManager] Filter group removed: ${group.name}`);

            // If all regex groups are gone, restore defaults
            if (group.isRegex) {
                this.initDefaultFilters();
            }

            this.notifyChange();
        }
    }

    /** Toggles the enabled state of a filter group. */
    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this.logger.info(`[FilterManager] Filter group '${group.name}' ${group.isEnabled ? 'enabled' : 'disabled'}`);
            this.notifyChange();
        }
    }

    /** Enables all filters within a group. */
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
                this.logger.info(`[FilterManager] All filters enabled in group '${group.name}'`);
                this.notifyChange();
            }
        }
    }

    /** Disables all filters within a group. */
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
                this.logger.info(`[FilterManager] All filters disabled in group '${group.name}'`);
                this.notifyChange();
            }
        }
    }

    /** Fires the filter change event to trigger a UI refresh without modifying state. */
    public refresh(): void {
        this._onDidChangeFilters.fire();
    }

    /** Toggles the enabled state of an individual filter. */
    public toggleFilter(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            const { group, filter } = found;
            filter.isEnabled = !filter.isEnabled;
            this.logger.info(`[FilterManager] Filter '${filter.keyword}' in group '${group.name}' ${filter.isEnabled ? 'enabled' : 'disabled'}`);
            this.notifyChange();
        }
    }

    /** Toggles a filter's type between include and exclude. */
    public toggleFilterType(groupId: string, filterId: string): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            // Determine next type
            const nextType = found.filter.type === 'include' ? 'exclude' : 'include';
            this.setFilterType(groupId, filterId, nextType);
        }
    }

    /** Sets a filter's type to include or exclude, assigning a color if switching to include. */
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

                this.logger.info(`[FilterManager] Filter '${filter.keyword}' type set to: ${filter.type}`);
                this.notifyChange();
            }
        }
    }

    /** Sets whether a filter uses case-sensitive matching. */
    public setFilterCaseSensitivity(groupId: string, filterId: string, enable: boolean): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.caseSensitive !== enable) {
                found.filter.caseSensitive = enable;
                this.notifyChange();
            }
        }
    }

    /** Sets the visual style for excluded lines (strikethrough or hidden). */
    public setFilterExcludeStyle(groupId: string, filterId: string, style: 'line-through' | 'hidden'): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.excludeStyle !== style) {
                found.filter.excludeStyle = style;
                this.notifyChange();
            }
        }
    }

    /** Sets the highlight mode (Word, Line, or FullLine) for a filter. */
    public setFilterHighlightMode(groupId: string, filterId: string, mode: HighlightMode): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.highlightMode !== mode) {
                found.filter.highlightMode = mode;
                this.notifyChange();
            }
        }
    }

    /** Sets the number of context lines shown around matched lines for a filter. */
    public setFilterContextLine(groupId: string, filterId: string, lines: number): void {
        const found = this.findFilter(groupId, filterId);
        if (found) {
            if (found.filter.contextLine !== lines) {
                found.filter.contextLine = lines;
                this.notifyChange();
            }
        }
    }

    /** Moves a filter between groups or reorders it within the same group. */
    public moveFilter(sourceGroupId: string, targetGroupId: string, activeFilterId: string, targetFilterId: string | undefined, position: 'before' | 'after' | 'append'): void {
        const sourceGroup = this.groups.find(g => g.id === sourceGroupId);
        const targetGroup = this.groups.find(g => g.id === targetGroupId);

        if (!sourceGroup || !targetGroup) {
            return;
        }

        // Cross-mode prevention (Word <-> Regex)
        // Groups must either both be regex or both be non-regex
        if (!!sourceGroup.isRegex !== !!targetGroup.isRegex) {
            this.logger.warn(`[FilterManager] Cannot move filter between different modes (Source: ${sourceGroup.isRegex}, Target: ${targetGroup.isRegex})`);
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
                this.logger.warn(`[FilterManager] Cannot move filter: Duplicate exists in target group '${targetGroup.name}'`);
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

    /** Reorders a filter group relative to another group. */
    public moveGroup(activeGroupId: string, targetGroupId: string | undefined, position: 'before' | 'after' | 'append'): void {
        const activeIndex = this.groups.findIndex(g => g.id === activeGroupId);
        if (activeIndex === -1) {
            return;
        }

        const activeGroup = this.groups[activeIndex];
        const targetGroup = targetGroupId ? this.groups.find(g => g.id === targetGroupId) : undefined;

        // Validation: mode match
        if (targetGroup && !!activeGroup.isRegex !== !!targetGroup.isRegex) {
            this.logger.warn(`[FilterManager] Cannot move group between different modes.`);
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

    /** Serializes filter groups to a JSON string for file export. */
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

        this.logger.info(`[FilterManager] Exporting ${groupsToExport.length} ${mode} filter groups (v${exportData.version}).`);
        return JSON.stringify(exportData, null, 4);
    }

    /** Serializes a single filter group to a JSON string for file export. */
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

        this.logger.info(`[FilterManager] Exporting filter group '${group.name}' (v${exportData.version}).`);
        return JSON.stringify(exportData, null, 4);
    }

    /** Imports filter groups from a JSON string, optionally overwriting existing groups. */
    public importFilters(json: string, mode: 'word' | 'regex', overwrite: boolean): { count: number, error?: string } {
        this.logger.info(`[FilterManager] Starting ${mode} filters import (Overwrite: ${overwrite})...`);
        try {
            const parsedData = JSON.parse(json);

            let importedGroups: FilterGroup[] = [];
            let importedVersion: string | undefined;

            if (typeof parsedData === 'object' && parsedData !== null && Array.isArray(parsedData.groups)) {
                // New format: Root is object with version and groups
                importedGroups = parsedData.groups;
                importedVersion = parsedData.version;
                this.logger.info(`[FilterManager] Importing ${importedGroups.length} groups from JSON (File Version: ${importedVersion || 'unknown'}).`);
            } else if (Array.isArray(parsedData)) {
                // Old format: Root is an array of groups
                importedGroups = parsedData;
                this.logger.info(`[FilterManager] Importing ${importedGroups.length} groups from JSON (Array format).`);
            } else {
                throw new Error(Constants.Messages.Error.ImportInvalidFormat);
            }

            if (overwrite) {
                // Remove existing groups of the same mode
                this.groups = this.groups.filter(g => mode === 'regex' ? !g.isRegex : !!g.isRegex);
                this.logger.info(`[FilterManager] Existing ${mode} filters cleared for overwrite.`);
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

            this.logger.info(`[FilterManager] Import completed: ${addedCount} ${mode} filter groups added.`);
            return { count: addedCount };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.logger.error(`[FilterManager] Import failed: ${errorMessage}`);
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
            } catch (e: unknown) {
                this.logger.warn(`[FilterManager] Imported filter has invalid regex, disabling: ${keyword}: ${e instanceof Error ? e.message : String(e)}`);
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

    /** Updates match counts for filters and groups, firing change events for each modified filter. */
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

    /** Returns the name of the currently active profile. */
    public getActiveProfile(): string {
        return this.profileManager.getActiveProfile();
    }

    /** Returns all available profile names. */
    public getProfileNames(): string[] {
        return this.profileManager.getProfileNames();
    }

    /** Returns metadata for all profiles including word and regex filter group counts. */
    public getProfilesMetadata(): { name: string, wordCount: number, regexCount: number }[] {
        return this.profileManager.getProfilesMetadata();
    }

    /** Deletes a profile by name, reloading the default profile if it was active. */
    public async deleteProfile(name: string): Promise<boolean> {
        const success = await this.profileManager.deleteProfile(name);
        if (success) {
            if (this.profileManager.getActiveProfile() === Constants.Labels.DefaultProfile) {
                await this.loadProfile(Constants.Labels.DefaultProfile);
            }
        }
        return success;
    }

    /** Saves the current filter groups to the specified profile. */
    public async saveProfile(name: string): Promise<void> {
        await this.profileManager.updateProfileData(name, this.groups);
    }

    /** Creates a new profile with default filters and switches to it. */
    public async createProfile(name: string): Promise<boolean> {
        // Build default filters into a separate array without mutating live state
        const tempGroups: FilterGroup[] = [];
        this.initDefaultFilters(tempGroups);
        const newProfileGroups = this.stateService.deepCopy(tempGroups);

        const success = await this.profileManager.createProfile(name, newProfileGroups);
        if (success) {
            this.groups = tempGroups;
            this.stateService.saveToState(this.groups);
            await this.profileManager.loadProfile(name);
            this.invalidateCache();
            this._onDidChangeFilters.fire();
            this.logger.info(`[FilterManager] Created and switched to new profile: ${name}`);
            return true;
        }
        return false;
    }

    /** Duplicates the current filter state into a new profile, returning false if the name already exists. */
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
            this.logger.info(`[FilterManager] Duplicated current profile to: ${name}`);
            return true;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.error(`[FilterManager] Failed to duplicate profile: ${msg}`);
            return false;
        }
    }

    /** Loads a profile by name, flushing any pending saves before switching. */
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
            this.logger.info(`[FilterManager] Switched to profile: ${name}`);
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
