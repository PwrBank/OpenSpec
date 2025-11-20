# Integration Plan: cc-sessions Hooks → OpenSpec (REVISED)

## Overview
Add approval-based hooks from cc-sessions to OpenSpec, fully integrated into the existing `openspec init` workflow. Hooks are only installed if the user selects Claude Code as their AI tool.

**Key Design Decisions:**
- Keywords trigger existing `/openspec:*` slash commands (compatibility with OpenSpec workflow)
- Discussion mode only blocks files listed in `tasks.md` (allows typo fixes, config changes)
- TodoWrite syncs with `tasks.md` file (aligns with OpenSpec conventions)
- Branch naming: `feature/[change-id]` (standard git-flow convention)
- Multiple active changes supported (track array in state, validate per-branch)

## Integration with Existing Init Flow

**Current Flow:**
```typescript
// src/core/init.ts execute() method
1. Validate & detect extend mode
2. Get existing tool states
3. Render banner
4. Prompt for AI tools (Claude, Cursor, Cline, etc.)
5. Create directory structure
6. Configure AI tools (calls configureAITools)
7. Display success message
```

**Enhanced Flow (NEW - only if 'claude' selected):**
```typescript
// src/core/init.ts execute() method
1. Validate & detect extend mode
2. Get existing tool states
3. Render banner
4. Prompt for AI tools
5. ✨ IF 'claude' in selected tools:
   - Prompt: "Install Claude Code approval hooks?"
   - Prompt: "Install custom statusline?"
6. Create directory structure
7. ✨ Create hook directories if Claude selected
8. Configure AI tools
9. ✨ Configure Claude hooks if selected
10. Display success message
```

## Keyword-Driven Workflow

**Phase 1: Discussion** (No blocking)
- User and Claude discuss ideas freely
- No proposals created yet

**Phase 2: Proposal Creation** (Triggered by `"propose:"`)
- User: "propose: add user authentication"
- Hook injects context to run `/openspec:proposal` slash command
- Claude creates change in `openspec/changes/add-user-authentication/`
- Stays in discussion mode

**Phase 3: Implementation** (Triggered by `"apply:"` or `"init:"`)
- User: "apply: add-user-authentication"
- Hook injects context to run `/openspec:apply add-user-authentication`
- Hook confirms branch name (`feature/add-user-authentication`), creates branch, locks plan
- Claude can now implement

**Phase 4: Archive** (Triggered by `"archive"`)
- Runs `openspec archive <change-id> --yes` to update specs and move to archive/
- Merges branch, deletes it
- Returns to discussion mode

**Note**: Keywords trigger existing `/openspec:*` slash commands to maintain compatibility with OpenSpec workflow.

## Files To Create/Modify

### NEW Files:

**Hook Scripts (`openspec/hooks/`):**

1. **`openspec_enforce.js`** (~600 lines)
   - DAIC mode enforcement with tasks.md integration
   - Block Write/Edit/MultiEdit ONLY for files listed in active change's tasks.md
   - TodoWrite change detection (compare against tasks.md) with diff
   - Change file hash validation (proposal.md, tasks.md)
   - Git branch validation with user confirmation
   - Support for multiple active changes (validate based on current branch)

2. **`user_messages.js`** (~250 lines)
   - Detect "propose:", "apply:", "init:", "archive" keywords
   - Inject context to trigger `/openspec:*` slash commands
   - Change lookup by ID from `openspec/changes/` directory
   - Support multiple active changes workflow

3. **`post_tool_use.js`** (~150 lines)
   - Sync TodoWrite with tasks.md file after each use
   - Track todo completion by parsing tasks.md checkboxes
   - Auto-suggest archive when all tasks marked complete

4. **`shared_state.js`** (~400 lines)
   - State file read/write (atomic operations)
   - Git operations (branch create, checkout, merge, delete)
   - Change file operations (find by ID, hash calculation for proposal.md and tasks.md)
   - tasks.md parser (extract task list, compare with TodoWrite)
   - Todo comparison and diff generation
   - Multiple active changes tracking (array of active changes)

5. **`session_start.js`** (~80 lines)
   - Load current state on session start
   - Display mode and active proposal
   - List available proposals in discussion mode

6. **`statusline.js`** (~150 lines)
   - Show mode, proposal, branch, todo progress
   - Git tracking (ahead/behind)
   - Adapted from cc-sessions statusline

**Setup Module (`src/cli/setup-claude-hooks.ts`):**

