#!/usr/bin/env node
/**
 * OpenSpec Statusline Script
 *
 * Displays a two-line status bar showing:
 * Line 1: Change state | Context usage bar
 * Line 2: Mode | Edited files | Open changes | Git branch (with upstream)
 *
 * Colors based on Ayu Dark theme with Nerd Fonts/emoji/ASCII fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadState,
  getCurrentBranch,
  findActiveChangeForBranch,
  getChangedFiles,
  getUpstreamTracking,
  isDetachedHead,
  getShortCommitHash,
  listChanges,
  countCompletedTasks,
} from './shared-state.js';

// ============================================================================
// Color Constants (Ayu Dark)
// ============================================================================

const COLORS = {
  green: '\x1b[38;5;114m',      // < 50% context
  orange: '\x1b[38;5;215m',     // 50-80% context, edited files, upstream
  red: '\x1b[38;5;203m',        // > 80% context
  lightGray: '\x1b[38;5;250m',  // Branch name, labels
  gray: '\x1b[38;5;242m',       // Empty progress blocks
  cyan: '\x1b[38;5;111m',       // Proposal identifier
  purple: '\x1b[38;5;183m',     // Mode text
  reset: '\x1b[0m',
};

// ============================================================================
// Icon Sets
// ============================================================================

const ICONS = {
  nerdFonts: {
    discussion: '\ue3fc',    // 󰭹
    implementation: '\ue43d', // 󰷫
    branch: '\ue0a0',        //
    detached: '\ue26a',      // 󰌺
    context: '\uf6ed',       // 󱃖
  },
  emoji: {
    discussion: '💬',
    implementation: '🛠️',
    branch: 'Branch:',
    detached: '@',
    context: ' ',
  },
  ascii: {
    discussion: 'Discussion',
    implementation: 'Implementation',
    branch: 'Branch:',
    detached: '@',
    context: ' ',
  },
};

// Detect icon support (simplified - assume emoji for now)
const ICON_SET = ICONS.emoji;

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    const statusLine = await buildStatusLine();
    process.stdout.write(statusLine);
  } catch (error: any) {
    console.error(`[Statusline] Error: ${error.message}`);
    process.stdout.write('OpenSpec | Error loading status\n');
  }
}

// ============================================================================
// Status Line Builder
// ============================================================================

/**
 * Build the complete two-line status display
 */
async function buildStatusLine(): Promise<string> {
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  // Line 1: Change state | Context usage
  const line1 = await buildLine1(activeChange);

  // Line 2: Mode | Edited files | Open changes | Git branch
  const line2 = await buildLine2(activeChange, currentBranch, state);

  return `${line1}\n${line2}`;
}

/**
 * Build Line 1: Change state | Context usage bar
 */
async function buildLine1(activeChange: any): Promise<string> {
  const changeInfo = buildChangeInfo(activeChange);
  const contextBar = buildContextBar();

  // Right-align context bar (assume 80 char width)
  const totalWidth = 80;
  const changeInfoStripped = stripAnsi(changeInfo);
  const contextBarStripped = stripAnsi(contextBar);
  const padding = totalWidth - changeInfoStripped.length - contextBarStripped.length;

  if (padding > 0) {
    return `${changeInfo}${' '.repeat(padding)}${contextBar}`;
  } else {
    return `${changeInfo} ${contextBar}`;
  }
}

/**
 * Build Line 2: Mode | Edited files | Open changes | Git branch
 */
