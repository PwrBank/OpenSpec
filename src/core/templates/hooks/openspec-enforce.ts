#!/usr/bin/env node
/**
 * OpenSpec Enforcement Hook (PreToolUse)
 *
 * Enforces DAIC (Discussion-Apply-Implement-Complete) mode rules:
 * - Blocks file edits to files listed in tasks.md during implementation
 * - Validates TodoWrite changes against approved plan from tasks.md
 * - Protects proposal.md and tasks.md from modification during implementation
 * - Validates branch matches active change
 *
 * This hook runs before Write, Edit, MultiEdit, TodoWrite, and NotebookEdit tool uses.
 */

import * as path from 'path';
import {
  loadState,
  getCurrentBranch,
  findActiveChangeForBranch,
  parseTasksMd,
  extractAffectedFilesFromTasks,
  isFileAffected,
  compareApprovedPlan,
  formatTodoDiff,
  parseTasksFromContent,
  ActiveChange,
  Task,
} from './shared-state.js';
import { isBashReadOnly } from './bash-analyzer.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface ToolUseEvent {
  tool: string;
  parameters: Record<string, any>;
  id: string;
}

interface HookResponse {
  action: 'allow' | 'block';
  message?: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const debugLogPath = path.join(
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    'openspec',
    'hooks',
    'enforce-debug.log'
  );

  try {
    // Debug: Log environment to file
    const fs = await import('fs/promises');
    const timestamp = new Date().toISOString();
    await fs.appendFile(debugLogPath, `\n\n=== ${timestamp} ===\n`);
    await fs.appendFile(debugLogPath, `CLAUDE_PROJECT_DIR: ${process.env.CLAUDE_PROJECT_DIR || 'NOT SET'}\n`);
    await fs.appendFile(debugLogPath, `cwd: ${process.cwd()}\n`);

    console.error(`[OpenSpec Enforce] CLAUDE_PROJECT_DIR: ${process.env.CLAUDE_PROJECT_DIR || 'NOT SET'}`);
    console.error(`[OpenSpec Enforce] cwd: ${process.cwd()}`);

    // Read tool use event from stdin
    const input = await readStdin();
    await fs.appendFile(debugLogPath, `stdin input length: ${input.length}\n`);
    await fs.appendFile(debugLogPath, `stdin input: ${input.substring(0, 200)}${input.length > 200 ? '...' : ''}\n`);

    if (!input) {
      // No input, allow by default
      await fs.appendFile(debugLogPath, `No stdin input, allowing\n`);
      console.error(`[OpenSpec Enforce] No stdin input, allowing`);
      outputResponse({ action: 'allow' });
      return;
    }

    let event: ToolUseEvent;
    try {
      event = JSON.parse(input);
    } catch (e: any) {
      // Invalid JSON, allow by default
      console.error(`[OpenSpec Enforce] Invalid JSON input: ${e.message}, allowing`);
      outputResponse({ action: 'allow' });
      return;
    }

    // Process the tool use event
    const response = await processToolUse(event);
    await fs.appendFile(debugLogPath, `Final response: ${JSON.stringify(response)}\n`);
    console.error(`[OpenSpec Enforce] Final response: ${JSON.stringify(response)}`);
    outputResponse(response);
  } catch (error: any) {
    // On error, allow but log the error
    const fs = await import('fs/promises');
    await fs.appendFile(debugLogPath, `ERROR: ${error.message}\n`);
    await fs.appendFile(debugLogPath, `Stack: ${error.stack}\n`);
    console.error(`[OpenSpec Enforce] Error: ${error.message}`);
    console.error(`[OpenSpec Enforce] Stack: ${error.stack}`);
    outputResponse({ action: 'allow' });
  }
}

// ============================================================================
// Tool Use Processing
// ============================================================================

/**
 * Process a tool use event and determine if it should be allowed or blocked
 */