```typescript
export interface ClaudeHookOptions {
  includeStatusline: boolean;
  projectRoot: string;
}

export async function setupClaudeHooks(options: ClaudeHookOptions): Promise<void> {
  const isWindows = process.platform === 'win32';

  // Create hook directories
  await FileSystemUtils.createDirectory(
    path.join(options.projectRoot, 'openspec', 'hooks')
  );
  await FileSystemUtils.createDirectory(
    path.join(options.projectRoot, 'openspec', 'state')
  );

  // Generate .claude/settings.json with proper paths
  const settings = generateClaudeSettings(isWindows, options.includeStatusline);

  await FileSystemUtils.createDirectory(
    path.join(options.projectRoot, '.claude')
  );
  await FileSystemUtils.writeFile(
    path.join(options.projectRoot, '.claude', 'settings.json'),
    JSON.stringify(settings, null, 2)
  );

  // Also create .claude/settings.json.example for reference
  await FileSystemUtils.writeFile(
    path.join(options.projectRoot, '.claude', 'settings.json.example'),
    JSON.stringify(settings, null, 2)
  );

  // Initialize state file
  const initialState = {
    mode: 'discussion',
    active_changes: [],  // Array of { changeId, branch, tasks_md_hash, proposal_md_hash, approved_todos }
    proposal_keywords: ['propose'],
    implementation_keywords: ['apply', 'init'],
    archive_keywords: ['archive', 'done', 'cancel']
  };

  await FileSystemUtils.writeFile(
    path.join(options.projectRoot, 'openspec', 'state', 'openspec-state.json'),
    JSON.stringify(initialState, null, 2)
  );
}

function generateClaudeSettings(isWindows: boolean, includeStatusline: boolean) {
  const pathPrefix = isWindows
    ? 'node "%CLAUDE_PROJECT_DIR%\\openspec\\hooks\\'
    : 'node $CLAUDE_PROJECT_DIR/openspec/hooks/';
  const pathSuffix = isWindows ? '.js"' : '.js';

  const settings: any = {
    hooks: {
      UserPromptSubmit: [{
        hooks: [{
          type: 'command',
          command: `${pathPrefix}user_messages${pathSuffix}`
        }]
      }],
      PreToolUse: [{
        matcher: 'Write|Edit|MultiEdit|TodoWrite|NotebookEdit',
        hooks: [{
          type: 'command',
          command: `${pathPrefix}openspec_enforce${pathSuffix}`
        }]
      }],
      PostToolUse: [{
        hooks: [{
          type: 'command',
          command: `${pathPrefix}post_tool_use${pathSuffix}`
        }]
      }],
      SessionStart: [{
        matcher: 'startup|clear',
        hooks: [{
          type: 'command',
          command: `${pathPrefix}session_start${pathSuffix}`
        }]
      }]
    }
  };

  if (includeStatusline) {
    settings.statusLine = {
      type: 'command',
      command: isWindows
        ? 'node "%CLAUDE_PROJECT_DIR%\\openspec\\hooks\\statusline.js"'
        : 'node $CLAUDE_PROJECT_DIR/openspec/hooks/statusline.js'
    };
  }

  return settings;
}
```

**State & Config:**

7. `openspec/state/openspec-state.json` (runtime, gitignored)
8. `.claude/settings.json` (local config, gitignored)
9. `.claude/settings.json.example` (template, committed)

### MODIFIED Files:

**1. `src/core/init.ts`**

Add import:
```typescript
import { setupClaudeHooks } from '../cli/setup-claude-hooks.js';
```

Modify `execute()` method (around line 398):
```typescript
async execute(targetPath: string): Promise<void> {
  // ... existing code ...

  const config = await this.getConfiguration(existingToolStates, extendMode);

  // ✨ NEW: Check if Claude Code was selected
  const claudeSelected = config.aiTools.includes('claude');
  let claudeHooksConfig: { install: boolean; statusline: boolean } | null = null;

  if (claudeSelected) {
    claudeHooksConfig = await this.promptClaudeHooksSetup();
  }

  // ... existing directory structure creation ...

  // Step 2: Configure AI tools
  const toolSpinner = this.startSpinner('Configuring AI tools...');
  const rootStubStatus = await this.configureAITools(
    projectPath,
    openspecDir,
    config.aiTools
  );

  // ✨ NEW: Configure Claude hooks if selected
  if (claudeSelected && claudeHooksConfig?.install) {
    await setupClaudeHooks({
      includeStatusline: claudeHooksConfig.statusline,
      projectRoot: projectPath
    });
  }

  toolSpinner.stopAndPersist({
    symbol: PALETTE.white('▌'),
    text: PALETTE.white('AI tools configured'),
  });

  // Success message
  this.displaySuccessMessage(
    selectedTools,
    created,
    refreshed,
    skippedExisting,
    skipped,
    extendMode,
    rootStubStatus,
    claudeHooksConfig  // ✨ Pass to success message
  );
}
```

Add new method:
```typescript
private async promptClaudeHooksSetup(): Promise<{ install: boolean; statusline: boolean }> {
  const installHooks = await this.prompt({
    extendMode: false,
    baseMessage: 'Install Claude Code approval hooks for safety?',
    choices: [
      {
        kind: 'info',
        value: '__info__',
        label: {
          primary: 'Hooks prevent Claude from making changes without approval keywords.'
        },
        selectable: false
      },
      {
        kind: 'option',
        value: 'yes',
        label: { primary: 'Yes, install approval hooks' },
        configured: false,
        selectable: true
      },
      {
        kind: 'option',
        value: 'no',
        label: { primary: 'No, skip hooks' },
        configured: false,
        selectable: true
      }
    ],
    initialSelected: ['yes']
  });

  if (!installHooks.includes('yes')) {
    return { install: false, statusline: false };
  }

  const installStatusline = await this.prompt({
    extendMode: false,
    baseMessage: 'Install custom Claude Code statusline?',
    choices: [
      {
        kind: 'info',
        value: '__info__',
        label: {
          primary: 'Shows OpenSpec mode, proposal, and todo progress in status bar.'
        },
        selectable: false
      },
      {
        kind: 'option',
        value: 'yes',
        label: { primary: 'Yes, install statusline' },
        configured: false,
        selectable: true
      },
      {
        kind: 'option',
        value: 'no',
        label: { primary: 'No, use default' },
        configured: false,
        selectable: true
      }
    ],
    initialSelected: ['yes']
  });

  return {
    install: true,
    statusline: installStatusline.includes('yes')
  };
}
```

