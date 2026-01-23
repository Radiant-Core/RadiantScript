# rxdc - RadiantScript Compiler

[![NPM Version](https://img.shields.io/npm/v/rxdc.svg)](https://www.npmjs.com/package/rxdc)
[![NPM License](https://img.shields.io/npm/l/rxdc.svg)](https://www.npmjs.com/package/rxdc)

RadiantScript is a high-level programming language for smart contracts on Radiant. It offers a strong abstraction layer over Radiant's native virtual machine, including support for Radiant-specific opcodes like reference tokens, state management, and transaction introspection.

See the [GitHub repository](https://github.com/Radiant-Core/RadiantScript) for full documentation and usage examples.

## The RadiantScript Language
RadiantScript is a high-level language that allows you to write Radiant smart contracts in a straightforward and familiar way. Its syntax is inspired by Solidity, but includes Radiant-specific features like reference-based tokens and state separators. See the [language documentation](https://github.com/Radiant-Core/RadiantScript/tree/master/docs) for a full reference.

## The RadiantScript Compiler (rxdc)
RadiantScript features a compiler as a standalone command line tool, called `rxdc`. It can be installed through npm and used to compile `.rxd` files into `.json` artifact files. These artifact files can be imported into the RadiantScript JavaScript SDK or used with the `rxdeb` debugger.

### Installation
```bash
npm install -g rxdc
```

### Usage
```bash
Usage: rxdc [options] [source_file]

Options:
  -V, --version        Output the version number.
  -o, --output <path>  Specify a file to output the generated artifact.
  -h, --hex            Compile the contract to hex format rather than a full artifact.
  -A, --asm            Compile the contract to ASM format rather than a full artifact.
  -c, --opcount        Display the number of opcodes in the compiled bytecode.
  -s, --size           Display the size in bytes of the compiled bytecode.
  -d, --debug          Include source maps for debugging with rxdeb.
  -?, --help           Display help
```
