#!/usr/bin/env node
/**
 * OpenSpec Session Start Hook (SessionStart)
 *
 * Displays current state when a Claude Code session starts:
 * - Current mode (discussion/implementation)
 * - Active change info (if any)
 * - Recent worklog entries
 * - Available changes (in discussion mode)
 *
 * This hook runs on session start (startup or after /clear).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  loadState,
  getCurrentBranch,
  findActiveChangeForBranch,
  listChanges,
  countCompletedTasks,
} from './shared-state.js';

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    await displaySessionInfo();
  } catch (error: any) {
    console.error(`[Session Start] Error: ${error.message}`);
  }
}

// ============================================================================
// Session Info Display
// ============================================================================

/**
 * Display session information
 */
async function displaySessionInfo(): Promise<void> {
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('📋 **OpenSpec Session**');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  if (activeChange) {
    // Implementation mode
    await displayImplementationMode(lines, activeChange, currentBranch);
  } else {
    // Discussion mode
    await displayDiscussionMode(lines, currentBranch);
  }

  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');

  // Output all lines
  process.stdout.write(lines.join('\n'));
}

/**
 * Display implementation mode info
 */
async function displayImplementationMode(
  lines: string[],
  activeChange: any,
  currentBranch: string
): Promise<void> {
  lines.push('**Mode**: 🛠️ Implementation');
  lines.push(`**Change**: \`${activeChange.changeId}\``);
  lines.push(`**Branch**: \`${currentBranch}\``);
  lines.push('');

  // Show progress
  const { completed, total } = countCompletedTasks(activeChange.approved_todos || []);
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  lines.push(`**Progress**: ${completed}/${total} tasks complete (${percentage}%)`);
  lines.push('');

  // Show recent worklog entries
  const worklogPath = path.join(
    process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    'openspec',
    'changes',
    activeChange.changeId,
    'worklog.md'
  );

  try {
    const worklogContent = await fs.readFile(worklogPath, 'utf-8');
    const recentEntries = extractRecentWorklogEntries(worklogContent, 3);
    if (recentEntries.length > 0) {
      lines.push('**Recent Work** (from worklog.md):');
      lines.push('');
      recentEntries.forEach((entry) => {
        lines.push(entry);
      });
      lines.push('');
    }
  } catch {
    // No worklog yet
  }

  lines.push('**What you can do**:');
  lines.push('  - Continue implementing tasks');
  lines.push('  - Use `pause:` to checkpoint progress');
  lines.push('  - Use `archive` when all tasks complete');
  lines.push('');
}

/**
 * Display discussion mode info
 */
async function displayDiscussionMode(
  lines: string[],
  currentBranch: string
): Promise<void> {
  lines.push('**Mode**: 💬 Discussion');
  lines.push(`**Branch**: \`${currentBranch}\``);
  lines.push('');

  // List available changes
  const changes = await listChanges();
  if (changes.length > 0) {
    lines.push(`**Available Changes** (${changes.length}):`);
    changes.forEach((change) => {
      lines.push(`  - \`${change.id}\``);
    });
    lines.push('');
  } else {
    lines.push('**Available Changes**: (none)');
    lines.push('');
  }

  lines.push('**What you can do**:');
  lines.push('  - Discuss ideas freely');
  lines.push('  - Use `propose: [description]` to create a new change');
  if (changes.length > 0) {
    lines.push('  - Use `apply: [change-id]` to start implementing');
  }
  lines.push('');
}

// ============================================================================
// Worklog Parsing
// ============================================================================

/**
 * Extract recent worklog entries (last N timestamps)
 */
function extractRecentWorklogEntries(content: string, count: number): string[] {
  const lines = content.split('\n');
  const entries: string[] = [];
  let currentEntry: string[] = [];
  let inEntry = false;

  // Look for timestamp headers (## YYYY-MM-DD HH:MM)
  const timestampRegex = /^##\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/;

  for (const line of lines) {
    if (timestampRegex.test(line)) {
      // New timestamp found
      if (currentEntry.length > 0) {
        entries.push(currentEntry.join('\n'));
      }
      currentEntry = [line];
      inEntry = true;
    } else if (inEntry && line.trim() !== '') {
      // Add line to current entry (skip empty lines at boundaries)
      if (line.startsWith('###') || line.startsWith('-') || line.startsWith('**')) {
        currentEntry.push(line);
      }
    }
  }

  // Add last entry
  if (currentEntry.length > 0) {
    entries.push(currentEntry.join('\n'));
  }

  // Return last N entries
  return entries.slice(-count);
}

// ============================================================================
// Execute Main
// ============================================================================

main().catch((error) => {
  console.error('[Session Start] Fatal error:', error);
  process.exit(0);
});