Update `displaySuccessMessage()` signature:
```typescript
private displaySuccessMessage(
  // ... existing params ...
  claudeHooksConfig: { install: boolean; statusline: boolean } | null
): void {
  // ... existing success message code ...

  // ✨ NEW: Add Claude hooks info if installed
  if (claudeHooksConfig?.install) {
    console.log();
    console.log(PALETTE.white('Claude Code Approval Hooks Installed'));
    console.log(PALETTE.midGray('  Workflow keywords:'));
    console.log(PALETTE.midGray('    propose: [description] - Create new proposal'));
    console.log(PALETTE.midGray('    apply: [proposal-id]   - Start implementation'));
    console.log(PALETTE.midGray('    archive               - Complete and merge'));
    if (claudeHooksConfig.statusline) {
      console.log(PALETTE.midGray('  Custom statusline enabled'));
    }
  }

  // ... rest of success message ...
}
```

**2. `.gitignore`**

```diff
 # Claude
 .claude/
+!.claude/settings.json.example
 CLAUDE.md

+# OpenSpec state
+openspec/state/
```

**3. `README.md`**

Update installation section to mention hooks:
```markdown
### Installation

npm install -g openspec
openspec init

During init, if you select Claude Code:
- Option to install approval hooks (prevents changes without approval)
- Option to install custom statusline (shows mode and proposal)

The hooks use these keywords:
- `propose: [description]` - Create new proposal
- `apply: [proposal-id]` - Start implementation
- `archive` - Complete and merge
```

## Workflow Example

```bash
$ openspec init

# ... banner, intro ...

Step 2/3
Which natively supported AI tools do you use?
Use ↑/↓ to move · Space to toggle · Enter selects.

Natively supported providers:
 › ◉ Claude Code
   ○ Cline
   ○ Cursor
   # ... more tools ...

[User selects Claude Code, presses Enter]

Step 3/3
Review selections
Press Enter to confirm.

▌ Claude Code

[User presses Enter]

# ✨ NEW: Claude-specific prompts

Install Claude Code approval hooks for safety?
Hooks prevent Claude from making changes without approval keywords.

 › ◉ Yes, install approval hooks
   ○ No, skip hooks

[User selects Yes, presses Enter]

Install custom Claude Code statusline?
Shows OpenSpec mode, proposal, and todo progress.

 › ◉ Yes, install statusline
   ○ No, use default

[User selects Yes, presses Enter]

Creating OpenSpec structure...
▌ OpenSpec structure created

Configuring AI tools...
▌ AI tools configured

✔ OpenSpec initialized successfully!

Tool summary:
▌ Created: Claude Code

Claude Code Approval Hooks Installed
  Workflow keywords:
    propose: [description] - Create new proposal
    apply: [proposal-id]   - Start implementation
    archive               - Complete and merge
  Custom statusline enabled

# ... rest of success message ...
```

## Hook Behavior Example

```
# In Claude Code after init

Statusline: 💬 OpenSpec | Mode: Discussion [main]

User: "How should we handle authentication?"

Claude: [Discusses options freely - no files created]

User: "propose: add JWT authentication with refresh tokens"

Claude: [Runs /openspec:proposal command via hook injection]
        [Creates openspec/changes/add-jwt-authentication/proposal.md]
        [Creates openspec/changes/add-jwt-authentication/tasks.md]
        [Uses TodoWrite to track 5-step plan]

        ✓ Change created: add-jwt-authentication

        You can:
        - Continue discussing
        - Create more changes
        - Start implementation: "apply: add-jwt-authentication"

Statusline: 📋 OpenSpec | Change: add-jwt-authentication [main] | Discussion

User: "apply: add-jwt-authentication"

Hook: Loading change: add-jwt-authentication
      Generated branch name: "feature/add-jwt-authentication"

      ? Create git branch 'feature/add-jwt-authentication'?
        > Yes, create this branch
          Use custom name: feature/___________
          Skip (use current branch)

User: [Selects "Yes"]

Hook: ✓ Created branch: feature/add-jwt-authentication
      ✓ Locked approved plan (5 todos from tasks.md)
      ✓ Switched to implementation mode

Statusline: 📝 OpenSpec | Change: add-jwt-authentication [feature/add-jwt-authentication] | Implementation (0/5)

Claude: [Can now use Write/Edit/MultiEdit tools]
        [Implements changes following approved plan]
        [Tries to add 6th todo not in plan]

Hook: ⚠️ BLOCKED - TodoWrite change detected

      Original Approved Plan (5 todos):
      1. Create JWT middleware
      2. Add refresh token logic
      3. Create auth endpoints
      4. Add tests
      5. Update docs

      Attempted Change (6 todos):
      1. Create JWT middleware ✓
      2. Add refresh token logic ✓
      3. Create auth endpoints
      4. Add tests
      5. Update docs
      6. Add admin dashboard ← UNAUTHORIZED

      You attempted to expand scope. Acknowledge and either:
      - Continue with original 5-todo plan
      - Explain why change is needed and wait for approval

Claude: "I apologize for expanding scope. I'll continue with the original 5-todo plan."

# ... completes remaining todos ...

User: "archive"

Hook: Running OpenSpec archive process...
      $ openspec archive add-jwt-authentication --yes

      ✓ Moved changes/add-jwt-authentication → changes/archive/2025-01-20-add-jwt-authentication
      ✓ Updated specs in openspec/specs/
      ✓ Merged feature/add-jwt-authentication → main
      ✓ Deleted feature branch
      ✓ Returned to discussion mode

Statusline: 💬 OpenSpec | Mode: Discussion [main]
```

