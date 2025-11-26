import path from 'path';
import { fileURLToPath } from 'url';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { FileSystemUtils } from '../utils/file-system.js';
import { OPENSPEC_DIR_NAME } from './config.js';
import { ToolRegistry } from './configurators/registry.js';
import { SlashCommandRegistry } from './configurators/slash/registry.js';
import { agentsTemplate } from './templates/agents-template.js';
import { PALETTE } from './styles/palette.js';
import * as crypto from 'crypto';

// Get the directory where this file is located (in dist/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hook script names (compiled .js files in dist/core/templates/hooks/)
const HOOK_SCRIPTS = [
  'shared-state.js',
  'bash-analyzer.js',
  'openspec-enforce.js',
  'user-messages.js',
  'post-tool-use.js',
  'session-start.js',
  'statusline.js',
  'review-agents.js',
  'worklog-generator.js',
];

// Agent prompt names (.md files in dist/core/templates/agents/)
const AGENT_PROMPTS = [
  'code-review.md',
  'documentation.md',
  'worklog-generator.md',
];

interface UpdateOptions {
  skipConfirmation?: boolean;
  dryRun?: boolean;
}

interface FileUpdateInfo {
  path: string;
  status: 'outdated' | 'missing' | 'unchanged';
  category: 'hook' | 'agent' | 'instruction' | 'config' | 'slash';
}

export class UpdateCommand {
  async execute(projectPath: string, options: UpdateOptions = {}): Promise<void> {
    const resolvedProjectPath = path.resolve(projectPath);
    const openspecDirName = OPENSPEC_DIR_NAME;
    const openspecPath = path.join(resolvedProjectPath, openspecDirName);

    // 1. Check openspec directory exists
    if (!await FileSystemUtils.directoryExists(openspecPath)) {
      throw new Error(`No OpenSpec directory found. Run 'openspec init' first.`);
    }

    // 2. Detect what needs updating
    const filesToUpdate = await this.detectUpdates(resolvedProjectPath, openspecPath);

    if (filesToUpdate.length === 0) {
      console.log(PALETTE.white('✓ All files are up to date!'));
      return;
    }

    // 3. Display what will be updated
    this.displayUpdatePlan(filesToUpdate);

    // 4. Dry-run mode - exit without updating
    if (options.dryRun) {
      console.log();
      console.log(PALETTE.midGray('Dry-run mode: No files were modified.'));
      console.log(PALETTE.midGray(`Run 'openspec update' to apply these changes.`));
      return;
    }

    // 5. Get user confirmation (unless --yes flag)
    if (!options.skipConfirmation) {
      const shouldUpdate = await confirm({
        message: 'Update these files?',
        default: true,
      });

      if (!shouldUpdate) {
        console.log(PALETTE.midGray('Update cancelled.'));
        return;
      }
    }

    // 6. Perform updates
    await this.performUpdates(resolvedProjectPath, openspecPath, filesToUpdate);

    console.log();
    console.log(PALETTE.white(`✓ Updated ${filesToUpdate.length} file(s)`));
  }

  /**
   * Detect which files need updating by comparing with templates
   */
  private async detectUpdates(
    projectPath: string,
    openspecPath: string
  ): Promise<FileUpdateInfo[]> {
    const updates: FileUpdateInfo[] = [];

    // Check Claude Code hooks
    const hooksDir = path.join(projectPath, 'openspec', 'hooks');
    if (await FileSystemUtils.directoryExists(hooksDir)) {
      for (const scriptName of HOOK_SCRIPTS) {
        const targetPath = path.join(hooksDir, scriptName);
        const relativePath = `openspec/hooks/${scriptName}`;
        const status = await this.compareFile(scriptName, targetPath, 'hook');
        if (status !== 'unchanged') {
          updates.push({ path: relativePath, status, category: 'hook' });
        }
      }
    }

    // Check Claude Code agents
    const agentsDir = path.join(projectPath, 'openspec', 'agents');
    if (await FileSystemUtils.directoryExists(agentsDir)) {
      for (const promptName of AGENT_PROMPTS) {
        const targetPath = path.join(agentsDir, promptName);
        const relativePath = `openspec/agents/${promptName}`;
        const status = await this.compareFile(promptName, targetPath, 'agent');
        if (status !== 'unchanged') {
          updates.push({ path: relativePath, status, category: 'agent' });
        }
      }
    }

    return updates;
  }

