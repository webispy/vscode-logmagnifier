import * as vscode from 'vscode';
import { Constants } from '../constants';
import { FilterGroup, FilterItem, FilterType } from '../models/Filter';
import { Logger } from './Logger';
import { ColorService, ColorPreset } from './ColorService';
import { ProfileManager, FilterProfile } from './ProfileManager';
import { FilterStateService } from './FilterStateService';
import * as crypto from 'crypto';

export class FilterManager implements vscode.Disposable {
    private groups: FilterGroup[] = [];
    private colorPresets: ColorPreset[] = [];
    private activeFiltersCache: { filter: FilterItem, groupId: string }[] | null = null;
    private _onDidChangeFilters: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeFilters: vscode.Event<void> = this._onDidChangeFilters.event;

    private _onDidChangeResultCounts: vscode.EventEmitter<FilterItem | FilterGroup | undefined | void> = new vscode.EventEmitter<FilterItem | FilterGroup | undefined | void>();
    readonly onDidChangeResultCounts: vscode.Event<FilterItem | FilterGroup | undefined | void> = this._onDidChangeResultCounts.event;

    private _onDidChangeProfile: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeProfile: vscode.Event<void> = this._onDidChangeProfile.event;

    private logger: Logger;
    private colorService: ColorService;
    private profileManager: ProfileManager;
    private stateService: FilterStateService;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.colorService = new ColorService();
        this.profileManager = new ProfileManager(context);
        this.stateService = new FilterStateService(context);

        this.groups = this.stateService.loadFromState();
        this.resetCounts();
        this.initDefaultFilters();

