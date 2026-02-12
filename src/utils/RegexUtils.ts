export class RegexUtils {
    // Cache stores the 'prototype' RegExp. We clone it to return a fresh instance with its own lastIndex.
    private static cache: Map<string, RegExp> = new Map();
    private static readonly MAX_CACHE_SIZE = 500;
    private static readonly ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

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
        const key = `${keyword}_${isRegex}_${caseSensitive}`;
        if (RegexUtils.cache.has(key)) {
            // LRU: Refresh by deleting and re-inserting
            const proto = RegexUtils.cache.get(key)!;
            RegexUtils.cache.delete(key);
            RegexUtils.cache.set(key, proto);
            // Clone: new RegExp(regex) creates a copy with lastIndex = 0
            return new RegExp(proto);
        }

        try {
            const flags = caseSensitive ? 'g' : 'gi';
            let regex: RegExp;
            if (isRegex) {
                // Reject patterns with nested quantifiers that cause catastrophic backtracking
                // e.g. (a+)+$
                if (/(\+|\*|\{)\)?(\+|\*|\{)/.test(keyword)) {
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
                RegexUtils.reportedErrors.add(errorKey);
                // We dynamically import vscode to avoid hard dependency if this util is used outside extension context context
                // effectively we will just assume it is available in this environment
                Promise.all([import('vscode'), import('../constants.js')]).then(([vscode, { Constants }]) => {
                    const message = Constants.Messages.Error.InvalidRegexPatternDetailed
                        .replace('{0}', keyword)
                        .replace('{1}', errorMessage);
                    vscode.window.showErrorMessage(message);
                }).catch(() => { });
            }

            // Return a regex that matches nothing
            return /(?!)/;
        }
    }
}
