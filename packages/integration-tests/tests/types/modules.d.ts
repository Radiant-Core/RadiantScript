declare module 'ws-electrumx-client' {
  export class ElectrumClient {
    constructor(url: string);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    request(method: string, params?: any[]): Promise<any>;
  }
}

declare module 'rxdc' {
  export function compileString(source: string): any;
  export function compileFile(path: string): any;
}

declare module '@radiantblockchain/radiantjs' {
  export class PrivateKey {
    constructor(key?: string);
    toPublicKey(): PublicKey;
    toAddress(): Address;
    toWIF(): string;
    toString(): string;
  }
  
  export class PublicKey {
    toString(): string;
  }
  
  export class Address {
    toString(): string;
    static fromScript(script: Script, network: string): Address;
  }
  
  export class Script {
    static buildPublicKeyHashOut(address: Address): Script;
    static fromHex(hex: string): Script;
    toHex(): string;
    isPublicKeyHashOut(): boolean;
  }
  
  export class Transaction {
    inputs: any[];
    outputs: any[];
    from(utxo: any): Transaction;
    to(address: Address, satoshis: number): Transaction;
    addOutput(output: any): Transaction;
    change(address: Address): Transaction;
    feePerByte(rate: number): Transaction;
    getFee(): number;
    sign(privateKey: PrivateKey): Transaction;
    serialize(): string;
    toBuffer(): Buffer;
    
    static Output: {
      new(options: { script: Script; satoshis: number }): any;
    };
  }
  
  export class Mnemonic {
    constructor(phrase?: string);
    toString(): string;
    toHDPrivateKey(): HDPrivateKey;
  }
  
  export class HDPrivateKey {
    xprivkey: string;
    privateKey: PrivateKey;
    deriveChild(path: string): HDPrivateKey;
  }
  
  export namespace crypto {
    export namespace Hash {
      function sha256(data: Buffer): Buffer;
      function sha256sha256(data: Buffer): Buffer;
      function ripemd160(data: Buffer): Buffer;
      function sha512_256(data: Buffer): Buffer;
    }
  }
  
  export function Message(message: string): {
    sign(privateKey: PrivateKey): string;
    verify(address: string, signature: string): boolean;
  };
}

declare module '@radiantblockchain/constants' {
  export const GLYPH_MAGIC: string;
  export const GLYPH_FT: number;
  export const GLYPH_NFT: number;
  export const GLYPH_DAT: number;
  export const POW_SHA256D: number;
  export const POW_BLAKE3: number;
  export const POW_ARGON2ID: number;
  export const DAA_FIXED: number;
  export const DAA_ASERT: number;
  export const DAA_LWMA: number;
  export const MAX_METADATA_SIZE: number;
  export const MAX_CONTENT_SIZE: number;
  export const MAINNET: any;
  export const TESTNET: any;
  export const SCRIPT_VERIFY_NONE: number;
  export const SCRIPT_VERIFY_P2SH: number;
  export function isGlyphMagic(data: Buffer): boolean;
  export function isValidProtocol(id: number): boolean;
}
