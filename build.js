#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, rmSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit' });
};

console.log('🔨 Building OpenSpec...\n');

// Clean dist directory
if (existsSync('dist')) {
  console.log('Cleaning dist directory...');
  rmSync('dist', { recursive: true, force: true });
}

// Run TypeScript compiler (use local version explicitly)
console.log('Compiling TypeScript...');
try {
  runTsc(['--version']);
  runTsc();

  // Copy agent prompts (TypeScript doesn't copy .md files)
  console.log('Copying agent prompt templates...');
  const agentsSourceDir = join(__dirname, 'src', 'core', 'templates', 'agents');
  const agentsDestDir = join(__dirname, 'dist', 'core', 'templates', 'agents');

  if (existsSync(agentsSourceDir)) {
    mkdirSync(agentsDestDir, { recursive: true });
    const agentFiles = readdirSync(agentsSourceDir).filter(f => f.endsWith('.md'));

    for (const file of agentFiles) {
      const sourcePath = join(agentsSourceDir, file);
      const destPath = join(agentsDestDir, file);
      copyFileSync(sourcePath, destPath);
      console.log(`  Copied ${file}`);
    }
  }

  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed!');
  console.error(error);
  process.exit(1);
}
