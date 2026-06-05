import {
  bigIntToBinUint64LE,
  hexToBin,
  binToHex,
  encodeTransaction,
  addressContentsToLockingBytecode,
  AddressType,
  decodeTransaction,
  Transaction as LibauthTransaction,
  instantiateSecp256k1,
} from '@bitauth/libauth';
import {
  AbiFunction,
  hash160,
  hash256,
  placeholder,
  Script,
  scriptToBytecode,
} from '@radiantscript/utils';
import {
  Utxo,
  Output,
  Recipient,
  SatoshiAmount,
  isSignableUtxo,
  TransactionDetails,
  HashType,
} from './interfaces.js';
import {
  meep,
  createInputScript,
  getInputSize,
  createOpReturnOutput,
  getTxSizeWithoutInputs,
  getPreimageSize,
  buildError,
  addressToLockScript,
  createSighashPreimage,
  validateRecipient,
} from './utils.js';
import {
  P2SH_OUTPUT_SIZE,
  DUST_LIMIT,
  MAX_FEE_SATOSHIS,
  MAX_TRANSACTION_SIZE,
  MAX_INPUT_COUNT,
  MAX_OUTPUT_COUNT,
  MAX_SAFE_SATOSHIS,
  MAX_MONEY,
} from './constants.js';
import NetworkProvider from './network/NetworkProvider.js';
import SignatureTemplate from './SignatureTemplate.js';
import bip68 from 'bip68';

/**
 * Optional polling controls for {@link Transaction.send}.
 */
export interface SendOptions {
  /** Abort the post-broadcast polling loop. */
  signal?: AbortSignal;
  /** Override the default polling cap (1200 iterations ≈ 10 min at 500 ms). */
  maxRetries?: number;
}

export class Transaction {
  private inputs: Utxo[] = [];
  private outputs: Output[] = [];

  private sequence = 0xfffffffe;
  private locktime: number;
  private hardcodedFee: number | undefined;
  private feePerByte = 1.0;
  private minChange = DUST_LIMIT;
  private verifyPrevoutsEnabled = true;

  constructor(
    private address: string,
    private provider: NetworkProvider,
    private redeemScript: Script,
    private abiFunction: AbiFunction,
    private args: (Uint8Array | SignatureTemplate)[],
    private selector?: number,
  ) {}

  from(input: Utxo): this;
  from(inputs: Utxo[]): this;

  from(inputOrInputs: Utxo | Utxo[]): this {
    if (!Array.isArray(inputOrInputs)) {
      inputOrInputs = [inputOrInputs];
    }

    this.inputs = this.inputs.concat(inputOrInputs);

    return this;
  }

  experimentalFromP2PKH(input: Utxo, template: SignatureTemplate): this;
  experimentalFromP2PKH(inputs: Utxo[], template: SignatureTemplate): this;

  /**
   * @deprecated This is an experimental feature that may be removed or changed in future versions.
   * Use with caution in production. Consider using the standard `from()` method instead.
   */
  experimentalFromP2PKH(inputOrInputs: Utxo | Utxo[], template: SignatureTemplate): this {
    // eslint-disable-next-line no-console
    console.warn('WARNING: experimentalFromP2PKH is an experimental feature. Use with caution in production.');

    if (!Array.isArray(inputOrInputs)) {
      inputOrInputs = [inputOrInputs];
    }

    inputOrInputs = inputOrInputs.map((input) => ({ ...input, template }));

    this.inputs = this.inputs.concat(inputOrInputs);

    return this;
  }

  to(to: string, amount: SatoshiAmount): this;
  to(outputs: Recipient[]): this;

  to(toOrOutputs: string | Recipient[], amount?: SatoshiAmount): this {
    if (typeof toOrOutputs === 'string' && (typeof amount === 'number' || typeof amount === 'bigint')) {
      return this.to([{ to: toOrOutputs, amount }]);
    }

    if (Array.isArray(toOrOutputs) && amount === undefined) {
      toOrOutputs.forEach(validateRecipient);
      this.outputs = this.outputs.concat(toOrOutputs);
      return this;
    }

    throw new Error('Incorrect arguments passed to function \'to\'');
  }