## Key Features

✅ **Conditionally Installed:**
- Only prompts for hooks if Claude Code selected
- Other AI tools unaffected

✅ **Fully Integrated:**
- Part of `openspec init` workflow
- No separate setup command needed

✅ **Keyword-Driven:**
- `propose:` - Create proposal without starting
- `apply:` / `init:` - Start implementation with branch confirmation
- `archive` / `done` / `cancel` - Complete and merge

✅ **Plan Protection:**
- TodoWrite change detection with diff
- Proposal file hash validation
- "SHAME RITUAL" blocking (from cc-sessions)

✅ **Git Automation:**
- Branch creation with user confirmation
- Branch name derived from proposal title
- Automatic merge on archive

✅ **Optional Statusline:**
- Shows mode, proposal, branch, todo progress
- Git ahead/behind indicators
- Adapted from cc-sessions

## State Machine

```
[Discussion Mode] ─propose:─> [Proposal Created] ─apply:/init:─> [Implementation Mode]
       ↑                             ↓                                    ↓
       └────────────────────────archive─────────────────────────────────┘
```

## Core Hook Logic Summary

### `openspec_enforce.js` (PreToolUse Hook)

**File Blocking Logic:**
- Detect current git branch
- Find active change for current branch in state
- If active change found:
  - Parse `changes/<id>/tasks.md` to extract affected files
  - BLOCK Write/Edit/MultiEdit ONLY for files listed in tasks.md
  - ALLOW edits to other files (typos, configs, docs, etc.)
- If no active change (discussion mode):
  - ALLOW all file edits

**TodoWrite Validation:**
- When TodoWrite is used:
  - Load active change's `tasks.md` file
  - Parse task list from tasks.md (looking for `- [ ]` and `- [x]` patterns)
  - Compare TodoWrite content against tasks.md
  - If mismatch: BLOCK with diff showing original (tasks.md) vs attempted (TodoWrite)

**Change File Protection:**
- Calculate hash of `proposal.md` and `tasks.md` when change starts
- Block edits to these files during implementation
- Exception: Allow if explicitly approved

**Branch Validation:**
- Verify current branch matches active change's expected branch
- Block operations if on wrong branch

### `user_messages.js` (UserPromptSubmit Hook)

**Keyword Detection:**
- `propose: [description]` → Inject context to trigger `/openspec:proposal` with description
- `apply: [change-id]` or `init: [change-id]` → Inject context to trigger `/openspec:apply [change-id]`
- `archive` / `done` / `cancel` → Inject context to trigger archive workflow

**Change Lookup:**
- Scan `openspec/changes/` directory for matching change ID
- Support exact match or fuzzy match by change ID
- Load change metadata (proposal.md, tasks.md paths)

**Branch Name Generation:**
- Extract change ID from directory name
- Generate branch name: `feature/[change-id]`
- Prompt user to confirm or customize

### `post_tool_use.js` (PostToolUse Hook)

**TodoWrite Sync:**
- After TodoWrite tool use:
  - If active change exists, sync TodoWrite content to state
  - Parse completion status from TodoWrite
  - Track progress (e.g., 3/5 complete)

**tasks.md Monitoring:**
- After file edits to tasks.md:
  - Parse checkbox status (`- [x]` vs `- [ ]`)
  - Update completion tracking
  - Detect when all tasks complete

**Archive Suggestion:**
- When all tasks marked `[x]` in tasks.md:
  - Display: "All tasks complete! Run 'archive' to complete this change."

### `session_start.js` (SessionStart Hook)

**State Loading:**
- Load `openspec/state/openspec-state.json`
- Detect current git branch
- Match branch to active change (if any)

**Context Display:**
- If active change: Show change ID, branch, progress
- If discussion mode: List available changes in `openspec/changes/`
- Show status of each change (not started, in progress, complete)

### `statusline.js` (Statusline Script)

**Information Gathering:**
- Read state file for active changes
- Get current git branch and match to change
- Count changes in `openspec/changes/` (excluding archive/)
- Get git ahead/behind status
- Parse transcript for context usage

**Output Format:**
```
[Change Info] | [Context Bar]
[Mode] | [Edited Files] | [Open Changes] | [Git Branch + Upstream]
```

### `shared_state.js` (Utility Module)

**State Operations:**
- Atomic read/write of openspec-state.json
- Track array of active changes
- Each change: `{ changeId, branch, tasks_md_hash, proposal_md_hash, approved_todos }`

**Git Operations:**
- Create branch: `git checkout -b feature/[change-id]`
- Merge branch: `git checkout main && git merge feature/[change-id]`
- Delete branch: `git branch -d feature/[change-id]`

**Change File Operations:**
- Find change in `openspec/changes/[id]/`
- Read and hash `proposal.md` and `tasks.md`
- Parse tasks.md for task list and affected files

**tasks.md Parser:**
- Extract tasks: Lines matching `- [ ]` or `- [x]` pattern
- Extract affected files: Parse task descriptions for file paths
- Compare TodoWrite against tasks.md tasks

**Archive Workflow:**
- Run: `openspec archive [change-id] --yes` via Bash
- Verify command success
- Update state to remove completed change
- Clean up git branch

## OpenSpec Statusline Design (Final)

