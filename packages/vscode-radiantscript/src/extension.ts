import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('RadiantScript extension is now active');

  // Create diagnostic collection for error reporting
  diagnosticCollection = vscode.languages.createDiagnosticCollection('radiantscript');
  context.subscriptions.push(diagnosticCollection);

  // Register compile command
  const compileCommand = vscode.commands.registerCommand(
    'radiantscript.compile',
    compileCurrentContract
  );
  context.subscriptions.push(compileCommand);

  // Register deploy command
  const deployCommand = vscode.commands.registerCommand(
    'radiantscript.deploy',
    deployCurrentContract
  );
  context.subscriptions.push(deployCommand);

  // Register on-save compilation
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.languageId === 'radiantscript') {
      validateDocument(document);
    }
  });
  context.subscriptions.push(onSave);

  // Validate open documents
  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (doc.languageId === 'radiantscript') {
      validateDocument(doc);
    }
  }

  // Register hover provider for built-in functions
  const hoverProvider = vscode.languages.registerHoverProvider('radiantscript', {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position);
      const word = document.getText(range);
      
      const documentation = getBuiltinDocumentation(word);
      if (documentation) {
        return new vscode.Hover(documentation);
      }
      return null;
    }
  });
  context.subscriptions.push(hoverProvider);
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}

async function compileCurrentContract() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  if (editor.document.languageId !== 'radiantscript') {
    vscode.window.showErrorMessage('Current file is not a RadiantScript file');
    return;
  }

  await editor.document.save();
  const filePath = editor.document.uri.fsPath;

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Compiling RadiantScript contract...',
      cancellable: false
    },
    async () => {
      try {
        // Try to use rxdc compiler
        const result = await runCompiler(filePath);
        
        if (result.success) {
          vscode.window.showInformationMessage(
            `Contract compiled successfully: ${result.contractName}`
          );
          
          // Write artifact to file
          const artifactPath = filePath.replace(/\.(rxd|cash)$/, '.json');
          fs.writeFileSync(artifactPath, JSON.stringify(result.artifact, null, 2));
          vscode.window.showInformationMessage(`Artifact saved to ${path.basename(artifactPath)}`);
        } else {
          vscode.window.showErrorMessage(`Compilation failed: ${result.error}`);
          
          // Show diagnostics
          if (result.line !== undefined) {
            const diagnostic = new vscode.Diagnostic(
              new vscode.Range(result.line - 1, 0, result.line - 1, 100),
              result.error || 'Compilation error',
              vscode.DiagnosticSeverity.Error
            );
            diagnosticCollection.set(editor.document.uri, [diagnostic]);
          }
        }
      } catch (error: any) {
        vscode.window.showErrorMessage(`Compilation error: ${error.message}`);
      }
    }
  );
}

async function deployCurrentContract() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  // First compile
  await compileCurrentContract();

  const filePath = editor.document.uri.fsPath;
  const artifactPath = filePath.replace(/\.(rxd|cash)$/, '.json');

  if (!fs.existsSync(artifactPath)) {
    vscode.window.showErrorMessage('No compiled artifact found. Please compile first.');
    return;
  }

  // Show deployment options
  const network = await vscode.window.showQuickPick(['testnet', 'mainnet'], {
    placeHolder: 'Select network for deployment'
  });

  if (!network) {
    return;
  }

  if (network === 'mainnet') {
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to deploy to MAINNET? This will use real RXD.',
      'Yes, Deploy',
      'Cancel'
    );
    if (confirm !== 'Yes, Deploy') {
      return;
    }
  }

  vscode.window.showInformationMessage(
    `Deployment to ${network} requires the rxd-deploy CLI. Run:\n` +
    `npx rxd-deploy deploy ${artifactPath} --network ${network}`
  );

  // Open terminal with command
  const terminal = vscode.window.createTerminal('RadiantScript Deploy');
  terminal.show();
  terminal.sendText(`npx rxd-deploy deploy "${artifactPath}" --network ${network}`);
}