  withOpReturn(chunks: string[]): this {
    this.outputs.push(createOpReturnOutput(chunks));
    return this;
  }

  withAge(age: number): this {
    this.sequence = bip68.encode({ blocks: age });
    return this;
  }

  withTime(time: number): this {
    this.locktime = time;
    return this;
  }

  withHardcodedFee(hardcodedFee: number): this {
    if (hardcodedFee < 0) {
      throw new Error(`Fee cannot be negative: ${hardcodedFee}`);
    }
    if (hardcodedFee > MAX_FEE_SATOSHIS) {
      throw new Error(`Fee ${hardcodedFee} exceeds maximum allowed fee of ${MAX_FEE_SATOSHIS} satoshis`);
    }
    this.hardcodedFee = hardcodedFee;
    return this;
  }

  /**
   * Set the fee rate in satoshis per byte. The value is clamped to a maximum
   * of **100 sat/byte** as a safety belt against runaway fees from caller bugs
   * (e.g. forgetting to convert from sat/kB). Pass a value of 0 only if you
   * know what you are doing — the resulting transaction will likely be
   * rejected by relay policy.
   *
   * If you genuinely need to broadcast at >100 sat/byte during extreme
   * congestion, build the transaction yourself with `withHardcodedFee()`.
   *
   * @throws If `feePerByte` is negative or greater than 100.
   */
  withFeePerByte(feePerByte: number): this {
    if (feePerByte < 0) {
      throw new Error(`Fee per byte cannot be negative: ${feePerByte}`);
    }
    if (feePerByte > 100) {
      throw new Error(`Fee per byte ${feePerByte} exceeds reasonable maximum of 100 sats/byte`);
    }
    this.feePerByte = feePerByte;
    return this;
  }

  withMinChange(minChange: number): this {
    if (minChange < 0) {
      throw new Error(`Minimum change cannot be negative: ${minChange}`);
    }
    this.minChange = minChange;
    return this;
  }

  withoutChange(): this {
    return this.withMinChange(Number.MAX_VALUE);
  }

  /**
   * Disable the (default-on) prevout verification performed before signing.
   *
   * By default `build()` fetches and authenticates each input's source
   * transaction (`hash256(rawtx) == txid`) and asserts the prevout's value and
   * locking script match what is being signed (see {@link verifyPrevouts} /
   * audit H-2). Disable this ONLY for offline signing or tests where source
   * transactions cannot be retrieved — skipping it re-opens the risk of a
   * malicious or buggy provider making you sign over a wrong input amount, or a
   * UTXO whose script you do not actually control.
   */
  withoutPrevoutVerification(): this {
    this.verifyPrevoutsEnabled = false;
    return this;
  }

