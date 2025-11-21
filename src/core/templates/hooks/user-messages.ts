#!/usr/bin/env node
/**
 * OpenSpec User Messages Hook (UserPromptSubmit)
 *
 * Detects workflow keywords in user messages and injects context to trigger
 * OpenSpec slash commands:
 * - "propose: [description]" → /openspec:proposal
 * - "apply: [change-id]" → /openspec:apply
 * - "pause: [note]" → worklog generation
 * - "archive" or "archive --skip-review" → archive workflow
 *
 * This hook runs when the user submits a prompt.
 */

import * as path from 'path';
import {
  loadState,
  getCurrentBranch,
  findChange,
  generateBranchName,
  branchExists,
  createBranch,
  checkoutBranch,
  upsertActiveChange,
  parseTasksMd,
  calculateFileHash,
  listChanges,
  findActiveChangeForBranch,
} from './shared-state.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface UserMessageEvent {
  message: string;
}

interface HookResponse {
  action: 'allow' | 'inject';
  context?: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    // Read user message from stdin
    const input = await readStdin();
    if (!input) {
      outputResponse({ action: 'allow' });
      return;
    }

    let event: UserMessageEvent;
    try {
      event = JSON.parse(input);
    } catch {
      // Not JSON, treat as plain text message
      event = { message: input };
    }

