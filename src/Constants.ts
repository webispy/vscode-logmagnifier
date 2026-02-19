/**
 * Centralized constants for the extension.
 * These values MUST match the definitions in package.json.
 */

import { Ids } from './constants/Ids';
import { Messages } from './constants/Messages';

export const Constants = {
    ...Ids,
    ...Messages,
} as const;
