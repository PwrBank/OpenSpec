#!/usr/bin/env node
/**
 * Shared State Management for OpenSpec Claude Hooks
 *
 * This module provides centralized state management, git operations,
 * and utility functions for the OpenSpec hook system.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as crypto from 'crypto';

// ============================================================================
// Type Definitions
// ============================================================================

export interface OpenSpecState {
  mode: 'discussion' | 'implementation';
  active_changes: ActiveChange[];
  proposal_keywords: string[];
  implementation_keywords: string[];
  pause_keywords: string[];
  archive_keywords: string[];
  review_agents_enabled: boolean;
  worklog_enabled: boolean;
}

export interface ActiveChange {
  changeId: string;
  branch: string;
  tasks_md_hash: string;
  proposal_md_hash: string;
  approved_todos: Task[];
  last_worklog_update?: string;
  worklog_entries?: number;
}

export interface Task {
  content: string;
  completed: boolean;
  line: number;
}

export interface Change {
  id: string;
  path: string;
  proposalPath: string;
  tasksMdPath: string;
  worklogPath: string;
  exists: boolean;
}

export interface TodoDiff {
  added: Task[];
  removed: Task[];
  modified: Array<{ old: Task; new: Task }>;
  unchanged: Task[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Find the project root directory
 * Priority: CLAUDE_PROJECT_DIR env var > git root > current working directory
 */
function findProjectRoot(): string {
  // First priority: CLAUDE_PROJECT_DIR environment variable set by Claude Code
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }

  // Second priority: Find git root from current working directory
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
    }).trim();

    // On Windows, git returns forward slashes, normalize to backslashes
    return gitRoot.replace(/\//g, path.sep);
  } catch (error) {
    // Last resort: use current working directory
    // This may fail if hooks are run from wrong directory
    return process.cwd();
  }
}

const PROJECT_ROOT = findProjectRoot();
const STATE_FILE = path.join(PROJECT_ROOT, 'openspec', 'state', 'openspec-state.json');
const CHANGES_DIR = path.join(PROJECT_ROOT, 'openspec', 'changes');

// ============================================================================
// State File Operations
// ============================================================================

/**
 * Load the OpenSpec state from disk
 */
export async function loadState(): Promise<OpenSpecState> {
  try {
    const content = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // State file doesn't exist, return default
      console.error(`[OpenSpec] State file not found at: ${STATE_FILE}`);
      return getDefaultState();
    }
    // Log error for debugging
    console.error(`[OpenSpec] Failed to load state from ${STATE_FILE}: ${error.message}`);
    console.error(`[OpenSpec] PROJECT_ROOT: ${PROJECT_ROOT}`);
    return getDefaultState();
  }
}

/**
 * Save the OpenSpec state to disk (atomic operation)
 */
export async function saveState(state: OpenSpecState): Promise<void> {
  try {
    // Ensure state directory exists
    const stateDir = path.dirname(STATE_FILE);
    await fs.mkdir(stateDir, { recursive: true });

    // Write atomically using temp file + rename
    const tempFile = `${STATE_FILE}.tmp.${Date.now()}`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tempFile, STATE_FILE);
  } catch (error: any) {
    throw new Error(`Failed to save state: ${error.message}`);
  }
}

/**
 * Get default initial state
 */
export function getDefaultState(): OpenSpecState {
  return {
    mode: 'discussion',
    active_changes: [],
    proposal_keywords: ['propose'],
    implementation_keywords: ['apply', 'init'],
    pause_keywords: ['pause'],
    archive_keywords: ['archive', 'done', 'cancel'],
    review_agents_enabled: true,
    worklog_enabled: true,
  };
}

/**
 * Find active change for current git branch
 */
export function findActiveChangeForBranch(
  state: OpenSpecState,
  branch: string
): ActiveChange | null {
  return state.active_changes.find((c) => c.branch === branch) || null;
}

/**
 * Add or update an active change in state
 */