    // Process the user message
    const response = await processUserMessage(event.message);
    outputResponse(response);
  } catch (error: any) {
    console.error(`[User Messages] Error: ${error.message}`);
    outputResponse({ action: 'allow' });
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process user message and detect keywords
 */
async function processUserMessage(message: string): Promise<HookResponse> {
  const trimmed = message.trim();
  const state = await loadState();

  // Check for proposal keyword
  if (state.proposal_keywords.some((kw) => trimmed.toLowerCase().startsWith(`${kw}:`))) {
    return await handleProposalKeyword(trimmed);
  }

  // Check for implementation keywords (apply/init)
  if (state.implementation_keywords.some((kw) => trimmed.toLowerCase().startsWith(`${kw}:`))) {
    return await handleImplementationKeyword(trimmed);
  }

  // Check for pause keyword
  if (state.pause_keywords.some((kw) => trimmed.toLowerCase().startsWith(`${kw}:`)) ||
      state.pause_keywords.some((kw) => trimmed.toLowerCase() === kw)) {
    return await handlePauseKeyword(trimmed);
  }

  // Check for archive keywords
  if (state.archive_keywords.some((kw) => {
    const lowerMessage = trimmed.toLowerCase();
    return lowerMessage === kw || lowerMessage.startsWith(`${kw} `);
  })) {
    return await handleArchiveKeyword(trimmed);
  }

  // No keywords detected
  return { action: 'allow' };
}

// ============================================================================
// Keyword Handlers
// ============================================================================

/**
 * Handle "propose: [description]" keyword
 */
async function handleProposalKeyword(message: string): Promise<HookResponse> {
  // Extract description after "propose:"
  const match = message.match(/^propose:\s*(.+)$/i);
  const description = match ? match[1].trim() : '';

  const context = [
    '',
    '**OpenSpec Hook**: Detected proposal keyword.',
    '',
    `You should run the \`/openspec:proposal\` slash command to create a new change.`,
    description ? `**User description**: "${description}"` : '',
    '',
    'Follow the OpenSpec workflow to:',
    '1. Review project.md and existing changes',
    '2. Choose a unique change-id (kebab-case, verb-led)',
    '3. Create proposal.md, tasks.md, design.md',
    '4. Draft spec deltas',
    '5. Validate with `openspec validate <id> --strict`',
    '',
  ].filter(Boolean).join('\n');

  return {
    action: 'inject',
    context,
  };
}

/**
 * Handle "apply: [change-id]" or "init: [change-id]" keyword
 */
async function handleImplementationKeyword(message: string): Promise<HookResponse> {
  // Extract change-id after keyword
  const match = message.match(/^(apply|init):\s*(.+)$/i);
  const changeId = match ? match[2].trim() : '';

  if (!changeId) {
    return {
      action: 'inject',
      context: '**OpenSpec Hook**: apply/init keyword detected but no change-id provided. Please specify: `apply: <change-id>`',
    };
  }

  // Find the change
  const change = await findChange(changeId);
  if (!change || !change.exists) {
    return {
      action: 'inject',
      context: `**OpenSpec Hook**: Change "${changeId}" not found. Available changes:\n${await listAvailableChanges()}`,
    };
  }

  // Check if we're already on the right branch
  const currentBranch = getCurrentBranch();
  const state = await loadState();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  if (activeChange && activeChange.changeId === change.id) {
    return {
      action: 'inject',
      context: `**OpenSpec Hook**: Change "${change.id}" is already active on branch "${currentBranch}". You can continue implementing.`,
    };
  }

  // Generate branch name
  const branchName = generateBranchName(change.id);
  const branchAlreadyExists = branchExists(branchName);

  // If branch exists, check it out. Otherwise, prompt user for confirmation
  if (branchAlreadyExists) {
    checkoutBranch(branchName);
  } else {
    // Branch doesn't exist - ask user for confirmation
    const context = [
      '',
      '**OpenSpec Hook**: Starting implementation of change `' + change.id + '`',
      '',
      `**Proposed branch**: \`${branchName}\``,
      '',
      'I will:',
      '1. Create the branch `' + branchName + '`',
      '2. Lock the approved plan from `tasks.md`',
      '3. Switch to implementation mode',
      '',
      'Please confirm you want to proceed with this branch name, or provide a custom branch name.',
      'Once confirmed, I\'ll set up the change and run `/openspec:apply ' + change.id + '`.',
      '',
    ].join('\n');

    return {
      action: 'inject',
      context,
    };
  }

  // Load tasks and create active change
  const tasks = await parseTasksMd(change.tasksMdPath);
  const tasksMdHash = await calculateFileHash(change.tasksMdPath);
  const proposalMdHash = await calculateFileHash(change.proposalPath);

  await upsertActiveChange({
    changeId: change.id,
    branch: branchName,
    tasks_md_hash: tasksMdHash,
    proposal_md_hash: proposalMdHash,
    approved_todos: tasks,
  });

  const context = [
    '',
    '**OpenSpec Hook**: Implementation mode activated',
    '',
    `✓ Branch: \`${branchName}\``,
    `✓ Locked plan: ${tasks.length} tasks from tasks.md`,
    `✓ Mode: Implementation`,
    '',
    'Now run `/openspec:apply ' + change.id + '` to begin implementing.',
    '',
  ].join('\n');

  return {
    action: 'inject',
    context,
  };
}

/**
 * Handle "pause" or "pause: [note]" keyword
 */
async function handlePauseKeyword(message: string): Promise<HookResponse> {
  const state = await loadState();

  if (!state.worklog_enabled) {
    return {
      action: 'inject',
      context: '**OpenSpec Hook**: Worklog generation is disabled in state. Ignoring pause keyword.',
    };
  }

  // Extract optional note
  const match = message.match(/^pause:\s*(.+)$/i);
  const note = match ? match[1].trim() : '';

  // Get active change
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  if (!activeChange) {
    return {
      action: 'inject',
      context: '**OpenSpec Hook**: No active change found. Pause is only available during implementation.',
    };
  }

  const context = [
    '',
    '**OpenSpec Hook**: Generating worklog checkpoint',
    '',
    `**Change**: \`${activeChange.changeId}\``,
    note ? `**Note**: "${note}"` : '',
    '',
    'I will now:',
    '1. Analyze the conversation transcript',
    '2. Extract accomplishments, decisions, and discoveries',
    '3. Update `worklog.md` with a timestamped entry',
    '4. Update `tasks.md` with progress notes',
    '',
    'This preserves context so you can resume later.',
    '',
  ].filter(Boolean).join('\n');

  return {
    action: 'inject',
    context,
  };
}

/**
 * Handle "archive" or "archive --skip-review" keyword
 */
async function handleArchiveKeyword(message: string): Promise<HookResponse> {
  const skipReview = message.toLowerCase().includes('--skip-review');

  // Get active change
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  let changeId: string;
  if (activeChange) {
    changeId = activeChange.changeId;
  } else {
    // No active change - need to determine from context or list changes
    const changes = await listChanges();
    if (changes.length === 0) {
      return {
        action: 'inject',
        context: '**OpenSpec Hook**: No changes found to archive.',
      };
    }

    if (changes.length === 1) {
      changeId = changes[0].id;
    } else {
      return {
        action: 'inject',
        context: `**OpenSpec Hook**: Multiple changes available. Please specify which to archive:\n${await listAvailableChanges()}`,
      };
    }
  }

  const reviewNote = skipReview
    ? '\n**Note**: Skipping review agents (--skip-review flag detected)'
    : '\n**Note**: Running code review, documentation review, and worklog generation first';

  const context = [
    '',
    '**OpenSpec Hook**: Archiving change `' + changeId + '`',
    reviewNote,
    '',
    skipReview ? 'I will now run `/openspec:archive ' + changeId + '` immediately.' :
    'I will now:',
    ...(!skipReview ? [
      '1. Run worklog generator to preserve session context',
      '2. Run code review agent to check quality and patterns',
      '3. Run documentation agent to verify docs are updated',
      '4. Present findings and ask how to proceed',
      '5. If approved, run `/openspec:archive ' + changeId + '`',
    ] : []),
    '',
  ].filter(Boolean).join('\n');

  return {
    action: 'inject',
    context,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * List available changes as formatted string
 */
async function listAvailableChanges(): Promise<string> {
  const changes = await listChanges();
  if (changes.length === 0) {
    return '  (no changes found)';
  }

  return changes.map((c) => `  - ${c.id}`).join('\n');
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
  console.error('[User Messages] Fatal error:', error);
  outputResponse({ action: 'allow' });
  process.exit(0);
});
