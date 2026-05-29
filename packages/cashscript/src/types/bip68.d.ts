// Minimal type shim for the bip68 package, which ships only JavaScript.
// Only the call shapes RadiantScript actually uses are declared.
declare module 'bip68' {
  export function encode(obj: { blocks?: number; seconds?: number }): number;
  export function decode(sequence: number): { blocks?: number; seconds?: number };
}