### Layout Format (2 lines)

**Line 1:** Current proposal | Context usage bar (right-aligned)
**Line 2:** Mode (with todo progress) | Edited files | Open proposals | Git branch (with upstream)

### Examples with Nerd Fonts:

**Example 1: Discussion mode, no changes**
```
💬 No active change | 󱃖 ██████░░░░ 60.0% (96k/160k)
󰭹  Discussion | ✎ 0 | 📋 0 open | 󰘬 main
```

**Example 2: Discussion mode, 3 changes pending**
```
💬 No active change | 󱃖 ████████░░ 75.0% (120k/160k)
󰭹  Discussion | ✎ 2 | 📋 3 open | 󰘬 main
```

**Example 3: Implementation in progress, ahead of remote**
```
📝 add-jwt-authentication | 󱃖 ████████░░ 80.0% (128k/160k)
󰷫  Implementation (3/5) | ✎ 8 | 📋 2 open | 󰘬 feature/add-jwt-authentication (↑2)
```

**Example 4: Implementation - high context, ahead and behind**
```
📝 add-api-versioning | 󱃖 █████████░ 92.5% (148k/160k)
󰷫  Implementation (4/7) | ✎ 12 | 📋 5 open | 󰘬 feature/add-api-versioning (↑5 ↓2)
```

**Example 5: All todos complete, ready to archive**
```
✅ add-jwt-authentication | 󱃖 █████████░ 88.0% (140k/160k)
󰷫  Implementation (5/5) | ✎ 15 | 📋 1 open | 󰘬 feature/add-jwt-authentication (↑8)
```

**Example 6: Detached HEAD**
```
📝 refactor-core-services | 󱃖 ████████░░ 85.0% (136k/160k)
󰷫  Implementation (2/6) | ✎ 7 | 📋 4 open | 󰌺 @a3f82c
```

### Examples with Emoji (fallback):

**Implementation - high context**
```
📝 add-api-versioning |  █████████░ 92.5% (148k/160k)
🛠️ Implementation (4/7) | ✎ 12 | 📋 5 open | Branch: feature/add-api-versioning (↑5 ↓2)
```

### Examples with ASCII (fallback):

**Implementation - high context**
```
Change: add-api-versioning |  █████████░ 92.5% (148k/160k)
Mode: Implementation (4/7) | ✎ 12 | Changes: 5 open | Branch: feature/add-api-versioning (↑5 ↓2)
```

### Line 1 Components:

1. **Change State Icon + Identifier**
   - `💬 No active change` - Discussion mode, no active work
   - `📋 add-jwt-authentication` - Change created but not started
   - `📝 add-jwt-authentication` - Implementation in progress
   - `✅ add-jwt-authentication` - Implementation complete, ready to archive

2. **Context Usage Bar** (right-aligned)
   - Icon: `󱃖` (nerd fonts) or blank
   - Progress bar: `█████████░` (filled blocks in color, empty in gray)
   - Color coding:
     - Green (`\033[38;5;114m`): < 50%
     - Orange (`\033[38;5;215m`): 50-80%
     - Red (`\033[38;5;203m`): > 80%
   - Percentage: `92.5%`
   - Token counts: `(148k/160k)`

### Line 2 Components:

1. **Mode Indicator** (left)
   - Icon: `󰭹` (nerd fonts) or `💬` (emoji) for Discussion
   - Icon: `󰷫` (nerd fonts) or `🛠️` (emoji) for Implementation
   - Text: `Discussion` or `Implementation (4/7)`
   - Todo progress shown only during implementation

2. **Edited Files Count**
   - Icon: `✎`
   - Count of unstaged + staged changes
   - Color: Orange (`\033[38;5;215m`)

3. **Open Changes Count**
   - Icon: `📋` (universal)
   - Count of changes in `openspec/changes/` directory (excluding archive/)
   - Excludes current active change during implementation
   - Text: `5 open`

4. **Git Branch + Upstream Tracking** (right, grouped together)
   - Branch icon: `󰘬` (nerd fonts) or `Branch:` (emoji/ascii)
   - Branch name: `feature/add-api-versioning`
   - Upstream tracking in parentheses: `(↑5 ↓2)`
     - `↑5` = 5 commits ahead of remote
     - `↓2` = 2 commits behind remote
     - Only shown if remote tracking exists
     - Color: Orange (`\033[38;5;215m`)
   - Detached HEAD: `󰌺 @a3f82c` (shows short commit hash)

### Color Scheme (Ayu Dark):

- **Green** (`\033[38;5;114m`): Progress bar < 50%
- **Orange** (`\033[38;5;215m`): Progress bar 50-80%, edited files, upstream tracking
- **Red** (`\033[38;5;203m`): Progress bar > 80%
- **Light Gray** (`\033[38;5;250m`): Branch name, labels, context icon
- **Gray** (`\033[38;5;242m`): Empty progress blocks
- **Cyan** (`\033[38;5;111m`): Proposal identifier
- **Purple** (`\033[38;5;183m`): Mode text

### Implementation Notes:

1. **Open Changes Counter:**
   ```javascript
   const changesDir = path.join(projectRoot, 'openspec', 'changes');
   let openChangeCount = 0;

   if (fs.existsSync(changesDir)) {
     const entries = fs.readdirSync(changesDir, { withFileTypes: true });
     for (const entry of entries) {
       // Only count directories (each change is a directory)
       // Exclude 'archive' subdirectory
       if (entry.isDirectory() && entry.name !== 'archive') {
         openChangeCount++;
       }
     }
   }

   // Exclude current active change if in implementation
   const currentBranch = getCurrentGitBranch();
   const activeChange = state.active_changes.find(c => c.branch === currentBranch);
   if (activeChange) {
     openChangeCount = Math.max(0, openChangeCount - 1);
   }
   ```

