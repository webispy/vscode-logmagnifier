/**
 * Centralized constants for the extension.
 * These values MUST match the definitions in package.json.
 *
 * Ids and Messages are merged into a single namespace.
 * TypeScript will flag duplicate keys at compile time via the intersection type.
 */

import { Ids } from './constants/Ids';
import { Messages } from './constants/Messages';

// Compile-time guard: if Ids and Messages share a top-level key, this becomes `never`
type AssertNoOverlap = keyof typeof Ids & keyof typeof Messages extends never ? true : never;
void (true satisfies AssertNoOverlap);

export const Constants = {
    ...Ids,
    ...Messages,
} as const;
