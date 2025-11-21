#!/usr/bin/env node
/**
 * OpenSpec Worklog Generator Hook
 *
 * Generates worklog entries to preserve session context. Invoked when:
 * - User says "pause:" or "pause: [note]"
 * - During archive process (via review-agents.ts)
 *
 * The worklog agent extracts key information from the conversation transcript:
 * - Accomplishments (what was done)
 * - Decisions (choices made and why)
 * - Discoveries (things learned about the codebase)
 * - Problems & Solutions (issues encountered and fixes)
 * - Next Steps (what remains to be done)
 *
 * This enables context preservation across sessions and token limit resets.
 */

import * as path from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

interface WorklogInput {
  changeId: string;
  changePath: string;
  note?: string;
}

interface WorklogOutput {
  instructions: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    // Read worklog input from stdin
    const input = await readStdin();
    if (!input) {
      console.error('[Worklog Generator] No input provided');
      process.exit(1);
    }

    let worklogInput: WorklogInput;
    try {
      worklogInput = JSON.parse(input);
    } catch {
      console.error('[Worklog Generator] Invalid JSON input');
      process.exit(1);
    }

    // Generate worklog instructions
    const output = generateWorklogInstructions(worklogInput);
    process.stdout.write(output.instructions);
  } catch (error: any) {
    console.error(`[Worklog Generator] Error: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Worklog Instructions Generator
// ============================================================================

/**
 * Generate instructions for Claude to create a worklog entry
 */
function generateWorklogInstructions(input: WorklogInput): WorklogOutput {
  const lines: string[] = [];

  const worklogPath = path.join(input.changePath, 'worklog.md');
  const tasksMdPath = path.join(input.changePath, 'tasks.md');

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('**OpenSpec Worklog Checkpoint**');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`**Change**: \`${input.changeId}\``);
  if (input.note) {
    lines.push(`**Note**: "${input.note}"`);
  }
  lines.push('');
  lines.push('I will now analyze the conversation transcript and create a worklog entry');
  lines.push('to preserve context for future sessions.');
  lines.push('');

  // Worklog agent instructions
  lines.push('## Worklog Agent Instructions');
  lines.push('');
  lines.push('Review the entire conversation history (all messages and tool calls) and extract:');
  lines.push('');

  lines.push('### 1. Accomplishments');
  lines.push('What was actually implemented or completed in this session:');
  lines.push('- Code files created/modified (with file paths)');
  lines.push('- Features added or enhanced');
  lines.push('- Bugs fixed');
  lines.push('- Tests written');
  lines.push('- Configuration changes made');
  lines.push('');
  lines.push('Be specific. Instead of "implemented auth", say:');
  lines.push('- "Implemented JWT middleware in `src/auth/jwt.ts`"');
  lines.push('- "Added refresh token logic with 7-day expiry"');
  lines.push('- "Created auth endpoints: `/auth/login`, `/auth/refresh`, `/auth/logout`"');
  lines.push('');

  lines.push('### 2. Decisions');
  lines.push('Technical choices made and their rationale:');
  lines.push('- Architecture decisions (and why)');
  lines.push('- Library/framework selections');
  lines.push('- Pattern choices');
  lines.push('- Trade-offs considered');
  lines.push('');
  lines.push('Format: **Decision**: Rationale');
  lines.push('Example:');
  lines.push('- **Using RS256 instead of HS256**: Better security with asymmetric keys');
  lines.push('- **Token storage in HttpOnly cookies**: Prevents XSS attacks');
  lines.push('');

  lines.push('### 3. Discoveries');
  lines.push('New information learned about the codebase:');
  lines.push('- Hidden dependencies found');
  lines.push('- Gotchas and edge cases');
  lines.push('- Existing patterns discovered');
  lines.push('- Behavior that wasn\'t obvious from the code');
  lines.push('');
  lines.push('Example:');
  lines.push('- "Auth module has hidden dependency on session store in `src/session/store.ts`"');
  lines.push('- "User model already has `lastLogin` field we can populate"');
  lines.push('');

  lines.push('### 4. Problems & Solutions');
  lines.push('Issues encountered and how they were resolved:');
  lines.push('- Errors and their fixes');
  lines.push('- Blockers and workarounds');
  lines.push('- Testing challenges');
  lines.push('- Unexpected behavior');
  lines.push('');
  lines.push('Format:');
  lines.push('- **Problem**: Description');
  lines.push('  - **Solution**: How it was fixed (with file/line references if relevant)');
  lines.push('');
  lines.push('Example:');
  lines.push('- **Problem**: Token expiry wasn\'t respecting timezone');
  lines.push('  - **Solution**: Switched to UTC timestamps throughout, convert to local only for display');
  lines.push('');

  lines.push('### 5. Next Steps');
  lines.push('What remains to be done:');
  lines.push('- Uncompleted tasks from `tasks.md`');
  lines.push('- Follow-up items identified during implementation');
  lines.push('- Technical debt or improvements noted');
  lines.push('- Testing that still needs to be done');
  lines.push('');

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('## Output Format');
  lines.push('');
  lines.push('Generate a timestamped entry and **write it to**:');
  lines.push('`' + worklogPath + '`');
  lines.push('');
  lines.push('If the file exists, **append** to it. If not, **create** it.');
  lines.push('');
  lines.push('Use this exact markdown structure:');
  lines.push('');
  lines.push('```markdown');
  lines.push('## ' + getCurrentTimestamp());
  lines.push('');
  if (input.note) {
    lines.push('> ' + input.note);
    lines.push('');
  }
  lines.push('### Accomplishments');
  lines.push('- Implemented JWT middleware in `src/auth/jwt.ts`');
  lines.push('- Added refresh token logic with 7-day expiry');
  lines.push('- Created auth endpoints: `/auth/login`, `/auth/refresh`, `/auth/logout`');
  lines.push('');
  lines.push('### Decisions');
  lines.push('- **Using RS256 instead of HS256**: Better security with asymmetric keys, allows public verification');
  lines.push('- **Refresh token rotation**: Each refresh generates new token, invalidates old one');
  lines.push('');
  lines.push('### Discoveries');
  lines.push('- Auth module has hidden dependency on session store in `src/session/store.ts`');
  lines.push('- Existing rate limiter must be configured per endpoint (not global)');
  lines.push('');
  lines.push('### Problems & Solutions');
  lines.push('- **Problem**: Token expiry wasn\'t respecting timezone');
  lines.push('  - **Solution**: Switched to UTC timestamps throughout, convert to local only for display');
  lines.push('');
  lines.push('### Next Steps');
  lines.push('- Add comprehensive tests for error cases (invalid tokens, expired, malformed)');
  lines.push('- Update API documentation with authentication flow diagrams');
  lines.push('');
  lines.push('---');
  lines.push('```');
  lines.push('');
  lines.push('After creating the worklog entry, also update:');
  lines.push('`' + tasksMdPath + '`');
  lines.push('');
  lines.push('Add progress notes to relevant tasks (optional, but helpful):');
  lines.push('- Update task checkboxes based on accomplishments');
  lines.push('- Add inline notes about discoveries or gotchas');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('After completing the worklog, report:');
  lines.push('```');
  lines.push('✓ Worklog updated: [N] accomplishments, [M] decisions, [K] discoveries');
  lines.push('✓ Path: ' + worklogPath);
  lines.push('✓ tasks.md updated with progress notes');
  lines.push('');
  lines.push('Context preserved! You can resume this change anytime with:');
  lines.push('`apply: ' + input.changeId + '`');
  lines.push('```');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  return {
    instructions: lines.join('\n'),
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current timestamp in YYYY-MM-DD HH:MM format
 */
function getCurrentTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
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

    setTimeout(() => {
      resolve('');
    }, 5000);
  });
}

// ============================================================================
// Execute Main
// ============================================================================

main().catch((error) => {
  console.error('[Worklog Generator] Fatal error:', error);
  process.exit(1);
});