2. **Upstream Tracking:**
   - Only shown if branch has remote tracking
   - Requires `git rev-list --count @{u}..HEAD` (ahead)
   - Requires `git rev-list --count HEAD..@{u}` (behind)
   - Formatted in parentheses after branch name
   - Gracefully handles errors (no upstream = no indicators)

3. **Windows Compatibility:**
   - Force UTF-8 encoding for stdout
   - Use absolute paths for git commands
   - Enable ANSI/VT100 mode on Windows 10+
   - Detect Windows Terminal and PowerShell 7+ for ANSI support

---

## Revisions from Original Plan

This plan has been revised based on analysis of OpenSpec's existing workflow to ensure compatibility:

### Critical Fixes Applied:

1. **✅ Directory Structure**: Changed `openspec/proposals/` → `openspec/changes/` throughout
   - Aligns with OpenSpec's actual directory structure
   - Changes are directories, not individual MD files

2. **✅ Change ID Format**: Removed numeric prefixes (`001-add-jwt-auth` → `add-jwt-authentication`)
   - OpenSpec uses verb-led kebab-case without numbers
   - Example: `add-jwt-authentication`, `refactor-core-services`

3. **✅ Archive Process**: Added `openspec archive <change-id> --yes` command execution
   - Archives move changes to `changes/archive/YYYY-MM-DD-[name]/`
   - Updates specs in `openspec/specs/` directory
   - Properly integrates with OpenSpec CLI

4. **✅ Slash Command Integration**: Keywords now trigger slash commands
   - `propose:` → injects context for `/openspec:proposal`
   - `apply:` → injects context for `/openspec:apply`
   - `archive` → triggers archive workflow
   - Maintains compatibility with existing OpenSpec workflow

### Design Decisions Implemented:

Based on user selections, the following design choices were made:

1. **Keyword/Slash Command Relationship**: Keywords trigger slash commands
   - Maintains existing OpenSpec workflow
   - Hooks inject context to run `/openspec:*` commands
   - Users can still use slash commands directly

2. **Discussion Mode Blocking**: Only block files in tasks.md
   - Reads active change's `tasks.md` file
   - Only blocks files mentioned in tasks
   - Allows edits to docs, configs, other files
   - Balances safety with flexibility

3. **TodoWrite Integration**: Syncs with tasks.md
   - Reads approved plan from `tasks.md` file
   - Compares TodoWrite against tasks.md content
   - Shows diff when mismatch detected
   - Aligns with OpenSpec's use of tasks.md

4. **Branch Naming**: `feature/[change-id]` convention
   - Standard git-flow pattern
   - Example: `feature/add-jwt-authentication`
   - Professional and clear

5. **Multiple Active Changes**: Supported
   - State tracks array of active changes
   - Each change has its own branch
   - Validates based on current git branch
   - Allows concurrent work on multiple changes

### State Structure:

```json
{
  "mode": "discussion",
  "active_changes": [
    {
      "changeId": "add-jwt-authentication",
      "branch": "feature/add-jwt-authentication",
      "tasks_md_hash": "abc123...",
      "proposal_md_hash": "def456...",
      "approved_todos": [...]
    }
  ],
  "proposal_keywords": ["propose"],
  "implementation_keywords": ["apply", "init"],
  "archive_keywords": ["archive", "done", "cancel"]
}
```

### Terminology Updates:

Throughout the plan:
- "Proposal" → "Change" (when referring to OpenSpec entities)
- "Proposal file" → "Change directory" or "proposal.md" (for clarity)
- "Open proposals count" → "Open changes count"
- Branch prefix: `proposal/` → `feature/`

### files.md Integration Points:

The hooks integrate with OpenSpec's existing files:
- `openspec/changes/[id]/proposal.md` - Why/what/impact
- `openspec/changes/[id]/tasks.md` - Implementation checklist
- `openspec/changes/[id]/design.md` - Technical decisions (optional)
- `openspec/changes/[id]/specs/[capability]/spec.md` - Spec deltas

### Workflow Compatibility:

The revised plan maintains full compatibility with:
- Existing `/openspec:proposal`, `/openspec:apply`, `/openspec:archive` slash commands
- `openspec list`, `openspec show`, `openspec validate` CLI commands
- OpenSpec's three-stage workflow (Creating, Implementing, Archiving)
- OpenSpec's AGENTS.md instructions and conventions

---

## Detailed Conflict Analysis

This section documents the conflicts found in the original plan and how they were resolved.

### Critical Conflicts (🔴 MUST FIX)

#### 1. Directory Structure Mismatch

**Conflict**: Original plan used `openspec/proposals/` but OpenSpec uses `openspec/changes/`

**Evidence:**
- AGENTS.md line 133: "changes/ - Proposals - what SHOULD change"
- init.ts creates: `openspec/changes/`, `openspec/changes/archive/`
- All existing changes are in `openspec/changes/add-*`, `openspec/changes/archive/`

**Impact**:
- Hooks wouldn't find any changes
- Statusline would always show "0 open"
- apply: keyword wouldn't work

