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
  buildError,
  addressToLockScript,
  createSighashPreimage,
  validateRecipient,
} from './utils.js';
import {
  resolveOutput,
  resolvedOutputsEqual,
  ResolvedOutput,
} from './OutputTemplate.js';
import {
  P2SH_OUTPUT_SIZE,
  DUST_LIMIT,
  MAX_FEE_SATOSHIS,
  MAX_TRANSACTION_SIZE,
  MAX_INPUT_COUNT,
  MAX_OUTPUT_COUNT,
  MAX_SAFE_SATOSHIS,
  MAX_MONEY,
  PREFLIGHT_FEE_PER_BYTE_WARN,
  PREFLIGHT_FEE_PER_BYTE_MAX,
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
  /**
   * Run {@link Transaction.preflight} before broadcasting and abort the send
   * (throwing the first error) if any structural check fails. Default `false`
   * — opt in to fail fast with a precise reason instead of an opaque relay
   * rejection. See `preflight()`'s docs for exactly what it does and does NOT
   * check.
   */
  preflight?: boolean;
}

/**
 * Result of {@link Transaction.preflight} — a BOUNDED, off-chain, structural
 * pre-broadcast report.
 *
 * ⚠️ IMPORTANT — READ THIS: preflight is a **bounded structural pre-flight, NOT
 * a Radiant-consensus virtual machine.** It performs cheap, honest off-chain
 * sanity checks (dust, fee bounds, input/output counts, value conservation, and
 * — if declared — the exact-output template match). It DOES NOT execute the
 * covenant script, evaluate Radiant introspection opcodes, verify signatures,
 * or model relay policy. A transaction that passes preflight can still be
 * rejected on-chain or by relay — in particular, **preflight cannot catch all
 * covenant violations** because it never runs the covenant. Treat a passing
 * report as "the obvious structural footguns are absent", not "this will be
 * accepted".
 */
export interface PreflightReport {
  /** `true` iff every check passed (`errors` is empty). */
  ok: boolean;
  /**
   * Hard failures that would make the transaction non-relayable or invalid.
   * Each is a precise, human-readable message.
   */
  errors: string[];
  /** Non-fatal advisories (e.g. an unusually high — but in-bounds — fee). */
  warnings: string[];
  /** Decoded summary of the built transaction, for logging/inspection. */
  summary: {
    /** Raw transaction hex that was checked. */
    txHex: string;
    /** Serialized size in bytes. */
    sizeBytes: number;
    inputCount: number;
    outputCount: number;
    /** Sum of input satoshis (bigint). */
    totalIn: bigint;
    /** Sum of output satoshis (bigint). */
    totalOut: bigint;
    /** Implied fee = totalIn − totalOut (bigint; may be negative on a bug). */
    fee: bigint;
    /** Fee per byte (number; `fee / sizeBytes`). */
    feePerByte: number;
  };
  /**
   * Optional provider mempool-acceptance result, present only when the provider
   * implements {@link NetworkProvider.testMempoolAccept}. Unlike the structural
   * checks, a node-side `accepted:false` CAN reflect a covenant/script failure.
   */
  mempoolAccept?: { accepted: boolean; reason?: string };
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

  // P3: the asserted ("exact") output set, if the caller opted in via
  // .withExactOutputs(). When set, build() verifies the final output set matches
  // these declared outputs (plus an optionally-allowed appended change output).
  private assertedOutputs: ResolvedOutput[] | undefined;
  private assertedAllowChange = true;

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

