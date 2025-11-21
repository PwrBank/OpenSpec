/**
 * Claude Code Hooks Setup Module
 *
 * Installs OpenSpec approval hooks and agents for Claude Code:
 * - Copies pre-compiled hook scripts to openspec/hooks/
 * - Copies agent prompts to openspec/agents/
 * - Generates .claude/settings.json with proper paths
 * - Initializes state file
 *
 * Hooks provide DAIC (Discussion-Apply-Implement-Complete) workflow enforcement.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { FileSystemUtils } from '../utils/file-system.js';
import { SlashCommandRegistry } from '../core/configurators/slash/registry.js';
import { OPENSPEC_DIR_NAME } from '../core/config.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ClaudeHookOptions {
  includeStatusline: boolean;
  projectRoot: string;
}

interface OpenSpecState {
  mode: 'discussion' | 'implementation';
  active_changes: ActiveChange[];
  proposal_keywords: string[];
  implementation_keywords: string[];
  pause_keywords: string[];
  archive_keywords: string[];
  review_agents_enabled: boolean;
  worklog_enabled: boolean;
}

interface ActiveChange {
  changeId: string;
  branch: string;
  tasks_md_hash: string;
  proposal_md_hash: string;
  approved_todos: any[];
  last_worklog_update?: string;
  worklog_entries?: number;
}

// ============================================================================
// Constants
// ============================================================================

// Get the directory where this file is located (in dist/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hook script names (compiled .js files in dist/templates/hooks/)
const HOOK_SCRIPTS = [
  'shared-state.js',
  'openspec-enforce.js',
  'user-messages.js',
  'post-tool-use.js',
  'session-start.js',
  'statusline.js',
  'review-agents.js',
  'worklog-generator.js',
];

// Agent prompt names (.md files in dist/templates/agents/)
const AGENT_PROMPTS = [
  'code-review.md',
  'documentation.md',
  'worklog-generator.md',
];

// ============================================================================
// Main Setup Function
// ============================================================================

/**
 * Install Claude Code hooks and agents for OpenSpec
 */
export async function setupClaudeHooks(options: ClaudeHookOptions): Promise<void> {
  const { projectRoot, includeStatusline } = options;
  const isWindows = process.platform === 'win32';

  // Create directory structure
  await createDirectories(projectRoot);

  // Copy hook scripts
  await copyHookScripts(projectRoot);

  // Copy agent prompts
  await copyAgentPrompts(projectRoot);

  // Generate Claude slash commands
  await generateClaudeSlashCommands(projectRoot);

  // Generate .claude/settings.json
  await generateClaudeSettings(projectRoot, isWindows, includeStatusline);

  // Generate .claude/settings.json.example (for version control)
  await generateClaudeSettingsExample(projectRoot, isWindows, includeStatusline);

  // Initialize state file
  await initializeStateFile(projectRoot);
}

// ============================================================================
// Directory Creation
// ============================================================================

/**
 * Create necessary directories for hooks, agents, and state
 */
async function createDirectories(projectRoot: string): Promise<void> {
  const directories = [
    FileSystemUtils.joinPath(projectRoot, 'openspec', 'hooks'),
    FileSystemUtils.joinPath(projectRoot, 'openspec', 'agents'),
    FileSystemUtils.joinPath(projectRoot, 'openspec', 'state'),
    FileSystemUtils.joinPath(projectRoot, '.claude'),
  ];

  for (const dir of directories) {
    await FileSystemUtils.createDirectory(dir);
  }
}

// ============================================================================
// Hook Script Copying
// ============================================================================

/**
 * Copy pre-compiled hook scripts from dist/core/templates/hooks/ to project
 */
async function copyHookScripts(projectRoot: string): Promise<void> {
  // Resolve path to dist/core/templates/hooks/ (where compiled hooks are)
  const templatesDir = path.resolve(__dirname, '..', 'core', 'templates', 'hooks');
  const targetDir = FileSystemUtils.joinPath(projectRoot, 'openspec', 'hooks');

  for (const scriptName of HOOK_SCRIPTS) {
    const sourcePath = path.join(templatesDir, scriptName);
    const targetPath = FileSystemUtils.joinPath(targetDir, scriptName);

    try {
      const content = await FileSystemUtils.readFile(sourcePath);
      await FileSystemUtils.writeFile(targetPath, content);
    } catch (error: any) {
      throw new Error(
        `Failed to copy hook script ${scriptName}: ${error.message}\n` +
        `Source: ${sourcePath}`
      );
    }
  }
}

// ============================================================================
// Agent Prompt Copying
// ============================================================================

/**
 * Copy agent prompts from dist/core/templates/agents/ to project
 */