**Resolution**: ✅ Fixed
- Changed all references from `openspec/proposals/` to `openspec/changes/`
- Updated counter logic to scan `changes/` directory excluding `archive/`

#### 2. Change ID Format Mismatch

**Conflict**: Original plan assumed `001-add-jwt-auth` but OpenSpec uses `add-jwt-authentication`

**Evidence:**
- AGENTS.md line 9: "Pick a unique change-id: kebab-case, verb-led (add-, update-, remove-, refactor-)"
- Existing changes: `add-antigravity-support`, `add-scaffold-command`
- No numeric prefixes in OpenSpec

**Impact**:
- Branch names would use incorrect format
- Fuzzy matching wouldn't work with real change IDs
- User confusion about ID format

**Resolution**: ✅ Fixed
- Removed all `001-`, `002-` numeric prefixes from examples
- Updated to kebab-case, verb-led format: `add-jwt-authentication`, `add-api-versioning`
- All examples now match OpenSpec conventions

#### 3. Archive Process Incomplete

**Conflict**: Original plan only handled git merge, but OpenSpec archive does much more

**Evidence from slash-command-templates.ts:**
```
3. Run `openspec archive <id> --yes` so the CLI moves the change
   and applies spec updates without prompts
4. Review the command output to confirm the target specs were updated
```

**Evidence from AGENTS.md Stage 3:**
```
- Move `changes/[name]/` → `changes/archive/YYYY-MM-DD-[name]/`
- Update `specs/` if capabilities changed
```

**Impact**:
- Specs wouldn't get updated
- Change wouldn't move to archive/ directory
- OpenSpec structure would become inconsistent

**Resolution**: ✅ Fixed
- Added `openspec archive <change-id> --yes` command execution to archive workflow
- Hook now runs the CLI command via Bash
- Verifies command success before proceeding
- Properly integrates with OpenSpec's archive process

#### 4. Slash Command Integration Gap

**Conflict**: Original plan created separate keyword system that duplicated slash commands

**Evidence:**
- Existing slash commands: `/openspec:proposal`, `/openspec:apply`, `/openspec:archive`
- Original plan had keywords doing similar things independently
- Potential for conflicting behavior

**Impact**:
- Two ways to do the same thing
- User confusion about which to use
- Potential workflow conflicts

**Resolution**: ✅ Fixed (based on user choice)
- Keywords now trigger existing slash commands
- `propose:` → injects context to run `/openspec:proposal`
- `apply:` → injects context to run `/openspec:apply`
- `archive` → triggers archive workflow using OpenSpec CLI
- Maintains compatibility with existing OpenSpec workflow

### Important Issues (🟡 SHOULD ADDRESS)

#### 5. TodoWrite Integration

**Issue**: Original plan assumed TodoWrite without considering OpenSpec's tasks.md workflow

**Evidence:**
- AGENTS.md mentions `tasks.md` checklist extensively
- No mention of TodoWrite tool in OpenSpec docs
- Slash commands reference `tasks.md`, not TodoWrite

**Impact**:
- Hooks might block TodoWrite unnecessarily
- Todo comparison logic wouldn't have proper source of truth
- Workflow mismatch with existing OpenSpec patterns

