import * as vscode from 'vscode';
import { Constants } from '../Constants';

export class RegexUtils {
    // Cache stores the 'prototype' RegExp. We clone it to return a fresh instance with its own lastIndex.
    private static cache: Map<string, RegExp> = new Map();
    private static readonly MAX_CACHE_SIZE = Constants.Defaults.RegexCacheSize;
    private static readonly ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

    private static readonly MAX_REPORTED_ERRORS = 200;
    private static reportedErrors: Set<string> = new Set();

    /**
     * Creates a RegExp object safely with caching.
     * Returns a NEW RegExp instance every time to avoid shared 'lastIndex' state bugs.
     * @param keyword The pattern or search text.
     * @param isRegex Whether the keyword is a regex pattern.
     * @param caseSensitive Whether the search should be case sensitive.
     * @returns A RegExp object. Returns a match-nothing regex on error.
     */
    public static create(keyword: string, isRegex: boolean, caseSensitive: boolean): RegExp {
        const key = `${keyword}\x00${isRegex}\x00${caseSensitive}`;
        const cached = RegexUtils.cache.get(key);
        if (cached) {
            // LRU: Refresh by deleting and re-inserting
            RegexUtils.cache.delete(key);
            RegexUtils.cache.set(key, cached);
            // Clone: new RegExp(regex) creates a copy with lastIndex = 0
            return new RegExp(cached);
        }

        try {
            const flags = caseSensitive ? 'g' : 'gi';
            let regex: RegExp;
            if (isRegex) {
                // Reject patterns that may cause catastrophic backtracking (ReDoS)
                const MAX_REGEX_LENGTH = 500;
                const REDOS_PATTERNS = [
                    /(\+|\*|\{)\)?(\+|\*|\{)/,       // consecutive quantifiers: (a+)+, a**
                    /\([^)]*[+*]\)[+*{]/,             // group+quantifier combo: (a+)+, (a|b)*{2}
                    /\([^)]*\|[^)]*\)[*+{]/,          // alternation with quantifier: (a|b)+
                    /\([^)]*[+*][^)]*\|[^)]*\)[*+]/,  // overlap in alternation: (a+|a)*
                    /(\.\*){2,}/,                      // multiple greedy wildcards: .*.*
                    /\(\.[\*\+]\)\{/,                  // dot-star/plus in group with repetition: (.*){n}
                ];
                if (keyword.length > MAX_REGEX_LENGTH) {
                    throw new Error('Pattern too long');
                }
                if (REDOS_PATTERNS.some(p => p.test(keyword))) {
                    throw new Error('Pattern contains nested quantifiers that may cause performance issues');
                }
                regex = new RegExp(keyword, flags);
            } else {
                const escaped = keyword.replace(RegexUtils.ESCAPE_REGEX, '\\$&');
                regex = new RegExp(escaped, flags);
            }

            // LRU: Evict oldest if full
            if (RegexUtils.cache.size >= RegexUtils.MAX_CACHE_SIZE) {
                const oldestKey = RegexUtils.cache.keys().next().value;
                if (oldestKey) {
                    RegexUtils.cache.delete(oldestKey);
                }
            }
            RegexUtils.cache.set(key, regex);
            return new RegExp(regex);

        } catch (error) {
            // Report error to user (once per invalid pattern to avoid spam)
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorKey = `${keyword}_${errorMessage}`;

            if (!RegexUtils.reportedErrors.has(errorKey)) {
                if (RegexUtils.reportedErrors.size >= RegexUtils.MAX_REPORTED_ERRORS) {
                    // Evict oldest half instead of clearing all
                    const entries = Array.from(RegexUtils.reportedErrors);
                    const half = Math.floor(entries.length / 2);
                    for (let i = 0; i < half; i++) {
                        RegexUtils.reportedErrors.delete(entries[i]);
                    }
                }
                RegexUtils.reportedErrors.add(errorKey);
                const message = Constants.Messages.Error.InvalidRegexPatternDetailed
                    .replace('{0}', keyword)
                    .replace('{1}', errorMessage);
                vscode.window.showErrorMessage(message);
            }

            // Return a regex that matches nothing
            return /(?!)/;
        }
    }
}
