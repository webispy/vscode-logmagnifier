import * as crypto from 'crypto';

import * as vscode from 'vscode';

import { Constants } from '../Constants';
import { FilterGroup, FilterItem, HighlightMode } from '../models/Filter';

import { Logger } from './Logger';

/** Minimum version that uses the new field names (pattern, contextLines, strikethrough, independent/aggregated). */
const LEGACY_CUTOFF_VERSION = '1.7.1';

export class FilterStateService {
    constructor(private readonly context: vscode.ExtensionContext, private readonly logger: Logger) { }

    /** Persists filter groups to VS Code global state. */
    public saveToState(groups: FilterGroup[]) {
        this.context.globalState.update(Constants.GlobalState.FilterGroups, groups);
    }

    /** Loads filter groups from global state, applying any necessary schema migrations. */
    public loadFromState(): FilterGroup[] {
        const saved = this.context.globalState.get<FilterGroup[]>(Constants.GlobalState.FilterGroups);
        if (saved) {
            // Apply migrations if needed on load
            saved.forEach(g => {
                g.filters.forEach(f => this.ensureFilterMigration(f));
            });
            return saved;
        }
        return [];
    }

    /** Creates a deep copy of the given object using structuredClone with a JSON fallback. */
    public deepCopy<T>(obj: T): T {
        try {
            return structuredClone(obj);
        } catch (e: unknown) {
            this.logger.warn(`[FilterStateService] structuredClone failed, falling back to JSON: ${e instanceof Error ? e.message : String(e)}`);
            return JSON.parse(JSON.stringify(obj));
        }
    }

    /**
     * Returns true when the given version string predates the terminology rename
     * (keyword→pattern, contextLine→contextLines, line-through→strikethrough,
     * sequential→independent, cumulative→aggregated).
     */
    public static isLegacyVersion(version: string | undefined): boolean {
        if (!version) { return true; }
        return FilterStateService.compareVersions(version, LEGACY_CUTOFF_VERSION) < 0;
    }

    /**
     * Sanitizes a raw imported filter object into a valid FilterItem,
     * handling legacy field names and invalid values.
     */
    public sanitizeImportedFilter(f: Record<string, unknown>): FilterItem {
        const validContextLines = Constants.Defaults.ContextLineLevels as readonly number[];
        // Support legacy 'contextLine' field from older exports
        const rawContextLines = typeof f.contextLines === 'number' ? f.contextLines : (typeof f.contextLine === 'number' ? f.contextLine : 0);
        const contextLines = validContextLines.includes(rawContextLines) ? rawContextLines : 0;
        const highlightMode = typeof f.highlightMode === 'number' && [0, 1, 2].includes(f.highlightMode) ? f.highlightMode as HighlightMode : undefined;

        // Support legacy 'keyword' field from older exports
        const rawPattern = typeof f.pattern === 'string' ? f.pattern : (typeof f.keyword === 'string' ? f.keyword : '');
        const pattern = rawPattern.slice(0, Constants.Defaults.MaxPatternLength);
        const isRegex = typeof f.isRegex === 'boolean' ? f.isRegex : false;

        // Validate regex syntax at import time to prevent invalid patterns from persisting in state
        let isEnabled = typeof f.isEnabled === 'boolean' ? f.isEnabled : true;
        if (isRegex && pattern) {
            try {
                new RegExp(pattern);
            } catch (e: unknown) {
                this.logger.warn(`[FilterStateService] Imported filter has invalid regex, disabling: ${pattern}: ${e instanceof Error ? e.message : String(e)}`);
                isEnabled = false;
            }
        }

        return {
            id: crypto.randomUUID(),
            pattern,
            type: f.type === 'include' || f.type === 'exclude' ? f.type : 'include',
            isEnabled,
            isRegex,
            nickname: typeof f.nickname === 'string' ? f.nickname.slice(0, 200) : undefined,
            color: typeof f.color === 'string' ? f.color : undefined,
            highlightMode,
            caseSensitive: typeof f.caseSensitive === 'boolean' ? f.caseSensitive : undefined,
            contextLines,
            excludeStyle: f.excludeStyle === 'hidden' ? 'hidden'
                : (f.excludeStyle === 'strikethrough' || f.excludeStyle === 'line-through') ? 'strikethrough'
                : undefined,
        };
    }

    /**
     * Sanitizes all filters within the given groups (creates new FilterItem objects with new IDs).
     * Used by WorkflowManager when importing bundled profiles from external files.
     */
    public sanitizeFilterGroups(groups: FilterGroup[]): void {
        for (const group of groups) {
            if (!group || !Array.isArray(group.filters)) { continue; }
            group.filters = group.filters.map(f => this.sanitizeImportedFilter(f as unknown as Record<string, unknown>));
        }
    }

    /**
     * Migrates legacy fields in-place within the given groups, preserving existing IDs.
     * Used by ProfileManager when loading profiles from globalState.
     */
    public migrateFilterGroups(groups: FilterGroup[]): void {
        for (const group of groups) {
            if (!group || !Array.isArray(group.filters)) { continue; }
            group.filters.forEach(f => this.ensureFilterMigration(f));
        }
    }

    /** Compares two semver strings. Returns <0 if a<b, 0 if a==b, >0 if a>b. */
    private static compareVersions(a: string, b: string): number {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) { return diff; }
        }
        return 0;
    }

    public ensureFilterMigration(filter: FilterItem): void {
        // Migrate legacy 'keyword' field to 'pattern'
        const legacy = filter as unknown as Record<string, unknown>;
        if ('keyword' in legacy && !filter.pattern) {
            filter.pattern = String(legacy['keyword']);
            delete legacy['keyword'];
        }

        // Migrate legacy 'contextLine' field to 'contextLines'
        if ('contextLine' in legacy && filter.contextLines === undefined) {
            filter.contextLines = typeof legacy['contextLine'] === 'number' ? legacy['contextLine'] as number : 0;
            delete legacy['contextLine'];
        }

        // Migrate legacy 'line-through' excludeStyle to 'strikethrough' (pre-v1.6 data)
        // Safe to remove once all users have migrated past v1.6
        if (filter.excludeStyle === 'line-through' as string) {
            filter.excludeStyle = 'strikethrough';
        }

        if (filter.highlightMode === undefined) {
            const enableFullLine = 'enableFullLineHighlight' in filter && (filter as { enableFullLineHighlight?: boolean }).enableFullLineHighlight;
            filter.highlightMode = enableFullLine ? HighlightMode.Line : HighlightMode.Word;
            if ('enableFullLineHighlight' in filter) {
                delete (filter as { enableFullLineHighlight?: boolean }).enableFullLineHighlight;
            }
        }
    }
}
