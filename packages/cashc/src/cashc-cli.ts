#! /usr/bin/env node
import {
  asmToScript,
  calculateBytesize,
  countOpcodes,
  exportArtifact,
} from '@radiantscript/utils';
import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { hexWithPlaceholders } from './compiler.js';
import { compileFile, version } from './index.js';

program
  .storeOptionsAsProperties(false)
  .name('rxdc')
  .version(version, '-V, --version', 'Output the version number.')
  .usage('[options] [source_file]')
  .option('-o, --output <path>', 'Specify a file to output the generated artifact.')
  .option('-h, --hex', 'Compile the contract to hex format rather than a full artifact.')
  .option('-A, --asm', 'Compile the contract to ASM format rather than a full artifact.')
  .option('-c, --opcount', 'Display the number of opcodes in the compiled bytecode.')
  .option('-s, --size', 'Display the size in bytes of the compiled bytecode.')
  .option('-d, --debug', 'Include source code and source map in artifact for debugging with rxdeb.')
  .helpOption('-?, --help', 'Display help')
  .parse();

const opts = program.opts();

run();

function run(): void {
  ensure(program.args.length === 1, 'Please provide exactly one source file');
  ensure(!(opts.asm && opts.hex), 'Flags --asm and --hex cannot be used together');
  ensure(!(opts.asm || opts.hex) || !opts.output, 'Flags --asm or --hex cannot be used with --output');
  ensure(!opts.args || opts.asm || opts.hex, '--args can only be used with --asm or --hex');

  const sourceFile = path.resolve(program.args[0]);
  ensure(fs.existsSync(sourceFile) && fs.statSync(sourceFile).isFile(), 'Please provide a valid source file');

  const outputFile = opts.output && opts.output !== '-' && path.resolve(opts.output);

  try {
    // Security warning for debug mode
    if (opts.debug) {
      console.warn('⚠️  SECURITY WARNING: Debug mode includes full source code in the artifact.');
      console.warn('   Do not publish debug artifacts to public repositories or the blockchain.');
      console.warn('   Source code exposure may aid attackers in finding vulnerabilities.\n');
    }

    const artifact = compileFile(sourceFile, { debug: opts.debug });
    const script = asmToScript(artifact.asm);

    const opcount = countOpcodes(script);
    const bytesize = calculateBytesize(script);

    if (opcount > 32000000) {
      console.warn('Warning: Your contract\'s opcount is over the limit of 32,000,000 and will not be accepted by the Radiant network');
    }
    if (bytesize > 32000000) {
      console.warn('Warning: Your contract\'s bytesize is over the limit of 32,000,000 bytes and will not be accepted by the Radiant network');
    }

    if (opts.asm) {
      console.log(artifact.asm);
      return;
    }

    if (opts.hex) {
      console.log(hexWithPlaceholders(artifact.asm));
      return;
    }

    // Opcount and size checks can happen together, but do not output compilation result
    if (opts.opcount || opts.size) {
      if (opts.opcount) {
        console.log('Opcode count:', opcount);
      }
      if (opts.size) {
        console.log('Bytesize:', bytesize);
      }
      return;
    }

    artifact.hex = hexWithPlaceholders(artifact.asm);

    if (outputFile) {
      // Create output file and write the artifact to it
      const outputDir = path.dirname(outputFile);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      exportArtifact(artifact, outputFile);
    } else {
      // Output artifact to STDOUT
      console.log(JSON.stringify(artifact, null, 2));
    }
  } catch (e: any) {
    abort(e.message);
  }
}

function ensure(condition: boolean, msg: string, code?: number): void {
  condition || abort(msg, code);
}

function abort(msg: string, code: number = 1): void {
  console.error(msg);
  process.exit(code);
}