  async build(): Promise<string> {
    this.locktime = this.locktime ?? await this.provider.getBlockHeight();
    await this.setInputsAndOutputs();

    // Validate input/output counts
    if (this.inputs.length > MAX_INPUT_COUNT) {
      throw new Error(`Too many inputs: ${this.inputs.length} exceeds maximum of ${MAX_INPUT_COUNT}`);
    }
    if (this.outputs.length > MAX_OUTPUT_COUNT) {
      throw new Error(`Too many outputs: ${this.outputs.length} exceeds maximum of ${MAX_OUTPUT_COUNT}`);
    }

    const secp256k1 = await instantiateSecp256k1();

    // H-2 (full): authenticate every input's prevout (value + locking script)
    // against its source transaction BEFORE signing, so a malicious/buggy
    // provider cannot make us sign over a wrong amount or a script we do not
    // control. Default-on; opt out with .withoutPrevoutVerification().
    if (this.verifyPrevoutsEnabled) {
      await this.verifyPrevouts(secp256k1);
    }

    const bytecode = scriptToBytecode(this.redeemScript);

    const inputs = this.inputs.map((utxo) => ({
      outpointIndex: utxo.vout,
      outpointTransactionHash: hexToBin(utxo.txid),
      sequenceNumber: this.sequence,
      unlockingBytecode: new Uint8Array(),
    }));

    // Validate amount bounds before conversion
    this.outputs.forEach((output) => this.validateAmount(output.amount));

    const outputs = this.outputs.map((output) => {
      const lockingBytecode = typeof output.to === 'string'
        ? addressToLockScript(output.to)
        : output.to;

      const satoshis = bigIntToBinUint64LE(toBigSat(output.amount));

      return { lockingBytecode, satoshis };
    });

    const transaction = {
      inputs,
      locktime: this.locktime,
      outputs,
      version: 2,
    };

    const inputScripts: Uint8Array[] = [];

    this.inputs.forEach((utxo, i) => {
      // UTXO's with signature templates are signed using P2PKH
      if (isSignableUtxo(utxo)) {
        const pubkey = utxo.template.getPublicKey(secp256k1);
        const pubkeyHash = hash160(pubkey);

        const addressContents = { payload: pubkeyHash, type: AddressType.p2pkh };
        const prevOutScript = addressContentsToLockingBytecode(addressContents);

        const hashtype = utxo.template.getHashType();
        this.assertSingleHasOutput(hashtype, i);
        const preimage = createSighashPreimage(transaction, utxo, i, prevOutScript, hashtype);
        const sighash = hash256(preimage);

        const signature = utxo.template.generateSignature(sighash, secp256k1);

        const inputScript = scriptToBytecode([signature, pubkey]);
        inputScripts.push(inputScript);

        return;
      }

      let covenantHashType = -1;
      const completeArgs = this.args.map((arg) => {
        if (!(arg instanceof SignatureTemplate)) return arg;

        const argHashType = arg.getHashType();

        // First signature is used for sighash preimage (maybe not the best way)
        if (covenantHashType < 0) {
          covenantHashType = argHashType;
        } else if (covenantHashType !== argHashType) {
          // L-2: the on-stack preimage is built from the first signature's hash
          // type only, so all covenant signatures must agree on it — otherwise
          // the later signatures would be verified against the wrong preimage.
          throw new Error('All covenant signatures must use the same hash type');
        }

        this.assertSingleHasOutput(argHashType, i);

        const preimage = createSighashPreimage(transaction, utxo, i, bytecode, argHashType);
        const sighash = hash256(preimage);

        return arg.generateSignature(sighash, secp256k1);
      });

      const preimage = this.abiFunction.covenant
        ? createSighashPreimage(transaction, utxo, i, bytecode, covenantHashType)
        : undefined;

      const inputScript = createInputScript(
        this.redeemScript, completeArgs, this.selector, preimage,
      );

      inputScripts.push(inputScript);
    });

    inputScripts.forEach((script, i) => {
      // libauth narrowed input.unlockingBytecode to Uint8Array<ArrayBuffer>
      // in v1.19; our helpers return Uint8Array<ArrayBufferLike>. Both wrap
      // owned (non-Shared) memory in practice, so the variance is a
      // type-system artefact only.
      transaction.inputs[i].unlockingBytecode = script as Uint8Array<ArrayBuffer>;
    });

    const txHex = binToHex(encodeTransaction(transaction));

    // Validate transaction size
    if (txHex.length / 2 > MAX_TRANSACTION_SIZE) {
      throw new Error(`Transaction size ${txHex.length / 2} bytes exceeds maximum of ${MAX_TRANSACTION_SIZE} bytes`);
    }

    return txHex;
  }

  async send(opts?: SendOptions): Promise<TransactionDetails>;
  async send(raw: true, opts?: SendOptions): Promise<string>;