  /**
   * Compare a file with its template source
   */
  private async compareFile(
    fileName: string,
    targetPath: string,
    category: 'hook' | 'agent'
  ): Promise<'outdated' | 'missing' | 'unchanged'> {
    // Determine source path based on category
    const templateSubdir = category === 'hook' ? 'hooks' : 'agents';
    const sourcePath = path.resolve(__dirname, '..', 'core', 'templates', templateSubdir, fileName);

    // Check if target exists
    const targetExists = await FileSystemUtils.fileExists(targetPath);
    if (!targetExists) {
      return 'missing';
    }

    // Compare checksums
    try {
      const sourceContent = await FileSystemUtils.readFile(sourcePath);
      const targetContent = await FileSystemUtils.readFile(targetPath);

      const sourceHash = crypto.createHash('sha256').update(sourceContent).digest('hex');
      const targetHash = crypto.createHash('sha256').update(targetContent).digest('hex');

      return sourceHash === targetHash ? 'unchanged' : 'outdated';
    } catch (error) {
      // If we can't read the source, consider it unchanged to avoid errors
      return 'unchanged';
    }
  }

  /**
   * Display the update plan to the user
   */
  private displayUpdatePlan(files: FileUpdateInfo[]): void {
    console.log();
    console.log(PALETTE.white('📦 Files to update:'));
    console.log();

    // Group by category
    const byCategory = files.reduce((acc, file) => {
      if (!acc[file.category]) acc[file.category] = [];
      acc[file.category].push(file);
      return acc;
    }, {} as Record<string, FileUpdateInfo[]>);

    // Display by category
    if (byCategory.hook) {
      console.log(PALETTE.lightGray(`  Claude Code Hooks (${byCategory.hook.length} file(s)):`));
      for (const file of byCategory.hook) {
        const icon = file.status === 'missing' ? '✚' : '✎';
        const color = file.status === 'missing' ? PALETTE.white : PALETTE.lightGray;
        console.log(`    ${color(icon)} ${file.path}`);
      }
      console.log();
    }

    if (byCategory.agent) {
      console.log(PALETTE.lightGray(`  Claude Code Agents (${byCategory.agent.length} file(s)):`));
      for (const file of byCategory.agent) {
        const icon = file.status === 'missing' ? '✚' : '✎';
        const color = file.status === 'missing' ? PALETTE.white : PALETTE.lightGray;
        console.log(`    ${color(icon)} ${file.path}`);
      }
      console.log();
    }
  }

  /**
   * Perform the actual file updates
   */
  private async performUpdates(
    projectPath: string,
    openspecPath: string,
    files: FileUpdateInfo[]
  ): Promise<void> {
    for (const file of files) {
      if (file.category === 'hook') {
        await this.updateHookFile(projectPath, file);
      } else if (file.category === 'agent') {
        await this.updateAgentFile(projectPath, file);
      }
    }
  }

  /**
   * Update a single hook file
   */
  private async updateHookFile(projectPath: string, file: FileUpdateInfo): Promise<void> {
    const fileName = path.basename(file.path);
    const templatesDir = path.resolve(__dirname, '..', 'core', 'templates', 'hooks');
    const sourcePath = path.join(templatesDir, fileName);
    const targetPath = path.join(projectPath, file.path);

    const content = await FileSystemUtils.readFile(sourcePath);
    await FileSystemUtils.writeFile(targetPath, content);
  }

  /**
   * Update a single agent file
   */
  private async updateAgentFile(projectPath: string, file: FileUpdateInfo): Promise<void> {
    const fileName = path.basename(file.path);
    const templatesDir = path.resolve(__dirname, '..', 'core', 'templates', 'agents');
    const sourcePath = path.join(templatesDir, fileName);
    const targetPath = path.join(projectPath, file.path);

    const content = await FileSystemUtils.readFile(sourcePath);
    await FileSystemUtils.writeFile(targetPath, content);
  }

}
