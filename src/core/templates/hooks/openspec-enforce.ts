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
  try {
    // Read tool use event from stdin
    const input = await readStdin();
    if (!input) {
      // No input, allow by default
      outputResponse({ action: 'allow' });
      return;
    }

    let event: ToolUseEvent;
    try {
      event = JSON.parse(input);
    } catch {
      // Invalid JSON, allow by default
      outputResponse({ action: 'allow' });
      return;
    }

    // Process the tool use event
    const response = await processToolUse(event);
    outputResponse(response);
  } catch (error: any) {
    // On error, allow but log the error
    console.error(`[OpenSpec Enforce] Error: ${error.message}`);
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

  // Load state and determine if we're in implementation mode
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  // If no active change, we're in discussion mode - allow everything
  if (!activeChange) {
    return { action: 'allow' };
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
 * Format TodoWrite violation message
 */
function formatTodoWriteViolation(
  approved: Task[],
  attempted: Task[],
  diff: any
): string {
  const lines: string[] = [];

  lines.push('⚠️  **BLOCKED - TodoWrite Scope Change Detected**');
  lines.push('');
  lines.push('You attempted to modify the approved plan. The scope of work was locked when you started implementation.');
  lines.push('');
  lines.push('**Original Approved Plan** (`tasks.md` - ' + approved.length + ' tasks):');
  approved.forEach((task, i) => {
    const status = task.completed ? '✓' : ' ';
    lines.push(`  ${i + 1}. [${status}] ${task.content}`);
  });
  lines.push('');
  lines.push('**Attempted Change** (TodoWrite - ' + attempted.length + ' tasks):');
  attempted.forEach((task, i) => {
    const status = task.completed ? '✓' : ' ';
    const marker = diff.added.some((t: Task) => t.content === task.content) ? ' ← NEW' : '';
    lines.push(`  ${i + 1}. [${status}] ${task.content}${marker}`);
  });
  lines.push('');

  if (diff.added.length > 0) {
    lines.push('**Unauthorized Additions:**');
    diff.added.forEach((task: Task) => {
      lines.push(`  + ${task.content}`);
    });
    lines.push('');
  }

  if (diff.removed.length > 0) {
    lines.push('**Unauthorized Removals:**');
    diff.removed.forEach((task: Task) => {
      lines.push(`  - ${task.content}`);
    });
    lines.push('');
  }

  lines.push('**What you can do:**');
  lines.push('  1. Continue with the original plan (recommended)');
  lines.push('  2. Explain why the scope change is necessary and wait for user approval');
  lines.push('  3. Ask the user to update `tasks.md` manually, then continue');
  lines.push('');
  lines.push('Remember: Scope changes during implementation often indicate:');
  lines.push('  - The original plan was incomplete (should have been caught during proposal)');
  lines.push('  - You\'re over-engineering the solution (keep it simple)');
  lines.push('  - You discovered a blocking issue (communicate this to the user)');

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