  /**
   * Broadcast the transaction and poll the network until it is confirmed visible.
   *
   * @param raw   When `true`, returns the raw transaction hex instead of decoded details.
   * @param opts  Optional polling controls:
   *              - `signal`:    `AbortSignal` to cancel the polling loop. The poll throws
   *                             `'getTxDetails aborted by caller'` on next iteration.
   *              - `maxRetries`: Override the default 1200 (≈10 min @ 500 ms) polling cap.
   */
  async send(
    rawOrOpts?: true | SendOptions,
    maybeOpts?: SendOptions,
  ): Promise<TransactionDetails | string> {
    const raw = rawOrOpts === true ? true : undefined;
    const opts = (rawOrOpts === true ? maybeOpts : rawOrOpts) ?? {};
    const tx = await this.build();
    try {
      const txid = await this.provider.sendRawTransaction(tx);
      return raw
        ? await this.getTxDetails(txid, raw, opts.signal, opts.maxRetries)
        : await this.getTxDetails(txid, undefined, opts.signal, opts.maxRetries);
    } catch (e: any) {
      const reason = e.error ?? e.message;
      throw buildError(reason, meep(tx, this.inputs, this.redeemScript, this.provider.network));
    }
  }

  private async getTxDetails(
    txid: string,
    raw?: true,
    signal?: AbortSignal,
    maxRetries: number = 1200,
  ): Promise<TransactionDetails | string> {
    const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
    for (let retries = 0; retries < maxRetries; retries += 1) {
      if (signal?.aborted) {
        throw new Error('getTxDetails aborted by caller');
      }
      await sleep(500);
      let hex: string;
      try {
        hex = await this.provider.getRawTransaction(txid);
      } catch (ignored) {
        // tx not yet visible on the network — keep polling.
        continue;
      }

      // H-3: don't trust the server's hex blindly — verify it hashes to the
      // txid we asked for before re-stamping it. A mismatch means the provider
      // returned the wrong transaction, so surface it rather than swallow-and-
      // retry.
      const bytes = hexToBin(hex);
      const computed = this.computeDisplayTxid(bytes);
      if (computed !== txid) {
        throw new Error(`Provider returned tx ${computed} for requested ${txid}`);
      }

      if (raw) return hex;

      const libauthTransaction = decodeTransaction(bytes) as LibauthTransaction;
      return { ...libauthTransaction, txid, hex };
    }

    throw new Error('Could not retrieve transaction details for over 10 minutes');
  }

  async meep(): Promise<string> {
    const tx = await this.build();
    return meep(tx, this.inputs, this.redeemScript, this.provider.network);
  }