async function copyAgentPrompts(projectRoot: string): Promise<void> {
  // Resolve path to dist/core/templates/agents/
  const templatesDir = path.resolve(__dirname, '..', 'core', 'templates', 'agents');
  const targetDir = FileSystemUtils.joinPath(projectRoot, 'openspec', 'agents');

  for (const promptName of AGENT_PROMPTS) {
    const sourcePath = path.join(templatesDir, promptName);
    const targetPath = FileSystemUtils.joinPath(targetDir, promptName);

    try {
      const content = await FileSystemUtils.readFile(sourcePath);
      await FileSystemUtils.writeFile(targetPath, content);
    } catch (error: any) {
      throw new Error(
        `Failed to copy agent prompt ${promptName}: ${error.message}\n` +
        `Source: ${sourcePath}`
      );
    }
  }
}

// ============================================================================
// Slash Command Generation
// ============================================================================

/**
 * Generate Claude Code slash commands for OpenSpec
 */
async function generateClaudeSlashCommands(projectRoot: string): Promise<void> {
  const slashConfigurator = SlashCommandRegistry.get('claude');

  if (!slashConfigurator || !slashConfigurator.isAvailable) {
    throw new Error('Claude slash command configurator not available');
  }

  await slashConfigurator.generateAll(projectRoot, OPENSPEC_DIR_NAME);
}

// ============================================================================
// Claude Settings Generation
// ============================================================================

/**
 * Generate .claude/settings.json with hook configurations
 */
async function generateClaudeSettings(
  projectRoot: string,
  isWindows: boolean,
  includeStatusline: boolean
): Promise<void> {
  const settings = buildClaudeSettings(isWindows, includeStatusline);
  const settingsPath = FileSystemUtils.joinPath(projectRoot, '.claude', 'settings.json');

  await FileSystemUtils.writeFile(
    settingsPath,
    JSON.stringify(settings, null, 2)
  );
}

/**
 * Generate .claude/settings.json.example for version control
 */
async function generateClaudeSettingsExample(
  projectRoot: string,
  isWindows: boolean,
  includeStatusline: boolean
): Promise<void> {
  const settings = buildClaudeSettings(isWindows, includeStatusline);
  const examplePath = FileSystemUtils.joinPath(
    projectRoot,
    '.claude',
    'settings.json.example'
  );

  await FileSystemUtils.writeFile(
    examplePath,
    JSON.stringify(settings, null, 2)
  );
}

/**
 * Build Claude settings object with hook configurations
 */
function buildClaudeSettings(
  isWindows: boolean,
  includeStatusline: boolean
): any {
  // Path prefix and suffix differ by platform
  const pathPrefix = isWindows
    ? 'node "%CLAUDE_PROJECT_DIR%\\openspec\\hooks\\'
    : 'node $CLAUDE_PROJECT_DIR/openspec/hooks/';

  const pathSuffix = isWindows ? '.js"' : '.js';

  const settings: any = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: `${pathPrefix}user-messages${pathSuffix}`,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: 'Write|Edit|MultiEdit|TodoWrite|NotebookEdit',
          hooks: [
            {
              type: 'command',
              command: `${pathPrefix}openspec-enforce${pathSuffix}`,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: `${pathPrefix}post-tool-use${pathSuffix}`,
            },
          ],
        },
      ],
      SessionStart: [
        {
          matcher: 'startup|clear',
          hooks: [
            {
              type: 'command',
              command: `${pathPrefix}session-start${pathSuffix}`,
            },
          ],
        },
      ],
    },
  };

  // Add statusline if user opted in
  if (includeStatusline) {
    settings.statusLine = {
      type: 'command',
      command: isWindows
        ? 'node "%CLAUDE_PROJECT_DIR%\\openspec\\hooks\\statusline.js"'
        : 'node $CLAUDE_PROJECT_DIR/openspec/hooks/statusline.js',
    };
  }

  return settings;
}

// ============================================================================
// State File Initialization
// ============================================================================

/**
 * Initialize openspec/state/openspec-state.json with default state
 */
async function initializeStateFile(projectRoot: string): Promise<void> {
  const statePath = FileSystemUtils.joinPath(
    projectRoot,
    'openspec',
    'state',
    'openspec-state.json'
  );

  // Check if state file already exists
  const exists = await FileSystemUtils.fileExists(statePath);
  if (exists) {
    // Don't overwrite existing state
    return;
  }

  // Create initial state
  const initialState: OpenSpecState = {
    mode: 'discussion',
    active_changes: [],
    proposal_keywords: ['propose'],
    implementation_keywords: ['apply', 'init'],
    pause_keywords: ['pause'],
    archive_keywords: ['archive', 'done', 'cancel'],
    review_agents_enabled: true,
    worklog_enabled: true,
  };

  await FileSystemUtils.writeFile(
    statePath,
    JSON.stringify(initialState, null, 2)
  );
}
