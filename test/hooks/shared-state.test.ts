import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  getDefaultState,
  parseTasksFromContent,
  extractAffectedFilesFromTasks,
  compareApprovedPlan,
  formatTodoDiff,
  generateBranchName,
  isFileAffected,
  countCompletedTasks,
  areAllTasksComplete,
} from '../../src/core/templates/hooks/shared-state.js';

describe('shared-state', () => {
  describe('getDefaultState', () => {
    it('should return default state with discussion mode', () => {
      const state = getDefaultState();
      expect(state.mode).toBe('discussion');
      expect(state.active_changes).toEqual([]);
      expect(state.review_agents_enabled).toBe(true);
      expect(state.worklog_enabled).toBe(true);
    });
  });

  describe('parseTasksFromContent', () => {
    it('should parse markdown checkboxes', () => {
      const content = `
# Tasks

- [ ] Implement feature A
- [x] Complete feature B
- [ ] Add tests
      `;

      const tasks = parseTasksFromContent(content);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].content).toBe('Implement feature A');
      expect(tasks[0].completed).toBe(false);
      expect(tasks[1].content).toBe('Complete feature B');
      expect(tasks[1].completed).toBe(true);
    });

    it('should handle empty content', () => {
      const tasks = parseTasksFromContent('');
      expect(tasks).toEqual([]);
    });

    it('should ignore non-checkbox lines', () => {
      const content = `
# Tasks
This is a paragraph.
- [ ] Task 1
Some text
- [x] Task 2
      `;

      const tasks = parseTasksFromContent(content);
      expect(tasks).toHaveLength(2);
    });
  });

  describe('extractAffectedFilesFromTasks', () => {
    it('should extract file paths from task descriptions', () => {
      const tasks = [
        { content: 'Update `src/auth/jwt.ts` with new logic', completed: false, line: 1 },
        { content: 'Add tests in `test/auth.test.ts`', completed: false, line: 2 },
        { content: 'Modify src/config.json', completed: false, line: 3 },
      ];

      const files = extractAffectedFilesFromTasks(tasks);
      expect(files).toContain('src/auth/jwt.ts');
      expect(files).toContain('test/auth.test.ts');
    });

    it('should handle tasks with no file paths', () => {
      const tasks = [
        { content: 'Review documentation', completed: false, line: 1 },
        { content: 'Update dependencies', completed: false, line: 2 },
      ];

      const files = extractAffectedFilesFromTasks(tasks);
      expect(files).toEqual([]);
    });
  });

  describe('compareApprovedPlan', () => {
    it('should detect added tasks', () => {
      const approved = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
      ];

      const current = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
        { content: 'Task 3', completed: false, line: 3 },
      ];

      const diff = compareApprovedPlan(approved, current);
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].content).toBe('Task 3');
      expect(diff.removed).toHaveLength(0);
    });

    it('should detect removed tasks', () => {
      const approved = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
        { content: 'Task 3', completed: false, line: 3 },
      ];

      const current = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
      ];

      const diff = compareApprovedPlan(approved, current);
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].content).toBe('Task 3');
      expect(diff.added).toHaveLength(0);
    });

    it('should detect modified completion status', () => {
      const approved = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
      ];

      const current = [
        { content: 'Task 1', completed: true, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
      ];

      const diff = compareApprovedPlan(approved, current);
      expect(diff.modified).toHaveLength(1);
      expect(diff.modified[0].new.completed).toBe(true);
      expect(diff.modified[0].old.completed).toBe(false);
    });

    it('should detect unchanged tasks', () => {
      const approved = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: true, line: 2 },
      ];

      const current = [
        { content: 'Task 1', completed: false, line: 1 },
        { content: 'Task 2', completed: true, line: 2 },
      ];

      const diff = compareApprovedPlan(approved, current);
      expect(diff.unchanged).toHaveLength(2);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });
  });

  describe('generateBranchName', () => {
    it('should generate feature branch name', () => {
      const branchName = generateBranchName('add-jwt-authentication');
      expect(branchName).toBe('feature/add-jwt-authentication');
    });
  });

  describe('isFileAffected', () => {
    it('should match exact file paths', () => {
      const affected = ['src/auth/jwt.ts', 'test/auth.test.ts'];
      expect(isFileAffected('src/auth/jwt.ts', affected)).toBe(true);
      expect(isFileAffected('src/other.ts', affected)).toBe(false);
    });

    it('should handle path normalization', () => {
      const affected = ['src/auth/jwt.ts'];
      expect(isFileAffected('src\\auth\\jwt.ts', affected)).toBe(true);
    });
  });

  describe('countCompletedTasks', () => {
    it('should count completed tasks', () => {
      const tasks = [
        { content: 'Task 1', completed: true, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
        { content: 'Task 3', completed: true, line: 3 },
      ];

      const result = countCompletedTasks(tasks);
      expect(result.completed).toBe(2);
      expect(result.total).toBe(3);
    });
  });

  describe('areAllTasksComplete', () => {
    it('should return true when all tasks complete', () => {
      const tasks = [
        { content: 'Task 1', completed: true, line: 1 },
        { content: 'Task 2', completed: true, line: 2 },
      ];

      expect(areAllTasksComplete(tasks)).toBe(true);
    });

    it('should return false when some tasks incomplete', () => {
      const tasks = [
        { content: 'Task 1', completed: true, line: 1 },
        { content: 'Task 2', completed: false, line: 2 },
      ];

      expect(areAllTasksComplete(tasks)).toBe(false);
    });

    it('should return false for empty task list', () => {
      expect(areAllTasksComplete([])).toBe(false);
    });
  });
});