export async function upsertActiveChange(
  activeChange: ActiveChange
): Promise<void> {
  const state = await loadState();
  const index = state.active_changes.findIndex(
    (c) => c.changeId === activeChange.changeId
  );

  if (index >= 0) {
    state.active_changes[index] = activeChange;
  } else {
    state.active_changes.push(activeChange);
  }

  await saveState(state);
}

/**
 * Remove an active change from state
 */
export async function removeActiveChange(changeId: string): Promise<void> {
  const state = await loadState();
  state.active_changes = state.active_changes.filter(
    (c) => c.changeId !== changeId
  );
  await saveState(state);
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Execute git command and return output
 */
function execGit(command: string): string {
  try {
    return execSync(`git ${command}`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: any) {
    throw new Error(`Git command failed: git ${command}\n${error.message}`);
  }
}

/**
 * Get current git branch name
 * Handles both repos with commits and repos without commits (no HEAD yet)
 */
export function getCurrentBranch(): string {
  try {
    // Try standard method first (works for repos with commits)
    return execGit('rev-parse --abbrev-ref HEAD');
  } catch (error: any) {
    // If that fails, try symbolic-ref (works for repos without commits)
    try {
      return execGit('symbolic-ref --short HEAD');
    } catch (fallbackError: any) {
      // Log both errors for debugging
      console.error(`[OpenSpec] Failed to get current branch`);
      console.error(`[OpenSpec] First attempt: ${error.message}`);
      console.error(`[OpenSpec] Fallback attempt: ${fallbackError.message}`);
      console.error(`[OpenSpec] PROJECT_ROOT: ${PROJECT_ROOT}`);
      console.error(`[OpenSpec] cwd: ${process.cwd()}`);
      console.error(`[OpenSpec] CLAUDE_PROJECT_DIR: ${process.env.CLAUDE_PROJECT_DIR || 'not set'}`);
      return 'unknown';
    }
  }
}

/**
 * Check if a branch exists
 */
export function branchExists(branchName: string): boolean {
  try {
    execGit(`rev-parse --verify ${branchName}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new git branch
 */
export function createBranch(branchName: string): void {
  execGit(`checkout -b ${branchName}`);
}

/**
 * Switch to an existing branch
 */
export function checkoutBranch(branchName: string): void {
  execGit(`checkout ${branchName}`);
}

/**
 * Merge a branch into the current branch
 */
export function mergeBranch(branchName: string): void {
  execGit(`merge ${branchName} --no-ff`);
}

/**
 * Delete a branch
 */
export function deleteBranch(branchName: string): void {
  execGit(`branch -d ${branchName}`);
}

/**
 * Get list of changed files (staged + unstaged)
 */
export function getChangedFiles(): string[] {
  try {
    const staged = execGit('diff --cached --name-only');
    const unstaged = execGit('diff --name-only');
    const combined = [...staged.split('\n'), ...unstaged.split('\n')]
      .filter(Boolean)
      .filter((f) => f.trim() !== '');
    return Array.from(new Set(combined));
  } catch {
    return [];
  }
}

/**
 * Get files changed between current branch and main
 */
export function getChangedFilesFromMain(): string[] {
  try {
    const mainBranch = getMainBranchName();
    const output = execGit(`diff ${mainBranch}...HEAD --name-only`);
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the main branch name (main or master)
 */
export function getMainBranchName(): string {
  try {
    if (branchExists('main')) return 'main';
    if (branchExists('master')) return 'master';
    return 'main'; // Default assumption
  } catch {
    return 'main';
  }
}

/**
 * Get upstream tracking info (ahead/behind counts)
 */
export function getUpstreamTracking(): { ahead: number; behind: number } | null {
  try {
    const ahead = parseInt(execGit('rev-list --count @{u}..HEAD'), 10);
    const behind = parseInt(execGit('rev-list --count HEAD..@{u}'), 10);
    return { ahead, behind };
  } catch {
    return null; // No upstream tracking
  }
}

/**
 * Check if HEAD is detached
 */
export function isDetachedHead(): boolean {
  const branch = getCurrentBranch();
  return branch === 'HEAD';
}

/**
 * Get short commit hash (for detached HEAD display)
 */
export function getShortCommitHash(): string {
  try {
    return execGit('rev-parse --short HEAD');
  } catch {
    return 'unknown';
  }
}

// ============================================================================
// Change File Operations
// ============================================================================

/**
 * Find a change by ID (exact or fuzzy match)
 */
export async function findChange(changeId: string): Promise<Change | null> {
  try {
    // Check if changes directory exists
    const exists = fsSync.existsSync(CHANGES_DIR);
    if (!exists) {
      return null;
    }

    const entries = await fs.readdir(CHANGES_DIR, { withFileTypes: true });
    const directories = entries.filter((e) => e.isDirectory() && e.name !== 'archive');

    // Try exact match first
    const exactMatch = directories.find((d) => d.name === changeId);
    if (exactMatch) {
      return buildChangeObject(exactMatch.name);
    }

    // Try fuzzy match (contains)
    const fuzzyMatches = directories.filter((d) =>
      d.name.toLowerCase().includes(changeId.toLowerCase())
    );
    if (fuzzyMatches.length === 1) {
      return buildChangeObject(fuzzyMatches[0].name);
    }

    // Multiple matches or no matches
    return null;
  } catch (error: any) {
    throw new Error(`Failed to find change: ${error.message}`);
  }
}

/**
 * Build a Change object from change directory name
 */
function buildChangeObject(changeName: string): Change {
  const changePath = path.join(CHANGES_DIR, changeName);
  const proposalPath = path.join(changePath, 'proposal.md');
  const tasksMdPath = path.join(changePath, 'tasks.md');
  const worklogPath = path.join(changePath, 'worklog.md');

  return {
    id: changeName,
    path: changePath,
    proposalPath,
    tasksMdPath,
    worklogPath,
    exists: fsSync.existsSync(changePath),
  };
}

/**
 * List all changes (excluding archive)
 */
export async function listChanges(): Promise<Change[]> {
  try {
    const exists = fsSync.existsSync(CHANGES_DIR);
    if (!exists) {
      return [];
    }

    const entries = await fs.readdir(CHANGES_DIR, { withFileTypes: true });
    const directories = entries.filter((e) => e.isDirectory() && e.name !== 'archive');

    return directories.map((d) => buildChangeObject(d.name));
  } catch (error: any) {
    throw new Error(`Failed to list changes: ${error.message}`);
  }
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch (error: any) {
    throw new Error(`Failed to calculate hash for ${filePath}: ${error.message}`);
  }
}

// ============================================================================
// tasks.md Parser
// ============================================================================

/**
 * Parse tasks from tasks.md file
 */
export async function parseTasksMd(tasksMdPath: string): Promise<Task[]> {
  try {
    const content = await fs.readFile(tasksMdPath, 'utf-8');
    return parseTasksFromContent(content);
  } catch (error: any) {
    throw new Error(`Failed to parse tasks.md: ${error.message}`);
  }
}

/**
 * Parse tasks from markdown content
 */
export function parseTasksFromContent(content: string): Task[] {
  const lines = content.split('\n');
  const tasks: Task[] = [];

  lines.forEach((line, index) => {
    // Match markdown checkbox: - [ ] or - [x] or - [X]
    const match = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.+)$/);
    if (match) {
      const completed = match[2].toLowerCase() === 'x';
      const taskContent = match[3].trim();
      tasks.push({
        content: taskContent,
        completed,
        line: index + 1,
      });
    }
  });

  return tasks;
}

/**
 * Extract file paths mentioned in tasks.md content
 * Looks for file paths in task descriptions
 */
export function extractAffectedFilesFromTasks(tasks: Task[]): string[] {
  const filePaths: Set<string> = new Set();

  // Common file path patterns
  const patterns = [
    /`([^`]+\.(ts|js|tsx|jsx|md|json|yaml|yml|css|scss|html))`/g, // `path/to/file.ext`
    /\b(src\/[^\s`]+\.(ts|js|tsx|jsx))/g, // src/path/to/file.ext
    /\b(test\/[^\s`]+\.(ts|js|tsx|jsx))/g, // test/path/to/file.ext
    /\b([a-zA-Z0-9_-]+\/[^\s`]+\.(ts|js|tsx|jsx|md|json))/g, // any/path/to/file.ext
  ];

  tasks.forEach((task) => {
    patterns.forEach((pattern) => {
      const matches = task.content.matchAll(pattern);
      for (const match of matches) {
        filePaths.add(match[1]);
      }
    });
  });

  return Array.from(filePaths);
}

// ============================================================================
// Todo Comparison
// ============================================================================

/**
 * Compare approved plan (from tasks.md) with current todos
 * Returns a diff showing what changed
 */
export function compareApprovedPlan(
  approved: Task[],
  current: Task[]
): TodoDiff {
  const diff: TodoDiff = {
    added: [],
    removed: [],
    modified: [],
    unchanged: [],
  };

  // Normalize for comparison (ignore completed status for matching)
  const approvedMap = new Map(approved.map((t) => [normalizeTaskContent(t.content), t]));
  const currentMap = new Map(current.map((t) => [normalizeTaskContent(t.content), t]));

  // Find removed tasks
  approved.forEach((task) => {
    const normalized = normalizeTaskContent(task.content);
    if (!currentMap.has(normalized)) {
      diff.removed.push(task);
    }
  });

  // Find added and modified tasks
  current.forEach((task) => {
    const normalized = normalizeTaskContent(task.content);
    const approvedTask = approvedMap.get(normalized);

    if (!approvedTask) {
      // New task not in approved plan
      diff.added.push(task);
    } else if (approvedTask.completed !== task.completed) {
      // Task exists but completion status changed
      diff.modified.push({ old: approvedTask, new: task });
    } else {
      // Task unchanged
      diff.unchanged.push(task);
    }
  });

  return diff;
}

/**
 * Normalize task content for comparison
 */
function normalizeTaskContent(content: string): string {
  return content.toLowerCase().trim();
}

/**
 * Format a TodoDiff as a human-readable string
 */
export function formatTodoDiff(diff: TodoDiff): string {
  const lines: string[] = [];

  if (diff.removed.length > 0) {
    lines.push('**Removed Tasks:**');
    diff.removed.forEach((task) => {
      lines.push(`  - ${task.content}`);
    });
    lines.push('');
  }

  if (diff.added.length > 0) {
    lines.push('**Added Tasks:**');
    diff.added.forEach((task) => {
      lines.push(`  + ${task.content}`);
    });
    lines.push('');
  }

  if (diff.modified.length > 0) {
    lines.push('**Modified Tasks:**');
    diff.modified.forEach(({ old, new: newTask }) => {
      const oldStatus = old.completed ? '[x]' : '[ ]';
      const newStatus = newTask.completed ? '[x]' : '[ ]';
      lines.push(`  ${oldStatus} → ${newStatus}: ${newTask.content}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate branch name from change ID
 */
export function generateBranchName(changeId: string): string {
  return `feature/${changeId}`;
}

/**
 * Check if file is in list of affected files
 */
export function isFileAffected(filePath: string, affectedFiles: string[]): boolean {
  // Normalize paths for comparison
  const normalizedPath = filePath.replace(/\\/g, '/');
  return affectedFiles.some((affected) => {
    const normalizedAffected = affected.replace(/\\/g, '/');
    return (
      normalizedPath === normalizedAffected ||
      normalizedPath.endsWith(`/${normalizedAffected}`)
    );
  });
}

/**
 * Count completed tasks
 */
export function countCompletedTasks(tasks: Task[]): { completed: number; total: number } {
  const completed = tasks.filter((t) => t.completed).length;
  return { completed, total: tasks.length };
}

/**
 * Check if all tasks are complete
 */
export function areAllTasksComplete(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.completed);
}
