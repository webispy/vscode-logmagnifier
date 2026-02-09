import * as vscode from 'vscode';

export class IconUtils {
    public static generateGroupSvg(folderColor: string, overlayColor?: string): string {
        const folderPath = `<path d="M7.5 2.5 L9.5 4.5 H14.5 V13.5 H1.5 V2.5 H7.5 Z" fill="none" stroke="${folderColor}" stroke-width="1" stroke-linejoin="round" />`;

        if (!overlayColor) {
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${folderPath}</svg>`;
        }

        // Mask (Cutout) to hide folder lines behind the overlay
        // Overlay center is at (12, 12) (8 offset + 8 center * 0.5 scale = 12)
        // Radius 4.5 ensures a small gap around the 16*0.5=8px icon
        const mask = `
            <defs>
                <mask id="cutout-mask">
                    <rect width="100%" height="100%" fill="white"/>
                    <circle cx="12" cy="12" r="5" fill="black"/>
                </mask>
            </defs>
        `;

        // Apply mask to folder path
        const maskedFolderPath = `<g mask="url(#cutout-mask)">${folderPath}</g>`;

        // Overlay: Circle-slash (Ban) icon, scaled 0.5 and positioned at bottom-right
        const banPath = `<path d="M11.8746 3.41833C9.51718 1.42026 5.98144 1.53327 3.75736 3.75736C1.53327 5.98144 1.42026 9.51719 3.41833 11.8746L11.8746 3.41833ZM12.5817 4.12543L4.12543 12.5817C6.48282 14.5797 10.0186 14.4667 12.2426 12.2426C14.4667 10.0186 14.5797 6.48282 12.5817 4.12543ZM3.05025 3.05025C5.78392 0.316582 10.2161 0.316582 12.9497 3.05025C15.6834 5.78392 15.6834 10.2161 12.9497 12.9497C10.2161 15.6834 5.78392 15.6834 3.05025 12.9497C0.316583 10.2161 0.316582 5.78392 3.05025 3.05025Z" fill="${overlayColor}" transform="translate(8, 8) scale(0.5)"/>`;

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            ${mask}
            ${maskedFolderPath}
            ${banPath}
        </svg>`;
    }

    public static generateOffSvg(textColor: string): string {
        // Text "OFF" centered, no border
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <text x="50%" y="11.5" font-family="Arial, sans-serif" font-size="7" font-weight="bold" fill="${textColor}" text-anchor="middle">OFF</text>
        </svg>`;
    }

    public static generateExcludeSvg(fillColor: string, strokeColor: string, style: string): string {
        if (style === 'hidden') {
            // Dotted box to represent hidden text (ghost text)
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
                <rect x="1" y="4" width="14" height="8" rx="2" fill="none" stroke="${strokeColor}" stroke-width="1.0" stroke-dasharray="3,2"/>
            </svg>`;
        }
        // Create a strike-through icon with gap
        // Text 'abc' represents the word, Line represents the strike
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <text x="50%" y="11" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="${fillColor}" text-anchor="middle">abc</text>
            <line x1="0" y1="8" x2="16" y2="8" stroke="${strokeColor}" stroke-width="1.5" />
        </svg>`;
    }

    public static generateIncludeSvg(fillColor: string, mode: number, elementId: string): string {
        const isTransparent = fillColor === 'rgba(0,0,0,0)' || fillColor === 'rgba(0, 0, 0, 0)' || fillColor === 'transparent';
        const strokeColor = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ? '#cccccc' : '#333333';
        const strokeAttr = `stroke="${strokeColor}" stroke-width="1.0" fill="none"`;
        const fillAttr = `fill="${fillColor}"`;

        if (mode === 1) {
            // Rounded box (pill shape) - represents line text only
            const attr = isTransparent ? strokeAttr : fillAttr;
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="5" width="14" height="6" rx="3" ry="3" ${attr}/></svg>`;
        } else if (mode === 2) {
            // Wide rectangle with gradient to represent full line width
            // For transparent, we just use a box outline
            if (isTransparent) {
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="0.5" y="5" width="15" height="6" ${strokeAttr}/></svg>`;
            }
            const gradId = `grad_${elementId.replace(/[^a-zA-Z0-9]/g, '')}`;
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:${fillColor};stop-opacity:1" /><stop offset="70%" style="stop-color:${fillColor};stop-opacity:1" /><stop offset="100%" style="stop-color:${fillColor};stop-opacity:0.3" /></linearGradient></defs><rect x="0" y="5" width="16" height="6" fill="url(#${gradId})"/></svg>`;
        }
        // Circle - represents word
        const attr = isTransparent ? strokeAttr : fillAttr;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" ${attr}/></svg>`;
    }
}