  /**
   * Declare the EXACT set of outputs the transaction must produce, from a single
   * source of truth, and assert at {@link build} time that the built transaction
   * matches it byte-for-byte (locking bytecode + amount).
   *
   * This is the "build the expected output, assert equality" idiom for covenant
   * safety. A covenant enforces a particular output set via on-chain
   * introspection; if the transaction BUILDER and the COVENANT disagree, the
   * spend reverts on-chain (or, for an under-constrained covenant, can be
   * steered to an attacker-favourable result). Declaring the outputs here from
   * the same template the covenant expects, and asserting equality off-chain,
   * surfaces a mismatch with a precise error before broadcast.
   *
   * Build the templates with the helpers in {@link ./OutputTemplate.js}
   * (`p2pkhOutput`, `p2shOutput`, `opReturnOutput`, `rawOutput`) — they produce
   * the same `Output` shape `.to()` uses, so the two are interchangeable.
   *
   * This REPLACES any outputs previously added via `.to()` / `.withOpReturn()`
   * and is a stricter, opt-in alternative to them — existing flows that never
   * call this are unaffected.
   *
   * @param outputs        The exact outputs (in order). At least one is required.
   * @param opts.allowChange  Whether an automatically-appended change output is
   *                          permitted beyond the declared set (default `true`).
   *                          Pass `false` to forbid change entirely; this also
   *                          suppresses change-output creation (equivalent to
   *                          `.withoutChange()`), so the built output set must
   *                          equal the declared set exactly.
   */
  withExactOutputs(outputs: Output[], opts?: { allowChange?: boolean }): this {
    if (!Array.isArray(outputs) || outputs.length === 0) {
      throw new Error('withExactOutputs requires a non-empty array of outputs');
    }
    outputs.forEach((output) => {
      if (typeof output.to === 'string') validateRecipient(output as Recipient);
    });

    this.outputs = outputs.slice();
    this.assertedOutputs = outputs.map(resolveOutput);
    this.assertedAllowChange = opts?.allowChange ?? true;

    // Forbidding change means the declared set is the whole output set, so also
    // suppress change-output creation (mirrors .withoutChange()).
    if (!this.assertedAllowChange) this.withoutChange();

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

    // P3: if an exact output set was declared via .withExactOutputs(), assert
    // the final outputs (after any appended change) match it before we sign.
    this.assertOutputsMatchTemplate();

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
      const { lockingBytecode, amount } = resolveOutput(output);
      const satoshis = bigIntToBinUint64LE(amount);

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

      const completeArgs = this.args.map((arg) => {
        if (!(arg instanceof SignatureTemplate)) return arg;

        // Each covenant signature is signed over its OWN per-arg sighash type
        // and carries its own trailing hashtype byte, so on-chain OP_CHECKSIG
        // recomputes and validates every signature independently. There is no
        // shared on-stack preimage to disagree about (the legacy
        // preimage-on-stack covenant path was removed — see P5 below), so the
        // former L-2 "all covenant signatures must use the same hash type"
        // guard was both unnecessary and over-restrictive (it wrongly rejected
        // a legitimate multi-hashtype covenant spend). It has been removed.
        const argHashType = arg.getHashType();

        this.assertSingleHasOutput(argHashType, i);

        const preimage = createSighashPreimage(transaction, utxo, i, bytecode, argHashType);
        const sighash = hash256(preimage);

        return arg.generateSignature(sighash, secp256k1);
      });

      // P5: the legacy BCH preimage-on-stack covenant path has been removed.
      // Radiant covenants use reference-based introspection, not a sighash
      // preimage pushed onto the stack, and the RadiantScript compiler never
      // sets `abiFunction.covenant` (see @radiantscript/utils artifact.ts).
      // The Contract constructor now rejects any artifact that sets it, so this
      // branch is unreachable; no preimage is ever appended to the input script.
      const inputScript = createInputScript(
        this.redeemScript, completeArgs, this.selector,
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

  /**
   * Run a BOUNDED, off-chain, pre-broadcast structural pre-flight and return a
   * {@link PreflightReport}.
   *
   * ⚠️ This is **NOT a Radiant-consensus VM.** It builds the transaction and
   * runs cheap, honest sanity checks that surface precise errors instead of an
   * opaque "non-relayable" rejection at broadcast time:
   *
   *  - **Dust**: every output's amount is ≥ the dust limit (OP_RETURN outputs,
   *    which carry 0 value by design, are exempt).
   *  - **Fee sanity**: implied fee = Σinputs − Σoutputs is within
   *    `[0, MAX_FEE_SATOSHIS]`, and fee-per-byte is not absurd (a warning above
   *    a high threshold; an error above an even higher hard cap).
   *  - **Counts**: input/output counts are within `MAX_INPUT_COUNT` /
   *    `MAX_OUTPUT_COUNT`, and there is at least one input and one output.
   *  - **Value conservation**: Σinputs == Σoutputs + fee (tautological for a
   *    fee derived this way, but it re-validates that no value is unaccounted
   *    for and that the fee is non-negative).
   *  - **Size**: serialized size ≤ `MAX_TRANSACTION_SIZE`.
   *  - **Exact-output template** (P3): if `.withExactOutputs()` was used, the
   *    built outputs match the declared set (this also runs inside `build()`).
   *  - **Provider mempool test** (optional): if the provider implements
   *    {@link NetworkProvider.testMempoolAccept}, its result is recorded.
   *
   * It does **NOT** execute the covenant, evaluate introspection opcodes, verify
   * signatures, or fully model relay policy — so a passing report does NOT
   * guarantee acceptance, and in particular **cannot catch all covenant
   * violations**. The optional provider mempool test is the only step that runs
   * actual node-side script/policy checks.
   *
   * Pure (read-only): it never broadcasts. Use it directly, or pass
   * `{ preflight: true }` to `send()` to run it first and abort on failure.
   */
  async preflight(): Promise<PreflightReport> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Building also runs prevout verification (default-on) and the P3 template
    // assertion, so structural problems that build() already rejects surface as
    // a thrown error here — wrap so the caller always gets a report shape would
    // be nicer, but build()'s own guards are hard failures by design, so we let
    // them throw. preflight's job is the cheaper relay-shaped checks below.
    const txHex = await this.build();
    const bytes = hexToBin(txHex);
    const sizeBytes = bytes.length;

    // Sum inputs (validated + populated by build()) and decoded outputs.
    const totalIn = this.inputs.reduce<bigint>((acc, i) => acc + BigInt(i.satoshis), 0n);
    const totalOut = this.outputs.reduce<bigint>((acc, o) => acc + toBigSat(o.amount), 0n);
    const fee = totalIn - totalOut;

    const inputCount = this.inputs.length;
    const outputCount = this.outputs.length;

    // --- Counts -------------------------------------------------------------
    if (inputCount === 0) errors.push('Preflight: transaction has no inputs.');
    if (outputCount === 0) errors.push('Preflight: transaction has no outputs.');
    if (inputCount > MAX_INPUT_COUNT) {
      errors.push(`Preflight: too many inputs (${inputCount} > ${MAX_INPUT_COUNT}).`);
    }
    if (outputCount > MAX_OUTPUT_COUNT) {
      errors.push(`Preflight: too many outputs (${outputCount} > ${MAX_OUTPUT_COUNT}).`);
    }

    // --- Size ---------------------------------------------------------------
    if (sizeBytes > MAX_TRANSACTION_SIZE) {
      errors.push(`Preflight: size ${sizeBytes} bytes exceeds maximum ${MAX_TRANSACTION_SIZE}.`);
    }

    // --- Dust (per output) --------------------------------------------------
    this.outputs.forEach((output, k) => {
      const amount = toBigSat(output.amount);
      // OP_RETURN outputs are 0-value by design (first byte 0x6a); exempt them.
      const isOpReturn = output.to instanceof Uint8Array && output.to[0] === 0x6a;
      if (!isOpReturn && amount < BigInt(DUST_LIMIT)) {
        errors.push(
          `Preflight: output ${k} amount ${amount} is below the dust limit (${DUST_LIMIT}).`,
        );
      }
    });

    // --- Fee sanity ---------------------------------------------------------
    if (fee < 0n) {
      errors.push(
        `Preflight: negative fee (${fee}) — outputs exceed inputs by ${-fee} satoshis.`,
      );
    } else if (fee > BigInt(MAX_FEE_SATOSHIS)) {
      errors.push(
        `Preflight: fee ${fee} exceeds MAX_FEE_SATOSHIS (${MAX_FEE_SATOSHIS}).`,
      );
    }

    // --- Value conservation -------------------------------------------------
    // Σinputs must equal Σoutputs + fee. By construction fee = totalIn − totalOut
    // so this holds whenever fee >= 0; the check makes value loss explicit and
    // double-guards against a future refactor breaking the invariant.
    if (totalIn !== totalOut + fee) {
      errors.push(
        `Preflight: value not conserved: inputs ${totalIn} != outputs ${totalOut} + fee ${fee}.`,
      );
    }

    // --- Fee-per-byte sanity ------------------------------------------------
    const feePerByteValue = sizeBytes > 0 ? Number(fee) / sizeBytes : 0;
    // Warn well before the hard error so a caller notices an over-fee in tests.
    if (fee >= 0n && feePerByteValue > PREFLIGHT_FEE_PER_BYTE_WARN) {
      warnings.push(
        `Preflight: fee-per-byte ${feePerByteValue.toFixed(2)} sat/B is unusually high `
        + `(> ${PREFLIGHT_FEE_PER_BYTE_WARN}).`,
      );
    }
    if (fee >= 0n && feePerByteValue > PREFLIGHT_FEE_PER_BYTE_MAX) {
      errors.push(
        `Preflight: fee-per-byte ${feePerByteValue.toFixed(2)} sat/B is implausibly high `
        + `(> ${PREFLIGHT_FEE_PER_BYTE_MAX}); refusing as a likely caller bug.`,
      );
    }

    // --- Optional provider mempool acceptance test --------------------------
    let mempoolAccept: { accepted: boolean; reason?: string } | undefined;
    if (typeof this.provider.testMempoolAccept === 'function') {
      try {
        mempoolAccept = await this.provider.testMempoolAccept(txHex);
        if (mempoolAccept && mempoolAccept.accepted === false) {
          errors.push(
            'Preflight: provider mempool test rejected the transaction'
            + `${mempoolAccept.reason ? `: ${mempoolAccept.reason}` : '.'}`,
          );
        }
      } catch (e: any) {
        // A provider that advertises the method but fails the call is a
        // best-effort step — record a warning, don't fail preflight on it.
        warnings.push(`Preflight: provider mempool test could not run: ${e?.message ?? e}`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      summary: {
        txHex,
        sizeBytes,
        inputCount,
        outputCount,
        totalIn,
        totalOut,
        fee,
        feePerByte: feePerByteValue,
      },
      mempoolAccept,
    };
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
   *              - `preflight`: When `true`, run {@link preflight} first and throw the
   *                             first structural error (with the full list) before
   *                             broadcasting. Note: preflight is a BOUNDED structural
   *                             check, not a consensus VM — see `preflight()`.
   */
  async send(
    rawOrOpts?: true | SendOptions,
    maybeOpts?: SendOptions,
  ): Promise<TransactionDetails | string> {
    const raw = rawOrOpts === true ? true : undefined;
    const opts = (rawOrOpts === true ? maybeOpts : rawOrOpts) ?? {};

    // When preflight is requested, run it first and REUSE its built hex so the
    // transaction is built exactly once (build() mutates input/output selection
    // and is not idempotent — a second build() would append a second change
    // output). Otherwise build() here as before.
    let tx: string;
    if (opts.preflight) {
      const report = await this.preflight();
      if (!report.ok) {
        throw new Error(
          `Preflight failed; refusing to broadcast:\n - ${report.errors.join('\n - ')}`,
        );
      }
      tx = report.summary.txHex;
    } else {
      tx = await this.build();
    }
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

    // P5: no placeholder preimage — the legacy BCH preimage-on-stack covenant
    // path was removed (Radiant uses reference-based introspection and the
    // Contract constructor rejects `covenant:true` artifacts).
    const placeholderScript = createInputScript(
      this.redeemScript,
      placeholderArgs,
      this.selector,
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
   * P3: assert the final output set matches the exact outputs declared via
   * {@link withExactOutputs}. No-op when the caller never opted in.
   *
   * The declared outputs must appear first, in order, byte-for-byte (locking
   * bytecode + amount). One trailing output beyond the declared set is permitted
   * iff it is an automatically-appended change output paying back to the
   * contract address AND `allowChange` was not set to `false`. Any other
   * divergence — wrong count, reordering, mutated amount/script, or an
   * unexpected extra output — throws with a precise message.
   */
  private assertOutputsMatchTemplate(): void {
    if (this.assertedOutputs === undefined) return;

    const declared = this.assertedOutputs;
    const built = this.outputs.map(resolveOutput);

    // The built set must be the declared set, optionally followed by exactly one
    // appended change output.
    const extra = built.length - declared.length;
    if (extra < 0 || extra > 1) {
      throw new Error(
        `Output template mismatch: declared ${declared.length} exact output(s) but the built `
        + `transaction has ${built.length}. ${this.describeOutputDelta(declared, built)}`,
      );
    }
    if (extra === 1 && !this.assertedAllowChange) {
      // Should be unreachable (allowChange:false suppresses change), but guard
      // in case a caller also added outputs after declaring the exact set.
      throw new Error(
        'Output template mismatch: an extra output is present but change was forbidden '
        + '(allowChange:false). The built output set must equal the declared set exactly.',
      );
    }

    for (let k = 0; k < declared.length; k += 1) {
      if (!resolvedOutputsEqual(declared[k], built[k])) {
        throw new Error(
          `Output template mismatch at index ${k}: declared `
          + `{ script: ${binToHex(declared[k].lockingBytecode)}, amount: ${declared[k].amount} } `
          + 'but built '
          + `{ script: ${binToHex(built[k].lockingBytecode)}, amount: ${built[k].amount} }.`,
        );
      }
    }

    // If there is a trailing extra output, it must be the change output paying
    // back to this contract/address — not an unexpected third-party payment.
    if (extra === 1) {
      const changeScript = addressToLockScript(this.address);
      const trailing = built[built.length - 1];
      if (binToHex(trailing.lockingBytecode) !== binToHex(changeScript)) {
        throw new Error(
          'Output template mismatch: the built transaction has an extra output '
          + `{ script: ${binToHex(trailing.lockingBytecode)}, amount: ${trailing.amount} } `
          + `that is not the expected change output back to ${this.address}. `
          + 'Declare it explicitly or set allowChange:false.',
        );
      }
    }
  }

  /**
   * Human-readable hint for an output-count mismatch in the template assertion.
   */
  // eslint-disable-next-line class-methods-use-this
  private describeOutputDelta(declared: ResolvedOutput[], built: ResolvedOutput[]): string {
    if (built.length > declared.length + 1) {
      return 'More outputs were built than declared (+ at most one change output is allowed).';
    }
    if (built.length < declared.length) {
      return 'Fewer outputs were built than declared — a declared output went missing.';
    }
    return '';
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