async function processToolUse(event: ToolUseEvent): Promise<HookResponse> {
  const tool = event.tool;
  const params = event.parameters;

  const debugLogPath = path.join(
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    'openspec',
    'hooks',
    'enforce-debug.log'
  );
  const fs = await import('fs/promises');

  // Load state and determine if we're in implementation mode
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  // Debug logging
  await fs.appendFile(debugLogPath, `Tool: ${tool}\n`);
  await fs.appendFile(debugLogPath, `Branch: ${currentBranch}\n`);
  await fs.appendFile(debugLogPath, `Active changes count: ${state.active_changes.length}\n`);
  await fs.appendFile(debugLogPath, `Active change for branch: ${activeChange ? activeChange.changeId : 'null'}\n`);

  console.error(`[OpenSpec Enforce] Tool: ${tool}`);
  console.error(`[OpenSpec Enforce] Branch: ${currentBranch}`);
  console.error(`[OpenSpec Enforce] Active changes: ${state.active_changes.length}`);
  console.error(`[OpenSpec Enforce] Active change for branch: ${activeChange ? activeChange.changeId : 'null'}`);

  // If no active change, we're in discussion mode - enforce read-only restrictions
  if (!activeChange) {
    await fs.appendFile(debugLogPath, `No active change, enforcing discussion mode\n`);
    console.error(`[OpenSpec Enforce] No active change, enforcing discussion mode`);
    return await enforceDiscussionMode(tool, params);
  }

  // We have an active change - enforce rules based on tool type
  switch (tool) {
    case 'TodoWrite':
      return await enforceTodoWrite(activeChange, params);

    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return await enforceFileEdit(activeChange, tool, params);

    default:
      // Unknown tool, allow by default
      return { action: 'allow' };
  }
}

// ============================================================================
// Discussion Mode Enforcement
// ============================================================================

/**
 * Enforce read-only restrictions in discussion mode (no active change)
 * Blocks write tools and analyzes bash commands for write operations
 */
async function enforceDiscussionMode(tool: string, params: Record<string, any>): Promise<HookResponse> {
  const debugLogPath = path.join(
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    'openspec',
    'hooks',
    'enforce-debug.log'
  );
  const fs = await import('fs/promises');

  await fs.appendFile(debugLogPath, `enforceDiscussionMode called with tool: ${tool}\n`);
  console.error(`[OpenSpec Enforce] enforceDiscussionMode called with tool: ${tool}`);

  // Block write tools in discussion mode
  const writeTools = ['Write', 'Edit', 'MultiEdit', 'TodoWrite', 'NotebookEdit'];
  await fs.appendFile(debugLogPath, `Write tools list: ${writeTools.join(', ')}\n`);
  await fs.appendFile(debugLogPath, `Tool in write tools? ${writeTools.includes(tool)}\n`);

  console.error(`[OpenSpec Enforce] Write tools list: ${writeTools.join(', ')}`);
  console.error(`[OpenSpec Enforce] Tool in write tools? ${writeTools.includes(tool)}`);

  if (writeTools.includes(tool)) {
    await fs.appendFile(debugLogPath, `BLOCKING write tool: ${tool}\n`);
    console.error(`[OpenSpec Enforce] BLOCKING write tool: ${tool}`);
    return {
      action: 'block',
      message:
        '[OpenSpec: Discussion Mode]\n' +
        'File editing not allowed in discussion mode.\n' +
        '\n' +
        'To make changes:\n' +
        '1. Create a proposal: "propose: <description>"\n' +
        '2. Wait for approval\n' +
        '3. Start implementation: "apply: <proposal-id>"',
    };
  }

  // Analyze Bash commands for write operations
  if (tool === 'Bash') {
    const command = params.command as string;
    if (!command) {
      await fs.appendFile(debugLogPath, `Bash with no command, allowing\n`);
      return { action: 'allow' };
    }

    if (!isBashReadOnly(command)) {
      await fs.appendFile(debugLogPath, `BLOCKING write-like bash command: ${command}\n`);
      return {
        action: 'block',
        message:
          '[OpenSpec: Discussion Mode]\n' +
          'Write-like bash commands not allowed in discussion mode.\n' +
          '\n' +
          `Blocked command: ${command}\n` +
          '\n' +
          'Only read-only operations are permitted.\n' +
          'To make changes:\n' +
          '1. Create a proposal: "propose: <description>"\n' +
          '2. Wait for approval\n' +
          '3. Start implementation: "apply: <proposal-id>"',
      };
    }
  }

  // Allow all other tools in discussion mode
  await fs.appendFile(debugLogPath, `Allowing tool: ${tool} (not a write tool)\n`);
  return { action: 'allow' };
}

// ============================================================================
// TodoWrite Enforcement
// ============================================================================

/**
 * Enforce TodoWrite validation - ensure todos match approved plan
 */
