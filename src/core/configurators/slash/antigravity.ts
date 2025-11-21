import { SlashCommandConfigurator } from './base.js';
import { SlashCommandId } from '../../templates/index.js';

const FILE_PATHS: Partial<Record<SlashCommandId, string>> = {
  proposal: '.agent/workflows/openspec-proposal.md',
  apply: '.agent/workflows/openspec-apply.md',
  archive: '.agent/workflows/openspec-archive.md'
};

const DESCRIPTIONS: Partial<Record<SlashCommandId, string>> = {
  proposal: 'Scaffold a new OpenSpec change and validate strictly.',
  apply: 'Implement an approved OpenSpec change and keep tasks in sync.',
  archive: 'Archive a deployed OpenSpec change and update specs.'
};

export class AntigravitySlashCommandConfigurator extends SlashCommandConfigurator {
  readonly toolId = 'antigravity';
  readonly isAvailable = true;

  protected getRelativePath(id: SlashCommandId): string | undefined {
    return FILE_PATHS[id];
  }

  protected getFrontmatter(id: SlashCommandId): string | undefined {
    const description = DESCRIPTIONS[id];
    return `---\ndescription: ${description}\n---`;
  }
}
