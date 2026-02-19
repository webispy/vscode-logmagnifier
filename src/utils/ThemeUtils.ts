import * as vscode from 'vscode';

export class ThemeUtils {
    public static isDarkTheme(): boolean {
        return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    }
}