async function validateDocument(document: vscode.TextDocument) {
  diagnosticCollection.clear();
  
  const text = document.getText();
  const diagnostics: vscode.Diagnostic[] = [];

  // Basic validation - check for pragma
  if (!text.includes('pragma radiant')) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      'Missing pragma directive. Add: pragma radiant ^0.7.0;',
      vscode.DiagnosticSeverity.Warning
    ));
  }

  // Check for contract declaration
  if (!text.includes('contract ')) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      'No contract declaration found',
      vscode.DiagnosticSeverity.Warning
    ));
  }

  // Check for balanced braces
  const openBraces = (text.match(/{/g) || []).length;
  const closeBraces = (text.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    diagnostics.push(new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      `Unbalanced braces: ${openBraces} opening, ${closeBraces} closing`,
      vscode.DiagnosticSeverity.Error
    ));
  }

  // Check for common mistakes
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    // Check for missing semicolons after require
    if (line.includes('require(') && !line.includes(';') && !line.trim().endsWith('{')) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(index, 0, index, line.length),
        'Missing semicolon after require statement',
        vscode.DiagnosticSeverity.Error
      ));
    }
  });

  diagnosticCollection.set(document.uri, diagnostics);
}

interface CompileResult {
  success: boolean;
  contractName?: string;
  artifact?: object;
  error?: string;
  line?: number;
}

async function runCompiler(filePath: string): Promise<CompileResult> {
  const config = vscode.workspace.getConfiguration('radiantscript');
  const compilerPath = config.get<string>('compiler.path');

  // If no compiler path, try to use rxdc from node_modules or npx
  if (!compilerPath) {
    // For now, return a mock result indicating compiler not found
    // In a real implementation, this would call rxdc
    return {
      success: false,
      error: 'rxdc compiler not found. Install with: npm install -g rxdc'
    };
  }

  // Execute compiler (placeholder for actual implementation)
  return {
    success: false,
    error: 'Compiler execution not yet implemented'
  };
}

function getBuiltinDocumentation(word: string): vscode.MarkdownString | null {
  const docs: Record<string, string> = {
    'checkSig': '**checkSig(sig, pubkey): bool**\n\nVerifies that the signature is valid for the public key.',
    'checkMultiSig': '**checkMultiSig(sig[], pubkey[]): bool**\n\nVerifies M-of-N multi-signature.',
    'checkDataSig': '**checkDataSig(datasig, bytes, pubkey): bool**\n\nVerifies a data signature (signs arbitrary data, not transaction).',
    'sha256': '**sha256(bytes): bytes32**\n\nComputes SHA-256 hash.',
    'sha512_256': '**sha512_256(bytes): bytes32**\n\nComputes SHA-512/256 hash (Radiant-specific).',
    'hash256': '**hash256(bytes): bytes32**\n\nComputes double SHA-256 hash.',
    'hash160': '**hash160(bytes): bytes20**\n\nComputes RIPEMD-160(SHA-256(data)).',
    'ripemd160': '**ripemd160(bytes): bytes20**\n\nComputes RIPEMD-160 hash.',
    'abs': '**abs(int): int**\n\nReturns absolute value.',
    'min': '**min(int, int): int**\n\nReturns minimum of two values.',
    'max': '**max(int, int): int**\n\nReturns maximum of two values.',
    'within': '**within(int x, int min, int max): bool**\n\nReturns true if min <= x < max.',
    'size': '**size(bytes): int**\n\nReturns byte length.',
    'split': '**split(bytes, int): bytes, bytes**\n\nSplits bytes at position.',
    'reverse': '**reverse(bytes): bytes**\n\nReverses byte order.',
    'require': '**require(bool)**\n\nAborts execution if condition is false.',
    'checkLockTime': '**checkLockTime(int): void**\n\nVerifies transaction locktime.',
    'checkSequence': '**checkSequence(int): void**\n\nVerifies input sequence for relative timelocks.',
    'pubkey': '**pubkey**\n\nPublic key type (33 or 65 bytes).',
    'sig': '**sig**\n\nSignature type (DER-encoded ECDSA signature).',
    'datasig': '**datasig**\n\nData signature type (Schnorr or ECDSA over arbitrary data).',
    'bytes32': '**bytes32**\n\n32-byte fixed-size byte array.',
    'bytes20': '**bytes20**\n\n20-byte fixed-size byte array (address hash).',
  };

  const doc = docs[word];
  if (doc) {
    const md = new vscode.MarkdownString(doc);
    md.isTrusted = true;
    return md;
  }
  return null;
}