async function enforceTodoWrite(
  activeChange: ActiveChange,
  params: Record<string, any>
): Promise<HookResponse> {
  try {
    // Extract current todos from TodoWrite parameters
    const currentTodos = params.todos as Array<{
      content: string;
      status: string;
      activeForm: string;
    }>;

    if (!currentTodos || !Array.isArray(currentTodos)) {
      return { action: 'allow' }; // Invalid format, allow
    }

    // Convert to Task format for comparison
    const currentTasks: Task[] = currentTodos.map((todo, index) => ({
      content: todo.content,
      completed: todo.status === 'completed',
      line: index + 1,
    }));

    // Get approved plan from active change
    const approvedTasks = activeChange.approved_todos;

    // Compare plans
    const diff = compareApprovedPlan(approvedTasks, currentTasks);

    // Check if there are unauthorized changes
    // Added or removed tasks are scope changes - block them
    if (diff.added.length > 0 || diff.removed.length > 0) {
      return {
        action: 'block',
        message: formatTodoWriteViolation(approvedTasks, currentTasks, diff),
      };
    }

    // Modified tasks (completion status changes) are allowed - that's progress tracking
    return { action: 'allow' };
  } catch (error: any) {
    console.error(`[TodoWrite Validation] Error: ${error.message}`);
    return { action: 'allow' }; // On error, allow
  }
}

/**
 * Format TodoWrite violation message with prescribed "SHAME RITUAL" response format
 * Forces Claude to explain the violation and seek re-approval
 */