        // Relay profile changes
        this.profileManager.onDidChangeProfile(() => this._onDidChangeProfile.fire());

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(Constants.Configuration.HighlightColors.Section)) {
                this.colorService.loadColorPresets();
                this._onDidChangeFilters.fire();
            }
        });
    }

    private resetCounts() {
        for (const group of this.groups) {
            group.resultCount = 0;
            for (const filter of group.filters) {
                filter.resultCount = 0;
            }
        }
    }

    private saveDebounceTimer: NodeJS.Timeout | undefined;

    private debouncedSaveToState() {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(async () => {
            try {
                this.stateService.saveToState(this.groups);
                const activeWrapper = this.profileManager.getActiveProfile();
                await this.profileManager.updateProfileData(activeWrapper, this.groups);

            } catch (e) {
                this.logger.error(`Failed to save state: ${e}`);
            } finally {
                this.saveDebounceTimer = undefined;
            }
        }, 300);
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

    public getAvailableColors(): string[] {
        return this.colorService.getAvailableColors();
    }

    public getColorPresets(): ColorPreset[] {
        return this.colorService.getColorPresets();
    }

    public getPresetById(id: string): ColorPreset | undefined {
        return this.colorService.getPresetById(id);
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
        this.debouncedSaveToState();
        this.invalidateCache();
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
            this.debouncedSaveToState();
            this.invalidateCache();
            this._onDidChangeFilters.fire();
            return newFilter;
        }
        return undefined;
    }

    private assignColor(group: FilterGroup): string {
        return this.colorService.assignColor(group);
    }

    public updateFilterColor(groupId: string, filterId: string, color: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                filter.color = color;
                this.debouncedSaveToState();
                this.invalidateCache();
                this._onDidChangeFilters.fire();
            }
        }
    }

    public renameGroup(groupId: string, newName: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.name = newName;
            this.logger.info(`Filter group renamed to: ${newName}`);
            this.debouncedSaveToState();
            this.invalidateCache();
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
                this.debouncedSaveToState();
                this.invalidateCache();
                this._onDidChangeFilters.fire();
            }
        }
    }

    public toggleFilterHighlightMode(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {

                // Cycle: 0 (Word) -> 1 (Line) -> 2 (Whole Line) -> 0
                filter.highlightMode = ((filter.highlightMode ?? 0) + 1) % 3;
                this.debouncedSaveToState();
                this.invalidateCache();
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
                this.debouncedSaveToState();
                this.invalidateCache();
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
                this.debouncedSaveToState();
                this.invalidateCache();
                this._onDidChangeFilters.fire();
            }
        }
    }

    public removeFilter(groupId: string, filterId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.filters = group.filters.filter(f => f.id !== filterId);
            this.logger.info(`Filter removed from group '${group.name}': ${filterId}`);
            this.debouncedSaveToState();
            this.invalidateCache();
            this._onDidChangeFilters.fire();
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

            this.debouncedSaveToState();
            this.invalidateCache();
            this._onDidChangeFilters.fire();
        }
    }

    public toggleGroup(groupId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            group.isEnabled = !group.isEnabled;
            this.logger.info(`Filter group '${group.name}' ${group.isEnabled ? 'enabled' : 'disabled'}`);
            this.debouncedSaveToState();
            this.invalidateCache();
            this._onDidChangeFilters.fire();
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
                this.debouncedSaveToState();
                this.invalidateCache();
                this._onDidChangeFilters.fire();
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
                this.debouncedSaveToState();
                this.invalidateCache();
                this._onDidChangeFilters.fire();
            }
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
                this.debouncedSaveToState();
                this.invalidateCache();
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
                    this.debouncedSaveToState();
                    this.invalidateCache();
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
                    this.debouncedSaveToState();
                    this.invalidateCache();
                    this._onDidChangeFilters.fire();
                }
            }
        }
    }

    public setFilterExcludeStyle(groupId: string, filterId: string, style: 'line-through' | 'hidden'): void {
        const group = this.groups.find(g => g.id === groupId);
        if (group) {
            const filter = group.filters.find(f => f.id === filterId);
            if (filter) {
                if (filter.excludeStyle !== style) {
                    filter.excludeStyle = style;
                    this.debouncedSaveToState();
                    this.invalidateCache();
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

                if (filter.highlightMode !== mode) {
                    filter.highlightMode = mode;
                    this.debouncedSaveToState();
                    this.invalidateCache();
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
                    this.debouncedSaveToState();
                    this.invalidateCache();
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

        this.debouncedSaveToState();
        this.invalidateCache();
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

        this.debouncedSaveToState();
        this.invalidateCache();
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

    public exportGroup(groupId: string): string | undefined {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) {
            return undefined;
        }

        const { resultCount, id, ...rest } = group;
        const exportedGroup = {
            ...rest,
            filters: group.filters.map(f => {
                const { resultCount: itemResultCount, id: itemId, ...itemRest } = f;
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

                if (overwrite) {
                    // Remove existing groups of the same mode
                    this.groups = this.groups.filter(g => mode === 'regex' ? !g.isRegex : !!g.isRegex);
                    this.logger.info(`Existing ${mode} filters cleared for overwrite.`);
                }

                let addedCount = 0;
                for (const group of importedGroups) {
                    // Validate group and ensure it matches the mode
                    if (!!group.isRegex !== (mode === 'regex')) {
                        continue;
                    }

                    // If not overwriting, we might want to ensure unique names or just append.
                    // Usually append with a new ID is safer.
                    const newGroupId = crypto.randomUUID();
                    const newGroup: FilterGroup = {
                        ...group,
                        id: newGroupId,
                        isExpanded: group.isExpanded ?? true,
                        filters: group.filters.map(f => ({
                            ...f,
                            id: crypto.randomUUID()
                        }))
                    };

                    this.groups.push(newGroup);
                    addedCount++;
                }

                if (addedCount > 0) {
                    this.debouncedSaveToState();
                    this.invalidateCache();
                    this._onDidChangeFilters.fire();
                }

                this.logger.info(`Import completed: ${addedCount} ${mode} filter groups added.`);
                return { count: addedCount };
            } else {
                throw new Error(Constants.Messages.Error.ImportInvalidFormat);
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.logger.error(`Import failed: ${errorMessage}`);
            return { count: 0, error: errorMessage };
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
                    this._onDidChangeResultCounts.fire(filter); // Fire for specific item
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
        // Create new profile with default filters (fresh start)
        const tempGroups: FilterGroup[] = [];
        // We temporarily use this.groups to generate defaults or we can refactor initDefaultFilters.
        // For now, let's manually create the default group structure or just use empty if initDefaultFilters depends on this.groups state.
        const previousGroups = this.stateService.deepCopy(this.groups);
        this.groups = [];
        this.initDefaultFilters();

        const success = await this.profileManager.createProfile(name, this.stateService.deepCopy(this.groups));
        if (success) {
            this.stateService.saveToState(this.groups);
            await this.profileManager.loadProfile(name);
            this.invalidateCache();
            this._onDidChangeFilters.fire();
            this.logger.info(`Created and switched to new profile: ${name}`);
            return true;
        } else {
            // Restore
            this.groups = previousGroups;
            return false;
        }
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
        } catch (e) {
            this.logger.error(`Failed to duplicate profile: ${e}`);
            return false;
        }
    }

    public async loadProfile(name: string): Promise<boolean> {
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
        }
        this._onDidChangeFilters.dispose();
        this._onDidChangeResultCounts.dispose();
        this._onDidChangeProfile.dispose();
    }
}