async function buildLine2(
  activeChange: any,
  currentBranch: string,
  state: any
): Promise<string> {
  const parts: string[] = [];

  // Mode indicator
  const modeIcon = activeChange ? ICON_SET.implementation : ICON_SET.discussion;
  const modeText = activeChange ? 'Implementation' : 'Discussion';
  const modeColor = activeChange ? COLORS.purple : COLORS.lightGray;

  let modePart = `${modeColor}${modeIcon} ${modeText}${COLORS.reset}`;

  // Add todo progress for implementation mode
  if (activeChange && activeChange.approved_todos) {
    const { completed, total } = countCompletedTasks(activeChange.approved_todos);
    modePart += ` ${COLORS.lightGray}(${completed}/${total})${COLORS.reset}`;
  }

  parts.push(modePart);

  // Edited files count
  const changedFiles = getChangedFiles();
  if (changedFiles.length > 0) {
    parts.push(`${COLORS.orange}✎ ${changedFiles.length}${COLORS.reset}`);
  } else {
    parts.push(`${COLORS.lightGray}✎ 0${COLORS.reset}`);
  }

  // Open changes count
  const allChanges = await listChanges();
  let openCount = allChanges.length;

  // Exclude current active change if in implementation
  if (activeChange) {
    openCount = Math.max(0, openCount - 1);
  }

  parts.push(`${COLORS.lightGray}📋 ${openCount} open${COLORS.reset}`);

  // Git branch info
  const branchPart = buildBranchInfo(currentBranch);
  parts.push(branchPart);

  return parts.join(' | ');
}

/**
 * Build change state info for Line 1
 */
function buildChangeInfo(activeChange: any): string {
  if (!activeChange) {
    return `${COLORS.lightGray}💬 No active change${COLORS.reset}`;
  }

  const { completed, total } = countCompletedTasks(activeChange.approved_todos || []);
  const allComplete = completed === total && total > 0;

  if (allComplete) {
    return `${COLORS.cyan}✅ ${activeChange.changeId}${COLORS.reset}`;
  } else {
    return `${COLORS.cyan}📝 ${activeChange.changeId}${COLORS.reset}`;
  }
}

/**
 * Build context usage bar (mock - would need actual context data)
 */
function buildContextBar(): string {
  // Mock context data (would need to read from transcript or Claude API)
  const contextUsed = 0;
  const contextTotal = 200000;
  const percentage = 0;

  // Color based on percentage
  let color = COLORS.green;
  if (percentage >= 80) {
    color = COLORS.red;
  } else if (percentage >= 50) {
    color = COLORS.orange;
  }

  // Build progress bar (10 blocks)
  const filledBlocks = Math.floor(percentage / 10);
  const emptyBlocks = 10 - filledBlocks;
  const bar = color + '█'.repeat(filledBlocks) + COLORS.gray + '░'.repeat(emptyBlocks) + COLORS.reset;

  const usedStr = formatNumber(contextUsed);
  const totalStr = formatNumber(contextTotal);

  return `${COLORS.lightGray}${ICON_SET.context} ${bar} ${percentage.toFixed(1)}% (${usedStr}/${totalStr})${COLORS.reset}`;
}

/**
 * Build git branch info with upstream tracking
 */
function buildBranchInfo(currentBranch: string): string {
  if (isDetachedHead()) {
    const hash = getShortCommitHash();
    return `${COLORS.lightGray}${ICON_SET.detached} ${hash}${COLORS.reset}`;
  }

  const upstream = getUpstreamTracking();
  let upstreamPart = '';

  if (upstream && (upstream.ahead > 0 || upstream.behind > 0)) {
    const parts: string[] = [];
    if (upstream.ahead > 0) parts.push(`↑${upstream.ahead}`);
    if (upstream.behind > 0) parts.push(`↓${upstream.behind}`);
    upstreamPart = ` ${COLORS.orange}(${parts.join(' ')})${COLORS.reset}`;
  }

  return `${COLORS.lightGray}${ICON_SET.branch} ${currentBranch}${COLORS.reset}${upstreamPart}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Strip ANSI escape codes for length calculation
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Format large numbers with K/M suffix
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(0)}k`;
  } else {
    return num.toString();
  }
}

// ============================================================================
// Execute Main
// ============================================================================

main().catch((error) => {
  console.error('[Statusline] Fatal error:', error);
  process.exit(0);
});