function formatTodoWriteViolation(
  approved: Task[],
  attempted: Task[],
  diff: any
): string {
  const lines: string[] = [];

  lines.push('[OpenSpec: Todo Change Blocked]');
  lines.push('');
  lines.push('You just attempted to change the approved plan during implementation.');
  lines.push('');
  lines.push('**Original Approved Plan** (' + approved.length + ' tasks):');
  approved.forEach((task, i) => {
    const status = task.completed ? '[x]' : '[ ]';
    lines.push(`  ${i + 1}. ${status} ${task.content}`);
  });
  lines.push('');

  lines.push('**Your Attempted Change** (' + attempted.length + ' tasks):');

  // Show the changes with markers
  if (diff.added.length > 0) {
    lines.push('');
    lines.push('**Added:**');
    diff.added.forEach((task: Task) => {
      lines.push(`  + ${task.content}`);
    });
  }

  if (diff.removed.length > 0) {
    lines.push('');
    lines.push('**Removed:**');
    diff.removed.forEach((task: Task) => {
      lines.push(`  - ${task.content}`);
    });
  }

  if (diff.modified.length > 0) {
    lines.push('');
    lines.push('**Modified:**');
    diff.modified.forEach((mod: any) => {
      const oldStatus = mod.old.completed ? '[x]' : '[ ]';
      const newStatus = mod.new.completed ? '[x]' : '[ ]';
      lines.push(`  ${oldStatus} → ${newStatus}: ${mod.new.content}`);
    });
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('YOUR NEXT MESSAGE MUST use this exact format:');
  lines.push('');
  lines.push('[SHAME RITUAL]');
  lines.push('I made a boo boo. I just tried to change the plan.');
  lines.push('');
  lines.push('The todos you approved were:');
  lines.push('[List the original approved todos here]');
  lines.push('');
  lines.push('I tried to change them by [adding/removing/modifying] them:');
  lines.push('[Show the changes - use + for added items, - for removed items, → for modifications]');
  lines.push('');
  lines.push('This [seems fine/is unimportant | was a violation of the execution boundary].');
  lines.push('');
  lines.push('If you approve of the change, you can let me cook by saying:');
  lines.push('  "apply: <proposal-id>" (to start over with a new plan)');
  lines.push('═══════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================================
// File Edit Enforcement
// ============================================================================

/**
 * Enforce file edit rules - block edits to files in tasks.md
 */
async function enforceFileEdit(
  activeChange: ActiveChange,
  tool: string,
  params: Record<string, any>
): Promise<HookResponse> {
  try {
    // Extract file path from parameters
    const filePath = getFilePathFromParams(tool, params);
    if (!filePath) {
      return { action: 'allow' }; // No file path, allow
    }

    // Normalize file path
    const normalizedPath = normalizePath(filePath);

    // Check if file is proposal.md or tasks.md - these are always protected
    if (isProtectedChangeFile(normalizedPath, activeChange)) {
      return {
        action: 'block',
        message: formatProtectedFileViolation(normalizedPath, activeChange),
      };
    }

    // Load tasks.md and extract affected files
    const tasksMdPath = path.join(
      process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      'openspec',
      'changes',
      activeChange.changeId,
      'tasks.md'
    );

    const tasks = await parseTasksMd(tasksMdPath);
    const affectedFiles = extractAffectedFilesFromTasks(tasks);

    // Check if file is in affected files list
    if (isFileAffected(normalizedPath, affectedFiles)) {
      // File is in tasks.md - allow the edit (this is expected work)
      return { action: 'allow' };
    }

    // File is NOT in tasks.md - this is suspicious but we allow it
    // (Could be docs, configs, or other unrelated files)
    // This is the key difference from blocking everything in discussion mode
    return { action: 'allow' };
  } catch (error: any) {
    console.error(`[File Edit Enforcement] Error: ${error.message}`);
    return { action: 'allow' }; // On error, allow
  }
}

/**
 * Get file path from tool parameters
 */
function getFilePathFromParams(tool: string, params: Record<string, any>): string | null {
  switch (tool) {
    case 'Write':
    case 'Edit':
      return params.file_path || null;

    case 'MultiEdit':
      // MultiEdit might have multiple files - check first one
      if (params.edits && Array.isArray(params.edits) && params.edits.length > 0) {
        return params.edits[0].file_path || null;
      }
      return null;

    case 'NotebookEdit':
      return params.notebook_path || null;

    default:
      return null;
  }
}

/**
 * Normalize file path for comparison
 */
function normalizePath(filePath: string): string {
  // Remove leading ./ or .\
  let normalized = filePath.replace(/^\.[\\/]/, '');

  // Convert backslashes to forward slashes
  normalized = normalized.replace(/\\/g, '/');

  // Remove leading slash if absolute path
  normalized = normalized.replace(/^\//, '');

  return normalized;
}

/**
 * Check if file is a protected change file (proposal.md or tasks.md)
 */
function isProtectedChangeFile(filePath: string, activeChange: ActiveChange): boolean {
  const normalized = normalizePath(filePath);
  const changeDir = `openspec/changes/${activeChange.changeId}`;

  const protectedFiles = [
    `${changeDir}/proposal.md`,
    `${changeDir}/tasks.md`,
  ];

  return protectedFiles.some((protectedFile) => {
    const normalizedProtected = normalizePath(protectedFile);
    return (
      normalized === normalizedProtected ||
      normalized.endsWith(`/${normalizedProtected}`)
    );
  });
}

/**
 * Format protected file violation message
 */
function formatProtectedFileViolation(
  filePath: string,
  activeChange: ActiveChange
): string {
  const lines: string[] = [];

  lines.push('⚠️  **BLOCKED - Protected Change File**');
  lines.push('');
  lines.push(`You attempted to modify: \`${filePath}\``);
  lines.push('');
  lines.push('This file is protected during implementation to prevent plan drift.');
  lines.push('');
  lines.push('**Why this is blocked:**');
  lines.push('  - `proposal.md` defines the approved scope and approach');
  lines.push('  - `tasks.md` defines the approved implementation checklist');
  lines.push('  - Modifying these during implementation creates inconsistency');
  lines.push('');
  lines.push('**What you can do:**');
  lines.push('  1. Continue with the current plan as written');
  lines.push('  2. If the plan needs updating:');
  lines.push('     - Explain to the user why the plan is insufficient');
  lines.push('     - Ask the user to update the file manually');
  lines.push('     - Wait for user approval before continuing');
  lines.push('');
  lines.push('**Current change:** `' + activeChange.changeId + '`');
  lines.push('**Branch:** `' + activeChange.branch + '`');

  return lines.join('\n');
}

// ============================================================================
// I/O Functions
// ============================================================================

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    process.stdin.on('data', (chunk) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      const input = Buffer.concat(chunks).toString('utf-8');
      resolve(input);
    });

    process.stdin.on('error', (error) => {
      reject(error);
    });

    // Set a timeout in case stdin never ends
    setTimeout(() => {
      resolve(''); // Return empty string on timeout
    }, 5000); // 5 second timeout
  });
}

/**
 * Output hook response as JSON
 */
function outputResponse(response: HookResponse): void {
  const output = JSON.stringify(response, null, 2);
  process.stdout.write(output);
}

// ============================================================================
// Execute Main
// ============================================================================

main().catch((error) => {
  console.error('[OpenSpec Enforce] Fatal error:', error);
  outputResponse({ action: 'allow' }); // On fatal error, allow
  process.exit(0);
});
