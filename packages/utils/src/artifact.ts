import fs from 'fs';

export interface AbiInput {
  name: string;
  type: string;
}

export interface AbiFunction {
  type: 'function' | 'constructor';
  name?: string;
  index?: number;
  params: AbiInput[];
  // Legacy BCH covenant flag. Radiant uses reference-based introspection
  // instead of preimage-based covenants, so the compiler never sets this for
  // RadiantScript contracts. Kept on the interface so size-estimation code
  // in Transaction.ts can safely read it (always undefined → falsy).
  covenant?: boolean;
}

export interface SourceMapEntry {
  line: number;
  column: number;
  file?: string;
  functionName?: string;
}

export interface SourceMap {
  [bytecodeOffset: number]: SourceMapEntry;
}

export interface Artifact {
  version: number;
  compilerVersion: string;
  contract: string;
  abi: AbiFunction[];
  asm: string;
  hex?: string;
  source?: string;
  sourceMap?: SourceMap;
}

export function importArtifact(artifactFile: string): Artifact {
  return JSON.parse(fs.readFileSync(artifactFile, { encoding: 'utf-8' }));
}

export function exportArtifact(artifact: Artifact, targetFile: string): void {
  const jsonString = JSON.stringify(artifact, null, 2);
  fs.writeFileSync(targetFile, jsonString);
}
