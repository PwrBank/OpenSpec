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

// ============================================================================
// Types for Claude Code stdin data
// ============================================================================

interface ClaudeCodeInput {
  cwd?: string;
  model?: {
    display_name?: string;
  };
  session_id?: string;
  transcript_path?: string;
}

interface UsageData {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

interface TranscriptLine {
  message?: {
    usage?: UsageData;
  };
  timestamp?: string;
  sessionId?: string;
  isSidechain?: boolean;
}
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
// Stdin Input Parsing
// ============================================================================

/**
 * Read and parse JSON input from stdin (provided by Claude Code)
 */
function readStdinInput(): ClaudeCodeInput {
  try {
    const inputData = fs.readFileSync(0, 'utf-8');
    return JSON.parse(inputData);
  } catch {
    return {};
  }
}

// ============================================================================
// Transcript Processing
// ============================================================================

/**
 * Detect stale transcripts and find the current one by session ID
 */
function findCurrentTranscript(
  transcriptPath: string | null | undefined,
  sessionId: string | null | undefined,
  staleThreshold: number = 30
): string | null {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return transcriptPath || null;
  }

  try {
    // Read last line of transcript to get last message timestamp
    const lines = fs.readFileSync(transcriptPath, 'utf-8')
      .split('\n')
      .filter(line => line.trim());

    if (!lines.length) {
      return transcriptPath;
    }

    const lastLine = lines[lines.length - 1];
    const lastMsg: TranscriptLine = JSON.parse(lastLine);
    const lastTimestamp = lastMsg.timestamp;

    if (!lastTimestamp) {
      return transcriptPath;
    }

    // Parse ISO timestamp and compare to current time
    const lastTime = new Date(lastTimestamp);
    const currentTime = new Date();
    const ageSeconds = (currentTime.getTime() - lastTime.getTime()) / 1000;

    // If transcript is fresh, return it
    if (ageSeconds <= staleThreshold) {
      return transcriptPath;
    }

    // Transcript is stale - search for current one
    const transcriptDir = path.dirname(transcriptPath);
    const allFiles = fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
      .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime())
      .slice(0, 5);  // Top 5 most recent

    // Check each transcript for matching session ID
    for (const candidate of allFiles) {
      try {
        const candidateLines = fs.readFileSync(candidate, 'utf-8')
          .split('\n')
          .filter(line => line.trim());

        if (!candidateLines.length) {
          continue;
        }

        // Check last line for session ID
        const candidateLast: TranscriptLine = JSON.parse(candidateLines[candidateLines.length - 1]);
        const candidateSessionId = candidateLast.sessionId;

        if (candidateSessionId === sessionId) {
          // Verify this transcript is fresh
          const candidateTimestamp = candidateLast.timestamp;
          if (candidateTimestamp) {
            const candidateTime = new Date(candidateTimestamp);
            const candidateAge = (currentTime.getTime() - candidateTime.getTime()) / 1000;

            if (candidateAge <= staleThreshold) {
              return candidate;
            }
          }
        }
      } catch {
        continue;
      }
    }

    // No fresh transcript found, return original
    return transcriptPath;
  } catch {
    // Any error, return original path
    return transcriptPath;
  }
}

/**
 * Parse transcript file and extract context usage data
 */
function parseTranscriptForContext(transcriptPath: string | null): number | null {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return null;
  }

  try {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n');
    let mostRecentUsage: UsageData | null = null;
    let mostRecentTimestamp: string | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const lineData: TranscriptLine = JSON.parse(line);

        // Skip sidechain entries (subagent calls)
        if (lineData.isSidechain) continue;

        // Check for usage data in main-chain messages
        if (lineData.message?.usage) {
          const timestamp = lineData.timestamp;
          if (timestamp && (!mostRecentTimestamp || timestamp > mostRecentTimestamp)) {
            mostRecentTimestamp = timestamp;
            mostRecentUsage = lineData.message.usage;
          }
        }
      } catch {
        continue;
      }
    }

    // Calculate context length (input + cache tokens only, NOT output)
    if (mostRecentUsage) {
      return (mostRecentUsage.input_tokens || 0) +
             (mostRecentUsage.cache_read_input_tokens || 0) +
             (mostRecentUsage.cache_creation_input_tokens || 0);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Determine context limit based on model name
 */
function getContextLimit(modelName: string): number {
  const lowerName = modelName.toLowerCase();

  // Check for 1M context models
  if (lowerName.includes('[1m]') || lowerName.includes('1m') || lowerName.includes('1000k')) {
    return 800000;
  }

  // Default to standard context limit
  return 160000;
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  try {
    // Read input from Claude Code via stdin
    const input = readStdinInput();
    const modelName = input.model?.display_name || 'unknown';
    const sessionId = input.session_id || null;
    const transcriptPath = input.transcript_path || null;

    // Determine context limit based on model
    const contextLimit = getContextLimit(modelName);

    // Find current transcript (handling stale transcripts)
    const currentTranscriptPath = findCurrentTranscript(transcriptPath, sessionId);

    // Parse context usage from transcript
    let contextLength: number | null = null;
    if (currentTranscriptPath) {
      contextLength = parseTranscriptForContext(currentTranscriptPath);

      // Ignore suspiciously low context values (likely initial/empty sessions)
      if (contextLength && contextLength < 17000) {
        contextLength = null;
      }
    }

    const statusLine = await buildStatusLine(contextLength, contextLimit);
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
async function buildStatusLine(
  contextLength: number | null,
  contextLimit: number
): Promise<string> {
  const state = await loadState();
  const currentBranch = getCurrentBranch();
  const activeChange = findActiveChangeForBranch(state, currentBranch);

  // Line 1: Change state | Context usage
  const line1 = await buildLine1(activeChange, contextLength, contextLimit);

  // Line 2: Mode | Edited files | Open changes | Git branch
  const line2 = await buildLine2(activeChange, currentBranch, state);

  return `${line1}\n${line2}`;
}

/**
 * Build Line 1: Change state | Context usage bar
 */
async function buildLine1(
  activeChange: any,
  contextLength: number | null,
  contextLimit: number
): Promise<string> {
  const changeInfo = buildChangeInfo(activeChange);
  const contextBar = buildContextBar(contextLength, contextLimit);

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
 * Build context usage bar with real data from transcript
 */
function buildContextBar(contextLength: number | null, contextLimit: number): string {
  // Use real context data from transcript parsing
  const contextUsed = contextLength || 0;
  const contextTotal = contextLimit;
  const percentage = contextUsed > 0 ? (contextUsed / contextTotal) * 100 : 0;

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