  private async setInputsAndOutputs(): Promise<void> {
    if (this.outputs.length === 0) {
      throw Error('Attempted to build a transaction without outputs');
    }

    // Replace all SignatureTemplate with 65-length placeholder Uint8Arrays
    const placeholderArgs = this.args.map((arg) => (
      arg instanceof SignatureTemplate ? placeholder(65) : arg
    ));

    // Create a placeholder preimage of the correct size
    const placeholderPreimage = this.abiFunction.covenant
      ? placeholder(getPreimageSize(scriptToBytecode(this.redeemScript)))
      : undefined;

    // Create a placeholder input script for size calculation using the placeholder
    // arguments and correctly sized placeholder preimage
    const placeholderScript = createInputScript(
      this.redeemScript,
      placeholderArgs,
      this.selector,
      placeholderPreimage,
    );

    // Add one extra byte per input to over-estimate tx-in count
    const inputSize = getInputSize(placeholderScript) + 1;

    // Output amounts may be number or bigint; do all amount-vs-amount math in
    // bigint so we don't lose precision for values above Number.MAX_SAFE_INTEGER.
    // Fees and sizes stay in number — they're bounded by MAX_FEE_SATOSHIS
    // (<=10^6) and MAX_TRANSACTION_SIZE (<=10^5) and never approach 2^53.
    // Validate every output's amount before summing so a malformed value
    // surfaces here rather than as a downstream BigInt() throw.
    this.outputs.forEach((output) => this.validateAmount(output.amount));
    const amount = this.outputs.reduce<bigint>((acc, output) => acc + toBigSat(output.amount), 0n);

    // An explicit `withHardcodedFee(0)` is a legitimate request for a zero fee
    // — distinguish "set to 0" from "unset" so a hardcoded zero is honoured
    // exactly (no per-input fees or change-output deduction sneak back in).
    const useHardcodedFee = this.hardcodedFee !== undefined;
    let fee = useHardcodedFee
      ? this.hardcodedFee!
      : getTxSizeWithoutInputs(this.outputs) * this.feePerByte;

    // Select and gather UTXOs and calculate fees and available funds.
    // satsAvailable is also tracked in bigint to stay comparable to `amount`.
    // NOTE (H-2): input satoshis ultimately flow unverified into the sighash
    // preimage (see utils.ts createSighashPreimage). We range-validate every
    // input's satoshis here the same way outputs are validated, but full safety
    // requires verifying each input's prevout value+script against the source
    // transaction — out of scope for this fix as it would change the provider
    // contract (a prevout fetch). See H-2.
    let satsAvailable = 0n;
    if (this.inputs.length > 0) {
      // If inputs are already defined, the user provided the UTXOs
      // and we perform no further UTXO selection
      this.inputs.forEach((input) => this.validateAmount(input.satoshis));
      if (!useHardcodedFee) fee += this.inputs.length * inputSize * this.feePerByte;
      satsAvailable = this.inputs.reduce<bigint>((acc, input) => acc + BigInt(input.satoshis), 0n);
    } else {
      // If inputs are not defined yet, we retrieve the contract's UTXOs and perform selection
      const utxos = await this.provider.getUtxos(this.address);

      // We sort the UTXOs mainly so there is consistent behaviour between network providers
      // even if they report UTXOs in a different order
      utxos.sort((a, b) => b.satoshis - a.satoshis);

      for (const utxo of utxos) {
        this.validateAmount(utxo.satoshis);
        this.inputs.push(utxo);
        satsAvailable += BigInt(utxo.satoshis);
        if (!useHardcodedFee) fee += inputSize * this.feePerByte;
        if (satsAvailable > amount + BigInt(Math.ceil(fee))) break;
      }
    }

    // Fee per byte can be a decimal number, but we need the total fee to be an integer
    const feeBig = BigInt(Math.ceil(fee));

    // Calculate change and check available funds
    let change = satsAvailable - amount - feeBig;

    if (change < 0n) {
      throw new Error(`Insufficient funds: available (${satsAvailable}) < needed (${amount + feeBig}).`);
    }

    // Account for the fee of a change output. Scale by feePerByte so the change
    // path doesn't underpay when the relay floor forces feePerByte >> 1 (H-4).
    if (!useHardcodedFee) {
      change -= BigInt(Math.ceil(P2SH_OUTPUT_SIZE * this.feePerByte));
    }

    // Add a change output if applicable
    if (change >= BigInt(DUST_LIMIT) && change >= BigInt(this.minChange)) {
      this.outputs.push({ to: this.address, amount: change });
    }
  }

  /**
   * Radiant/Bitcoin display txid: the byte-reversed `hash256` of the raw
   * transaction bytes. Shared by `getTxDetails` (H-3) and prevout
   * authentication (H-2) so both use the identical convention.
   */
  // eslint-disable-next-line class-methods-use-this
  private computeDisplayTxid(rawTxBytes: Uint8Array): string {
    return binToHex(hash256(rawTxBytes).reverse());
  }

