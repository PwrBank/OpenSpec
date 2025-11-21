#!/usr/bin/env node
/**
 * OpenSpec Post Tool Use Hook (PostToolUse)
 *
 * Runs after tool use to:
 * - Sync TodoWrite with state (track progress)
 * - Monitor tasks.md file changes (track completion)
 * - Suggest archive when all tasks are complete
 *
 * This hook runs after Write, Edit, TodoWrite, and other tool uses.
 */

import {
  loadState,
  getCurrentBranch,
  findActiveChangeForBranch,
  upsertActiveChange,
  areAllTasksComplete,
  countCompletedTasks,
  Task,
} from './shared-state.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface ToolUseResult {
  tool: string;
  parameters: Record<string, any>;
  success: boolean;
}

interface HookResponse {
  message?: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    // Read tool use result from stdin
    const input = await readStdin();
    if (!input) {
      outputResponse({});
      return;
    }

    let result: ToolUseResult;
    try {
      result = JSON.parse(input);
    } catch {
      outputResponse({});
      return;
    }

    // Process the tool use result
    const response = await processToolUseResult(result);
    outputResponse(response);
  } catch (error: any) {
    console.error(`[Post Tool Use] Error: ${error.message}`);
    outputResponse({});
  }
}

// ============================================================================
// Tool Use Result Processing
// ============================================================================

/**
 * Process tool use result and perform post-actions
 */
async function processToolUseResult(result: ToolUseResult): Promise<HookResponse> {
  if (!result.success) {
    // Tool use failed, nothing to do
    return {};
  }

  const tool = result.tool;
  const params = result.parameters;

  // Get current state and active change
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  if (!activeChange) {
    // No active change, nothing to track
    return {};
  }

  // Handle TodoWrite sync
  if (tool === 'TodoWrite') {
    return await handleTodoWriteSync(activeChange, params);
  }

  // Handle tasks.md file edits (if monitoring file edits)
  if (tool === 'Edit' || tool === 'Write') {
    const filePath = params.file_path as string;
    if (filePath && filePath.includes('tasks.md')) {
      return await handleTasksMdEdit(activeChange);
    }
  }

  return {};
}

// ============================================================================
// TodoWrite Sync
// ============================================================================

/**
 * Handle TodoWrite sync - update state with current todo status
 */
async function handleTodoWriteSync(
  activeChange: any,
  params: Record<string, any>
): Promise<HookResponse> {
  try {
    // Extract todos from parameters
    const todos = params.todos as Array<{
      content: string;
      status: string;
      activeForm: string;
    }>;

    if (!todos || !Array.isArray(todos)) {
      return {};
    }

    // Convert to Task format
    const currentTasks: Task[] = todos.map((todo, index) => ({
      content: todo.content,
      completed: todo.status === 'completed',
      line: index + 1,
    }));

    // Update active change with current tasks
    const updatedChange = {
      ...activeChange,
      approved_todos: currentTasks,
    };

    await upsertActiveChange(updatedChange);

    // Check if all tasks are complete
    const { completed, total } = countCompletedTasks(currentTasks);
    const allComplete = areAllTasksComplete(currentTasks);

    if (allComplete) {
      return {
        message: [
          '',
          '✅ **All tasks complete!**',
          '',
          `You've finished all ${total} tasks for \`${activeChange.changeId}\`.`,
          '',
          'When ready, run `archive` to:',
          '  1. Generate final worklog entry',
          '  2. Run code review and documentation review',
          '  3. Update specs and move change to archive',
          '  4. Merge branch and clean up',
          '',
          'Or continue working if you need to make adjustments.',
          '',
        ].join('\n'),
      };
    }

    // Progress update (optional, can be disabled if too noisy)
    if (completed > 0) {
      return {
        message: `\n📊 Progress: ${completed}/${total} tasks complete\n`,
      };
    }

    return {};
  } catch (error: any) {
    console.error(`[TodoWrite Sync] Error: ${error.message}`);
    return {};
  }
}

// ============================================================================
// tasks.md File Edit Handling
// ============================================================================

/**
 * Handle tasks.md file edit - check if completion status changed
 */
async function handleTasksMdEdit(activeChange: any): Promise<HookResponse> {
  try {
    // For now, we just acknowledge the edit
    // In a full implementation, we could re-parse tasks.md and update state
    return {
      message: '\n📝 tasks.md updated\n',
    };
  } catch (error: any) {
    console.error(`[tasks.md Edit] Error: ${error.message}`);
    return {};
  }
}

// ============================================================================
// I/O Functions
// ============================================================================

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];

    process.stdin.on('data', (chunk) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      const input = Buffer.concat(chunks).toString('utf-8');
      resolve(input);
    });

    process.stdin.on('error', () => {
      resolve('');
    });

    // Timeout fallback
    setTimeout(() => {
      resolve('');
    }, 5000);
  });
}

/**
 * Output hook response
 */
function outputResponse(response: HookResponse): void {
  if (response.message) {
    process.stdout.write(response.message);
  }
}

// ============================================================================
// Execute Main
// ============================================================================

main().catch((error) => {
  console.error('[Post Tool Use] Fatal error:', error);
  process.exit(0);
});