**Resolution**: ✅ Fixed (based on user choice)
- TodoWrite now syncs with tasks.md file
- Approved plan read from `tasks.md` (OpenSpec's existing format)
- TodoWrite compared against tasks.md content
- Shows diff when mismatch detected
- Aligns with OpenSpec's existing workflow

#### 6. Discussion Mode Blocking Too Restrictive

**Issue**: Original plan blocked ALL Write/Edit/MultiEdit during discussion mode

**Scenarios That Would Get Blocked:**
- Fixing typos in documentation
- Updating configuration files
- Making hotfixes for production bugs
- Working on multiple changes concurrently

**Impact**:
- Workflow too rigid
- Forces unnecessary proposals for trivial changes
- Frustrates users

**Resolution**: ✅ Fixed (based on user choice)
- Only blocks files listed in active change's tasks.md
- Reads tasks.md to extract affected files
- Allows editing unrelated files (docs, configs, etc.)
- Balances safety with flexibility

#### 7. Branch Naming Convention

**Issue**: Original plan suggested `proposal/add-jwt-authentication` without considering team conventions

**Evidence:**
- OpenSpec doesn't mandate specific branch naming
- Common patterns: feature/*, add-*, fix/*
- Original plan added `proposal/` prefix

**Impact**:
- Non-standard branch naming
- Potential conflicts with team conventions

**Resolution**: ✅ Fixed (based on user choice)
- Using `feature/[change-id]` convention
- Standard git-flow pattern
- Examples: `feature/add-jwt-authentication`, `feature/add-api-versioning`
- Professional and clear

#### 8. Multiple Changes Support

**Issue**: Original plan allowed creating multiple changes but only one active implementation

**Scenario:**
- User creates `add-jwt-auth`, `add-rate-limiting`, `refactor-api`
- Says "apply: add-jwt-auth"
- What if they want to work on `add-rate-limiting` concurrently?

**Impact**:
- Single-change limitation potentially too restrictive
- Doesn't support common workflows (backend + frontend changes)

**Resolution**: ✅ Fixed (based on user choice)
- Multiple active changes supported
- State tracks array of active changes
- Each change on its own branch
- Validates based on current git branch
- More flexible for large projects

### Enhancement Opportunities (🟢 NICE TO HAVE)

These enhancements could be added in future iterations:

1. **Configurable Keywords**
   - Allow users to customize keywords per project
   - Support alternative phrases: "plan:", "draft:", "start:", etc.

2. **Spec Update Validation**
   - Before archiving, verify specs were updated
   - Check if changes/<id>/specs/ has files
   - Ensure corresponding openspec/specs/ files were modified

3. **Resume Context Enhancement**
   - On session start, show more context:
     - Last modified time
     - Completed vs remaining tasks
     - Suggested next actions

4. **Validation Integration**
   - Run `openspec validate <id> --strict` before archive
   - Block archive if validation fails
   - Ensure quality before archiving

5. **Concurrent Developer Support**
   - Handle case where another developer archived a change
   - Detect missing changes in filesystem
   - Clear stale state automatically

6. **Comprehensive Error Handling**
   - Graceful handling of git command failures
   - Missing change files
   - Malformed proposal or tasks.md
   - Upstream tracking errors

7. **Windows Testing**
   - Ensure all paths work correctly on Windows
   - Test ANSI/VT100 mode enablement
   - Verify git operations
   - Test statusline display

## Implementation Phases

### Phase 1: Core Hook Scripts (Week 1)

**Files to Create:**
1. `openspec/hooks/shared_state.js`
   - State file operations
   - Git operations wrapper
   - tasks.md parser
   - Change file operations

2. `openspec/hooks/openspec_enforce.js`
   - File blocking logic (tasks.md integration)
   - TodoWrite validation
   - Change file protection
   - Branch validation

3. `openspec/hooks/user_messages.js`
   - Keyword detection
   - Slash command context injection
   - Change lookup
   - Branch name generation

4. `openspec/hooks/post_tool_use.js`
   - TodoWrite sync
   - tasks.md monitoring
   - Archive suggestion

5. `openspec/hooks/session_start.js`
   - State loading
   - Context display

6. `openspec/hooks/statusline.js`
   - Information gathering
   - Formatting and display

**Testing:**
- Unit test each hook independently
- Mock state file operations
- Test git operations (create, merge, delete branches)
- Test tasks.md parsing

### Phase 2: CLI Integration (Week 2)

**Files to Modify:**
1. `src/cli/setup-claude-hooks.ts` (new file)
   - Hook setup logic
   - Settings generation

2. `src/core/init.ts`
   - Add Claude-specific prompts
   - Call setupClaudeHooks
   - Display success message

3. `.gitignore`
   - Add exceptions for .claude/settings.json.example
   - Add openspec/state/ exclusion

**Testing:**
- Test `openspec init` with Claude selected
- Verify .claude/settings.json created correctly
- Test on Windows and macOS
- Verify state file initialization

### Phase 3: End-to-End Testing (Week 3)

**Test Scenarios:**
1. **Full Workflow:**
   - Discussion → propose → apply → implement → archive
   - Verify each transition works correctly

2. **Multiple Changes:**
   - Create multiple changes
   - Apply one, work on it
   - Switch branches, apply another
   - Verify state tracks both correctly

3. **Plan Protection:**
   - Create change, apply it
   - Try to modify TodoWrite (should block)
   - Try to edit tasks.md (should block)
   - Try to edit proposal.md (should block)

4. **File Blocking:**
   - During implementation, edit file in tasks.md (should block)
   - Edit file NOT in tasks.md (should allow)
   - Edit docs, configs (should allow)

5. **Archive Process:**
   - Complete all tasks
   - Run archive
   - Verify `openspec archive` command executed
   - Verify change moved to archive/
   - Verify specs updated (if applicable)

6. **Error Handling:**
   - Missing change files
   - Git command failures
   - Malformed tasks.md
   - No remote tracking

### Phase 4: Documentation & Polish (Week 4)

**Documentation:**
1. Update README.md with hooks info
2. Add workflow examples
3. Document keywords
4. Create troubleshooting guide

**Polish:**
1. Improve error messages
2. Add helpful hints
3. Optimize performance
4. Code cleanup and comments

## Success Criteria

The implementation will be considered successful when:

✅ **Workflow Integration:**
- Keywords trigger slash commands correctly
- Changes created in correct directory structure
- Branch naming follows conventions
- Archive process updates specs and moves files

✅ **Plan Protection:**
- TodoWrite changes blocked when they deviate from tasks.md
- tasks.md and proposal.md protected during implementation
- Diff shown when plan violation detected

✅ **File Blocking:**
- Only files in tasks.md blocked during implementation
- Other files editable (docs, configs, etc.)
- Clear error messages when blocked

✅ **Multiple Changes:**
- Can work on multiple changes concurrently
- State tracks all active changes
- Branch-based validation works correctly

✅ **Statusline:**
- Shows correct mode and change info
- Context usage bar accurate
- Git tracking (ahead/behind) works
- Open changes count correct

✅ **Compatibility:**
- Existing `/openspec:*` slash commands work
- `openspec list`, `show`, `validate`, `archive` commands work
- No breaking changes to existing workflow
- Works on Windows and macOS

## Next Steps

To implement this plan:

1. **Phase 1**: Create hook scripts with revised logic (estimated 1 week)
2. **Phase 2**: Integrate into `openspec init` command (estimated 1 week)
3. **Phase 3**: End-to-end testing (estimated 1 week)
4. **Phase 4**: Documentation and polish (estimated 1 week)

**Total Estimated Time**: 4 weeks

The plan is now aligned with OpenSpec's conventions, addresses all critical conflicts, incorporates user design decisions, and is ready for implementation.