  /**
   * Verify every input's prevout against its authenticated source transaction
   * before signing (audit H-2 — full fix).
   *
   * The SDK commits each input's `satoshis` value (and, via the covenant
   * preimage, the prevout context) into the sighash. A malicious or buggy
   * network provider that lied about a UTXO's value or script could otherwise
   * make the caller sign over the wrong input amount (invalid signature /
   * griefing), or — for a covenant that derives a payout/split from the spent
   * value (e.g. an AMM or prediction market) — be steered toward an
   * attacker-favourable result. For each input we:
   *
   *  1. fetch its source transaction and re-derive the txid
   *     (`hash256(rawtx)` reversed). A provider therefore cannot substitute a
   *     forged source transaction with altered values, because it would no
   *     longer hash to the outpoint txid the spender already committed to;
   *  2. assert the referenced output index exists in that transaction;
   *  3. assert the prevout value equals the `satoshis` we are about to sign;
   *  4. assert the prevout locking script equals the script we expect to be
   *     unlocking — the contract's P2SH script for covenant inputs, or the
   *     P2PKH script of the signing key for `experimentalFromP2PKH` inputs;
   *  5. range-check the value to Radiant's consensus `[0, MAX_MONEY]`.
   *
   * Source transactions are fetched once per unique txid and in parallel.
   */
  private async verifyPrevouts(
    secp256k1: Awaited<ReturnType<typeof instantiateSecp256k1>>,
  ): Promise<void> {
    const uniqueTxids = [...new Set(this.inputs.map((utxo) => utxo.txid))];

    // Fetch + authenticate each distinct source transaction exactly once.
    const sourceTxs = new Map<string, LibauthTransaction>();
    await Promise.all(uniqueTxids.map(async (txid) => {
      let hex: string;
      try {
        hex = await this.provider.getRawTransaction(txid);
      } catch (e: any) {
        throw new Error(
          `Prevout verification failed: could not fetch source transaction ${txid} `
          + `(${e?.message ?? e}). Use a provider that serves source transactions, `
          + 'or call .withoutPrevoutVerification() to skip (unsafe).',
        );
      }

      const bytes = hexToBin(hex);
      const computed = this.computeDisplayTxid(bytes);
      if (computed !== txid) {
        throw new Error(
          `Prevout verification failed: provider returned transaction ${computed} `
          + `when ${txid} was requested.`,
        );
      }

      const decoded = decodeTransaction(bytes);
      if (typeof decoded === 'string') {
        throw new Error(`Prevout verification failed: could not decode source transaction ${txid}: ${decoded}`);
      }
      sourceTxs.set(txid, decoded);
    }));

    // For covenant inputs we expect the contract's own P2SH locking script.
    const contractLockingBytecode = addressToLockScript(this.address);

    this.inputs.forEach((utxo, i) => {
      // (5) consensus money-range check on the value we are about to commit.
      this.assertMoneyRange(utxo.satoshis, i);

      const sourceTx = sourceTxs.get(utxo.txid)!;

      // (2) the referenced output index must exist in the source transaction.
      if (utxo.vout < 0 || utxo.vout >= sourceTx.outputs.length) {
        throw new Error(
          `Prevout verification failed: input ${i} spends ${utxo.txid}:${utxo.vout}, `
          + `but that transaction has only ${sourceTx.outputs.length} output(s).`,
        );
      }
      const prevout = sourceTx.outputs[utxo.vout];

      // (3) the prevout value must equal the satoshis we are about to sign over
      //     (libauth 1.19 decodes output value as an 8-byte LE Uint8Array).
      const claimed = bigIntToBinUint64LE(BigInt(utxo.satoshis));
      if (binToHex(prevout.satoshis) !== binToHex(claimed)) {
        throw new Error(
          `Prevout verification failed: input ${i} (${utxo.txid}:${utxo.vout}) is `
          + `declared as ${utxo.satoshis} sat, but its source output holds `
          + `${leBytesToBigInt(prevout.satoshis)} sat. Refusing to sign over a `
          + 'mismatched input amount.',
        );
      }

      // (4) the prevout locking script must be the script we expect to unlock.
      const expectedScript = isSignableUtxo(utxo)
        ? addressContentsToLockingBytecode({
          payload: hash160(utxo.template.getPublicKey(secp256k1)),
          type: AddressType.p2pkh,
        })
        : contractLockingBytecode;

      if (binToHex(prevout.lockingBytecode) !== binToHex(expectedScript)) {
        throw new Error(
          `Prevout verification failed: input ${i} (${utxo.txid}:${utxo.vout}) has `
          + `prevout script ${binToHex(prevout.lockingBytecode)}, which does not `
          + `match the expected ${isSignableUtxo(utxo) ? 'P2PKH (signing key)' : 'contract P2SH'} `
          + `script ${binToHex(expectedScript)}. This UTXO does not belong to the `
          + 'address being spent.',
        );
      }
    });
  }

