#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { DeploymentManager } from './deploy';
import { getTemplate, listTemplates, ContractTemplate } from './templates';
import { WalletConfig } from './types';

const VERSION = '0.1.0';

program
  .name('rxd-deploy')
  .description('One-click contract deployment CLI for RadiantScript')
  .version(VERSION);

program
  .command('deploy <artifact>')
  .description('Deploy a compiled contract artifact')
  .option('-n, --network <network>', 'Network to deploy to (mainnet/testnet)', 'testnet')
  .option('-k, --key <privateKey>', 'Private key for signing (or use RXD_PRIVATE_KEY env)')
  .option('-m, --mnemonic <mnemonic>', 'Mnemonic phrase (or use RXD_MNEMONIC env)')
  .option('-b, --balance <satoshis>', 'Initial contract balance in satoshis', '546')
  .option('-a, --args <args>', 'Constructor arguments as JSON array', '[]')
  .action(async (artifactPath: string, options) => {
    const spinner = ora('Deploying contract...').start();
    
    try {
      // Load artifact
      const fullPath = path.resolve(artifactPath);
      if (!fs.existsSync(fullPath)) {
        spinner.fail(`Artifact not found: ${fullPath}`);
        process.exit(1);
      }
      
      const artifact = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      
      // Get wallet config
      const wallet: WalletConfig = {
        privateKey: options.key || process.env.RXD_PRIVATE_KEY,
        mnemonic: options.mnemonic || process.env.RXD_MNEMONIC,
      };
      
      if (!wallet.privateKey && !wallet.mnemonic) {
        spinner.fail('No wallet credentials provided. Use --key, --mnemonic, or set RXD_PRIVATE_KEY/RXD_MNEMONIC env vars.');
        process.exit(1);
      }
      
      // Parse constructor args
      const constructorArgs = JSON.parse(options.args);
      
      // Deploy
      const manager = new DeploymentManager(options.network);
      spinner.text = `Connecting to ${options.network}...`;
      await manager.connect();
      
      spinner.text = 'Broadcasting transaction...';
      const result = await manager.deploy(wallet, {
        artifact,
        constructorArgs,
        initialBalance: parseInt(options.balance, 10),
      });
      
      await manager.disconnect();
      
      if (result.success) {
        spinner.succeed(chalk.green('Contract deployed successfully!'));
        console.log('');
        console.log(chalk.bold('Deployment Details:'));
        console.log(`  ${chalk.cyan('Network:')}    ${options.network}`);
        console.log(`  ${chalk.cyan('TX ID:')}      ${result.txid}`);
        console.log(`  ${chalk.cyan('Contract:')}   ${result.contractAddress}`);
        console.log(`  ${chalk.cyan('Fee:')}        ${result.fee} satoshis`);
        console.log(`  ${chalk.cyan('Size:')}       ${result.gasUsed} bytes`);
      } else {
        spinner.fail(chalk.red(`Deployment failed: ${result.error}`));
        process.exit(1);
      }
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('compile <source>')
  .description('Compile and deploy a RadiantScript source file')
  .option('-n, --network <network>', 'Network to deploy to (mainnet/testnet)', 'testnet')
  .option('-k, --key <privateKey>', 'Private key for signing')
  .option('-m, --mnemonic <mnemonic>', 'Mnemonic phrase')
  .option('-b, --balance <satoshis>', 'Initial contract balance', '546')
  .option('-o, --output <path>', 'Save compiled artifact to file')
  .action(async (sourcePath: string, options) => {
    const spinner = ora('Compiling contract...').start();
    
    try {
      const fullPath = path.resolve(sourcePath);
      if (!fs.existsSync(fullPath)) {
        spinner.fail(`Source file not found: ${fullPath}`);
        process.exit(1);
      }
      
      const sourceCode = fs.readFileSync(fullPath, 'utf-8');
      
      // Compile
      const { compileString } = await import('rxdc');
      const artifact = compileString(sourceCode);
      
      const contractName = (artifact as any).contractName || (artifact as any).contract || 'Contract';
      spinner.succeed(chalk.green(`Compiled ${contractName}`));
      
      // Save artifact if requested
      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2));
        console.log(chalk.gray(`Artifact saved to ${outputPath}`));
      }
      
      // Deploy if wallet provided
      const wallet: WalletConfig = {
        privateKey: options.key || process.env.RXD_PRIVATE_KEY,
        mnemonic: options.mnemonic || process.env.RXD_MNEMONIC,
      };
      
      if (wallet.privateKey || wallet.mnemonic) {
        const deploySpinner = ora('Deploying contract...').start();
        
        const manager = new DeploymentManager(options.network);
        await manager.connect();
        
        const result = await manager.deploy(wallet, {
          artifact: artifact as any,
          constructorArgs: [],
          initialBalance: parseInt(options.balance, 10),
        });
        
        await manager.disconnect();
        
        if (result.success) {
          deploySpinner.succeed(chalk.green('Contract deployed!'));
          console.log(`  ${chalk.cyan('TX ID:')} ${result.txid}`);
          console.log(`  ${chalk.cyan('Contract:')} ${result.contractAddress}`);
        } else {
          deploySpinner.fail(chalk.red(`Deployment failed: ${result.error}`));
        }
      } else {
        console.log(chalk.yellow('\nTo deploy, provide --key or --mnemonic, or set RXD_PRIVATE_KEY env var.'));
      }
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('templates')
  .description('List available contract templates')
  .option('-c, --category <category>', 'Filter by category (token/nft/defi/utility)')
  .action((options) => {
    const templates = listTemplates();
    const filtered = options.category
      ? templates.filter(t => t.category === options.category)
      : templates;
    
    console.log(chalk.bold('\nAvailable Contract Templates:\n'));
    
    for (const template of filtered) {
      console.log(chalk.cyan(`  ${template.name}`));
      console.log(chalk.gray(`    ${template.description}`));
      console.log(chalk.gray(`    Category: ${template.category}`));
      console.log('');
    }
    
    console.log(chalk.gray(`Use 'rxd-deploy init <template>' to create a new project from a template.`));
  });

program
  .command('init <template>')
  .description('Initialize a new project from a template')
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('-n, --name <name>', 'Contract name')
  .action(async (templateName: string, options) => {
    const template = getTemplate(templateName);
    
    if (!template) {
      console.log(chalk.red(`Template '${templateName}' not found.`));
      console.log(chalk.gray('Use "rxd-deploy templates" to see available templates.'));
      process.exit(1);
    }
    
    // Interactive prompts for template parameters
    const answers: Record<string, any> = {};
    
    if (template.config.parameters.length > 0) {
      console.log(chalk.bold(`\nConfiguring ${template.config.name}:\n`));
      
      for (const param of template.config.parameters) {
        if (!param.required && param.default !== undefined) {
          continue; // Skip optional params with defaults in non-interactive mode
        }
        
        const questions: any[] = [{
          type: param.type === 'boolean' ? 'confirm' : 'input',
          name: param.name,
          message: `${param.description}:`,
          default: param.default,
        }];
        
        if (param.required) {
          questions[0].validate = (input: any) => !!input || 'This field is required';
        }
        
        const response = await inquirer.prompt(questions);
        answers[param.name] = response[param.name];
      }
    }
    
    // Create output directory
    const outputDir = path.resolve(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write contract file
    const contractName = options.name || template.config.name;
    const contractPath = path.join(outputDir, `${contractName}.rxd`);
    fs.writeFileSync(contractPath, template.source);
    
    // Write config file with parameters
    const configPath = path.join(outputDir, `${contractName}.config.json`);
    fs.writeFileSync(configPath, JSON.stringify({
      name: contractName,
      template: templateName,
      parameters: answers,
      created: new Date().toISOString(),
    }, null, 2));
    
    console.log(chalk.green(`\n✓ Created ${contractPath}`));
    console.log(chalk.green(`✓ Created ${configPath}`));
    console.log(chalk.gray(`\nNext steps:`));
    console.log(chalk.gray(`  1. Edit ${contractName}.rxd to customize the contract`));
    console.log(chalk.gray(`  2. Run: rxd-deploy compile ${contractName}.rxd --output ${contractName}.json`));
    console.log(chalk.gray(`  3. Run: rxd-deploy deploy ${contractName}.json --network testnet --key <your-key>`));
  });

program
  .command('balance <address>')
  .description('Check the balance of an address')
  .option('-n, --network <network>', 'Network (mainnet/testnet)', 'mainnet')
  .action(async (address: string, options) => {
    const spinner = ora('Fetching balance...').start();
    
    try {
      const manager = new DeploymentManager(options.network);
      await manager.connect();
      
      const balance = await manager.getBalance(address);
      
      await manager.disconnect();
      
      spinner.succeed(`Balance: ${chalk.green((balance / 100000000).toFixed(8))} RXD`);
      console.log(chalk.gray(`         ${balance} satoshis`));
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('fee')
  .description('Estimate current network fee rate')
  .option('-n, --network <network>', 'Network (mainnet/testnet)', 'mainnet')
  .option('-b, --blocks <blocks>', 'Target confirmation blocks', '1')
  .action(async (options) => {
    const spinner = ora('Estimating fee...').start();
    
    try {
      const manager = new DeploymentManager(options.network);
      await manager.connect();
      
      const feeRate = await manager.estimateFee(parseInt(options.blocks, 10));
      
      await manager.disconnect();
      
      spinner.succeed(`Fee rate: ${chalk.green((feeRate * 100000000).toFixed(0))} sat/byte`);
      console.log(chalk.gray(`For ${options.blocks} block confirmation on ${options.network}`));
    } catch (error: any) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();
