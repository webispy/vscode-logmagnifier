import * as vscode from 'vscode';

export class ThemeUtils {
    public static isDarkTheme(): boolean {
        return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    }

    /** Primary stroke color for icons, adapts to theme */
    public static get strokeColor(): string {
        return ThemeUtils.isDarkTheme() ? '#cccccc' : '#333333';
    }

    /** Dimmed color for disabled states, adapts to theme */
    public static get dimmedColor(): string {
        return ThemeUtils.isDarkTheme() ? '#555555' : '#cccccc';
    }

    /** Neutral color for exclude/off icons */
    public static readonly neutralColor = '#808080';
}