  /**
   * Assert a satoshi value is an integer within Radiant's consensus money range
   * `[0, MAX_MONEY]` (audit H-2). `Utxo.satoshis` is a `number`; reject
   * non-integer / negative / over-range values before they reach the sighash.
   */
  // eslint-disable-next-line class-methods-use-this
  private assertMoneyRange(satoshis: number, i: number): void {
    if (!Number.isInteger(satoshis) || satoshis < 0) {
      throw new Error(
        `Prevout verification failed: input ${i} has a non-integer or negative satoshi value: ${satoshis}`,
      );
    }
    if (BigInt(satoshis) > MAX_MONEY) {
      throw new Error(
        `Prevout verification failed: input ${i} satoshi value ${satoshis} exceeds MAX_MONEY (${MAX_MONEY}).`,
      );
    }
  }

  /**
   * Guard against the classic SIGHASH_SINGLE bug (M-5): a signer at input index
   * `i` with `i >= outputs.length` signs the zeroed (all-ones) output hash,
   * which is a well-known footgun. Reject it up front with a clear error.
   * The `hashtype` carries the forkId flag OR'd in, so mask to the base type.
   */
  private assertSingleHasOutput(hashtype: number, i: number): void {
    if ((hashtype & 0x1f) === HashType.SIGHASH_SINGLE && i >= this.outputs.length) {
      throw new Error(
        `SIGHASH_SINGLE signer at input index ${i} has no corresponding output `
        + `(only ${this.outputs.length} output(s)); this would sign the zeroed output hash`,
      );
    }
  }

  /**
   * Validates that an amount is within safe bounds for transaction outputs.
   * Prevents integer overflow and negative amount issues. Accepts either
   * a number (must be a safe integer) or a bigint (must fit in uint64).
   */
  private validateAmount(amount: SatoshiAmount): void {
    if (typeof amount === 'number') {
      if (!Number.isInteger(amount)) {
        throw new Error(`Amount must be an integer: got ${amount}`);
      }
      if (amount < 0) {
        throw new Error(`Amount cannot be negative: ${amount}`);
      }
      if (amount > Number.MAX_SAFE_INTEGER) {
        throw new Error(
          `Amount ${amount} exceeds Number.MAX_SAFE_INTEGER; pass as bigint to retain precision`,
        );
      }
      return;
    }

    // bigint branch
    if (amount < 0n) {
      throw new Error(`Amount cannot be negative: ${amount}n`);
    }
    if (amount > MAX_SAFE_SATOSHIS) {
      throw new Error(`Amount ${amount}n exceeds maximum uint64 satoshi value`);
    }
  }
}

/**
 * Convert any `SatoshiAmount` (number | bigint) to a bigint for arithmetic
 * or uint64 encoding. The caller is responsible for having validated the
 * value first; this helper does not range-check.
 */
function toBigSat(amount: SatoshiAmount): bigint {
  return typeof amount === 'bigint' ? amount : BigInt(amount);
}

/**
 * Decode an unsigned little-endian byte array (e.g. libauth's 8-byte output
 * `satoshis`) to a bigint. Used only to render human-readable amounts in
 * prevout-verification error messages.
 */
function leBytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let k = bytes.length - 1; k >= 0; k -= 1) {
    value = (value << 8n) | BigInt(bytes[k]);
  }
  return value;
}
