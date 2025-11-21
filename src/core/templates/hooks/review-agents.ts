#!/usr/bin/env node
/**
 * OpenSpec Review Agents Orchestrator
 *
 * Orchestrates the review process before archiving a change:
 * 1. Worklog agent - Preserves session context
 * 2. Code review agent - Checks quality, security, patterns
 * 3. Documentation agent - Verifies docs are updated
 *
 * Aggregates results and presents user with decision:
 * - Fix issues now
 * - Archive anyway (issues noted)
 * - Create follow-up change
 *
 * This is invoked by the archive workflow when review is enabled.
 */

import * as path from 'path';
import { getChangedFilesFromMain } from './shared-state.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface ReviewInput {
  changeId: string;
  changePath: string;
  skipReview: boolean;
}

interface ReviewOutput {
  instructions: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    // Read review input from stdin
    const input = await readStdin();
    if (!input) {
      console.error('[Review Agents] No input provided');
      process.exit(1);
    }

    let reviewInput: ReviewInput;
    try {
      reviewInput = JSON.parse(input);
    } catch {
      console.error('[Review Agents] Invalid JSON input');
      process.exit(1);
    }

    // Generate review instructions
    const output = await generateReviewInstructions(reviewInput);
    process.stdout.write(output.instructions);
  } catch (error: any) {
    console.error(`[Review Agents] Error: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Review Instructions Generator
// ============================================================================

/**
 * Generate instructions for Claude to run review agents
 */
async function generateReviewInstructions(
  input: ReviewInput
): Promise<ReviewOutput> {
  if (input.skipReview) {
    return {
      instructions: generateSkipReviewInstructions(input),
    };
  } else {
    return {
      instructions: await generateFullReviewInstructions(input),
    };
  }
}

/**
 * Generate instructions for skipping review
 */
function generateSkipReviewInstructions(input: ReviewInput): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('**OpenSpec Hook**: Skipping review agents (--skip-review flag)');
  lines.push('');
  lines.push(`Proceeding directly to archive \`${input.changeId}\`...`);
  lines.push('');
  lines.push('Run: `openspec archive ' + input.changeId + ' --yes`');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate instructions for full review workflow
 */
async function generateFullReviewInstructions(
  input: ReviewInput
): Promise<string> {
  const lines: string[] = [];

  // Get changed files for context
  const changedFiles = getChangedFilesFromMain();

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('**OpenSpec Pre-Archive Review**');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`**Change**: \`${input.changeId}\``);
  lines.push(`**Changed Files**: ${changedFiles.length} files`);
  lines.push('');
  lines.push('I will now run three review agents to assess this change before archiving:');
  lines.push('');

  // 1. Worklog Generator Agent
  lines.push('### 1. 📝 Worklog Generator');
  lines.push('');
  lines.push('**Purpose**: Preserve session context for future reference');
  lines.push('');
  lines.push('**Agent Instructions**:');
  lines.push('```');
  lines.push('You are the Worklog Generator agent. Your task is to analyze the conversation');
  lines.push('transcript and create a comprehensive worklog entry.');
  lines.push('');
  lines.push('**Change**: ' + input.changeId);
  lines.push('**Change Path**: ' + input.changePath);
  lines.push('');
  lines.push('Review the conversation and extract:');
  lines.push('');
  lines.push('1. **Accomplishments**: What was implemented or completed');
  lines.push('   - Code files created/modified');
  lines.push('   - Features added');
  lines.push('   - Bugs fixed');
  lines.push('');
  lines.push('2. **Decisions**: Technical choices made and rationale');
  lines.push('   - Architecture decisions');
  lines.push('   - Library/framework selections');
  lines.push('   - Pattern choices');
  lines.push('');
  lines.push('3. **Discoveries**: New information learned about the codebase');
  lines.push('   - Hidden dependencies');
  lines.push('   - Gotchas and edge cases');
  lines.push('   - Existing patterns discovered');
  lines.push('');
  lines.push('4. **Problems & Solutions**: Issues encountered and how they were resolved');
  lines.push('   - Errors and their fixes');
  lines.push('   - Blockers and workarounds');
  lines.push('   - Testing challenges');
  lines.push('');
  lines.push('5. **Next Steps**: What remains to be done (if any)');
  lines.push('   - Follow-up items');
  lines.push('   - Technical debt identified');
  lines.push('');
  lines.push('Generate a timestamped worklog entry in markdown format and write it to:');
  lines.push('`' + path.join(input.changePath, 'worklog.md') + '`');
  lines.push('');
  lines.push('If the file exists, append to it. If not, create it.');
  lines.push('');
  lines.push('Use this format:');
  lines.push('```markdown');
  lines.push('## YYYY-MM-DD HH:MM');
  lines.push('');
  lines.push('### Accomplishments');
  lines.push('- Item 1');
  lines.push('- Item 2');
  lines.push('');
  lines.push('### Decisions');
  lines.push('- **Decision**: Rationale');
  lines.push('');
  lines.push('### Discoveries');
  lines.push('- Discovery 1');
  lines.push('');
  lines.push('### Problems & Solutions');
  lines.push('- **Problem**: Description');
  lines.push('  - **Solution**: How it was fixed');
  lines.push('```');
  lines.push('');
  lines.push('After completing the worklog, report:');
  lines.push('- Number of accomplishments logged');
  lines.push('- Number of decisions logged');
  lines.push('- Number of discoveries logged');
  lines.push('- Path to worklog.md');
  lines.push('```');
  lines.push('');

  // 2. Code Review Agent
  lines.push('### 2. 🔍 Code Review');
  lines.push('');
  lines.push('**Purpose**: Check code quality, security, and pattern adherence');
  lines.push('');
  lines.push('**Agent Instructions**:');
  lines.push('```');
  lines.push('You are the Code Review agent. Your task is to review the changed code for');
  lines.push('quality, security vulnerabilities, and pattern adherence.');
  lines.push('');
  lines.push('**Change**: ' + input.changeId);
  lines.push('**Changed Files**:');
  changedFiles.forEach((file) => {
    lines.push('  - ' + file);
  });
  lines.push('');
  lines.push('Review the code changes against:');
  lines.push('1. **proposal.md** - Check if implementation matches the plan');
  lines.push('2. **tasks.md** - Verify all tasks were completed');
  lines.push('3. **Spec deltas** - Ensure specs accurately reflect the changes');
  lines.push('');
  lines.push('Check for:');
  lines.push('- 🔴 **Critical Issues**:');
  lines.push('  - Security vulnerabilities (OWASP Top 10)');
  lines.push('  - Incorrect implementations (doesn\'t match proposal)');
  lines.push('  - Breaking changes without migration path');
  lines.push('  - Data loss risks');
  lines.push('');
  lines.push('- 🟡 **Warnings**:');
  lines.push('  - LLM slop patterns (unnecessary abstractions, over-commenting)');
  lines.push('  - Pattern violations (doesn\'t follow codebase conventions)');
  lines.push('  - Missing error handling for critical paths');
  lines.push('  - Test coverage gaps');
  lines.push('');
  lines.push('- 🟢 **Suggestions**:');
  lines.push('  - Code improvements (readability, performance)');
  lines.push('  - Missing edge case handling');
  lines.push('  - Refactoring opportunities');
  lines.push('');
  lines.push('Output format:');
  lines.push('```markdown');
  lines.push('## Code Review Results');
  lines.push('');
  lines.push('### 🔴 Critical Issues');
  lines.push('- Issue 1 (file.ts:line)');
  lines.push('');
  lines.push('### 🟡 Warnings');
  lines.push('- Warning 1 (file.ts:line)');
  lines.push('');
  lines.push('### 🟢 Suggestions');
  lines.push('- Suggestion 1 (file.ts:line)');
  lines.push('```');
  lines.push('```');
  lines.push('');

  // 3. Documentation Agent
  lines.push('### 3. 📚 Documentation Review');
  lines.push('');
  lines.push('**Purpose**: Verify documentation is updated and accurate');
  lines.push('');
  lines.push('**Agent Instructions**:');
  lines.push('```');
  lines.push('You are the Documentation agent. Your task is to ensure all documentation');
  lines.push('is updated to reflect the changes made.');
  lines.push('');
  lines.push('**Change**: ' + input.changeId);
  lines.push('');
  lines.push('Check:');
  lines.push('1. **README.md** - Updated with new features/changes');
  lines.push('2. **AGENTS.md** - Updated with new patterns or instructions');
  lines.push('3. **proposal.md** - Still accurate after implementation');
  lines.push('4. **tasks.md** - All tasks marked complete and accurate');
  lines.push('5. **Code comments** - Critical sections documented');
  lines.push('');
  lines.push('Report:');
  lines.push('- ✓ Documentation that is up-to-date');
  lines.push('- ⚠️ Documentation that needs updating');
  lines.push('- ℹ️ Suggestions for additional documentation');
  lines.push('');
  lines.push('Output format:');
  lines.push('```markdown');
  lines.push('## Documentation Review Results');
  lines.push('');
  lines.push('### ✓ Up-to-date');
  lines.push('- README.md: Feature X documented');
  lines.push('');
  lines.push('### ⚠️ Needs Update');
  lines.push('- CHANGELOG.md: Missing entry for breaking change');
  lines.push('');
  lines.push('### ℹ️ Suggestions');
  lines.push('- Add migration guide for API changes');
  lines.push('```');
  lines.push('```');
  lines.push('');

  // Final instructions
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('**After running all three agents**, aggregate the results and ask the user:');
  lines.push('');
  lines.push('```');
  lines.push('Review complete. Issues found:');
  lines.push('  - [Summary of critical issues]');
  lines.push('  - [Summary of warnings]');
  lines.push('');
  lines.push('How would you like to proceed?');
  lines.push('  1. Fix issues now (stay in implementation mode)');
  lines.push('  2. Archive anyway (issues noted in .review-notes.md)');
  lines.push('  3. Create follow-up change for fixes');
  lines.push('```');
  lines.push('');
  lines.push('If option 2 (Archive anyway) is selected:');
  lines.push('  - Save all review reports to `' + path.join(input.changePath, '.review-notes.md') + '`');
  lines.push('  - Run `openspec archive ' + input.changeId + ' --yes`');
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
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
  console.error('[Review Agents] Fatal error:', error);
  process.exit(1);
});
