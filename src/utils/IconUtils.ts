import { ThemeUtils } from './ThemeUtils';

export class IconUtils {
    /** Strips characters that could break SVG attribute values. */
    private static sanitizeColor(color: string): string {
        return color.replace(/[<>"'&]/g, '');
    }

    /** Generates a folder SVG icon with an optional ban-circle overlay in the bottom-right corner. */
    public static generateGroupSvg(folderColor: string, overlayColor?: string): string {
        folderColor = IconUtils.sanitizeColor(folderColor);
        const folderPath = `<path d="M7.5 2.5 L9.5 4.5 H14.5 V13.5 H1.5 V2.5 H7.5 Z" fill="none" stroke="${folderColor}" stroke-width="1" stroke-linejoin="round" />`;

        overlayColor = overlayColor ? IconUtils.sanitizeColor(overlayColor) : undefined;
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

    /** Generates an SVG icon displaying the text "OFF". */
    public static generateOffSvg(textColor: string): string {
        textColor = IconUtils.sanitizeColor(textColor);
        // Text "OFF" centered, no border
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <text x="50%" y="11.5" font-family="Arial, sans-serif" font-size="7" font-weight="bold" fill="${textColor}" text-anchor="middle">OFF</text>
        </svg>`;
    }

    /**
     * Generates an SVG icon representing an exclude filter.
     * @param fillColor - text fill color for the strike-through variant
     * @param strokeColor - stroke color used for both the dotted-box and strike-through variants
     * @param style - when `'hidden'`, renders a dotted box; otherwise renders strike-through text
     */
    public static generateExcludeSvg(fillColor: string, strokeColor: string, style: string): string {
        fillColor = IconUtils.sanitizeColor(fillColor);
        strokeColor = IconUtils.sanitizeColor(strokeColor);
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

    /**
     * Generates an SVG icon representing an include filter.
     * @param fillColor - fill color for the shape; transparent values use a stroke outline instead
     * @param mode - shape variant: 0 = circle (word), 1 = pill (line text), 2 = wide rectangle (full line)
     * @param elementId - unique identifier used to namespace the SVG gradient definition
     */
    public static generateIncludeSvg(fillColor: string, mode: number, elementId: string): string {
        fillColor = IconUtils.sanitizeColor(fillColor);
        const isTransparent = /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(fillColor) || fillColor === 'transparent';
        const strokeColor = ThemeUtils.strokeColor;
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

    /**
     * Generates a density bar chart SVG icon (16x16) for time range tree nodes.
     * Each bar represents a sub-bucket; height is proportional to maxCount.
     * Zero-count bars are not drawn (empty gap = no data).
     */
    public static generateDensityBarSvg(buckets: number[], maxCount: number, color: string): string {
        color = IconUtils.sanitizeColor(color);
        if (buckets.length === 0 || maxCount === 0) {
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>`;
        }
        const barCount = buckets.length;
        const gap = barCount <= 6 ? 1 : 0.5;
        const innerWidth = 14; // 16 - 1px padding each side
        const totalGap = (barCount - 1) * gap;
        const barWidth = Math.max(1.5, (innerWidth - totalGap) / barCount);
        const maxHeight = 13;
        const border = `<rect x="0.5" y="0.5" width="15" height="15" rx="1.5" fill="none" stroke="${color}" stroke-width="0.7" opacity="0.4"/>`;
        const bars = buckets.map((count, i) => {
            if (count === 0) {
                return '';
            }
            const height = Math.max(2, (count / maxCount) * maxHeight);
            const x = 1 + i * (barWidth + gap);
            const y = 15 - height;
            return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" fill="${color}" rx="0.5"/>`;
        }).join('');
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${border}${bars}</svg>`;
    }

    /** Generates a simple filled-circle SVG icon. */
    public static generateSimpleCircleSvg(color: string): string {
        color = IconUtils.sanitizeColor(color);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`;
    }

    /** Generates a small clock/gap indicator SVG icon for gutter display. */
    public static generateGapSvg(color: string): string {
        color = IconUtils.sanitizeColor(color);
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">`
            + `<circle cx="8" cy="8" r="6.5" fill="none" stroke="${color}" stroke-width="1.5"/>`
            + `<line x1="8" y1="4" x2="8" y2="8.5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
            + `<line x1="8" y1="8.5" x2="11" y2="10" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
            + `</svg>`;
    }
}
