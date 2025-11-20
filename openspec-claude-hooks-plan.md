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
- Creates empty `WORKLOG.md` in change directory
- Stays in discussion mode

**Phase 3: Implementation** (Triggered by `"apply:"` or `"init:"`)
- User: "apply: add-user-authentication"
- Hook injects context to run `/openspec:apply add-user-authentication`
- Hook confirms branch name (`feature/add-user-authentication`), creates branch, locks plan
- Claude can now implement

**Phase 4: Checkpoint** (Triggered by `"pause:"`)
- User: "pause: checkpoint current progress"
- Runs worklog generator agent to preserve context
- Creates/updates `openspec/changes/[id]/WORKLOG.md` with session summary
- Updates `tasks.md` with progress notes
- Stays in implementation mode (doesn't exit or archive)
- Useful when: switching tasks, context filling up, or stopping mid-work

**Phase 5: Archive** (Triggered by `"archive"` or `"archive --skip-review"`)
- **Review Gate** (unless `--skip-review` specified):
  1. Runs code review agent to check quality, patterns, potential bugs
  2. Runs documentation agent to verify README, docs, comments are updated
  3. **Runs worklog agent to create final session summary**
  4. Shows findings to user with options: "Fix now", "Archive anyway", "Create follow-up"
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

7. **`review_agents.js`** (~250 lines)
   - Code review agent invocation
   - Documentation review agent invocation
   - **Worklog agent invocation**
   - Results aggregation and formatting
   - User choice handling (fix/archive/follow-up)

8. **`worklog_generator.js`** (~200 lines)
   - Transcript reading and parsing
   - Extract accomplishments, decisions, discoveries
   - Extract problems/solutions and next steps
   - Generate timestamped WORKLOG.md entries
   - Update tasks.md with progress notes
   - Structured output format

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
    archive_keywords: ['archive', 'done', 'cancel'],
    review_agents_enabled: true  // Run code review and doc review before archive
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

**Change Files:**

9. `openspec/changes/[id]/WORKLOG.md` (session summaries, committed)

**State & Config:**

10. `openspec/state/openspec-state.json` (runtime, gitignored)
11. `.claude/settings.json` (local config, gitignored)
12. `.claude/settings.json.example` (template, committed)

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

Hook: Running review agents before archive...

      🔍 Code Review Agent
      ✓ Code quality: Good
      ✓ Patterns followed: OpenSpec conventions
      ⚠️ Test coverage: 73% (target: 80%)
      ℹ️  Suggestion: Add tests for error cases in JWT validation

      📚 Documentation Agent
      ✓ README updated with authentication setup
      ✓ API docs updated with new endpoints
      ⚠️ Missing: CHANGELOG entry for breaking changes
      ℹ️  Suggestion: Add authentication migration guide

      Review complete. Issues found:
      - Test coverage below target
      - Missing CHANGELOG entry

      ? How would you like to proceed?
        > Archive anyway (issues noted)
          Fix issues now
          Create follow-up change for fixes

User: [Selects "Archive anyway (issues noted)"]

Hook: User chose to archive with noted issues.
      Running OpenSpec archive process...
      $ openspec archive add-jwt-authentication --yes

      ✓ Moved changes/add-jwt-authentication → changes/archive/2025-01-20-add-jwt-authentication
      ✓ Updated specs in openspec/specs/
      ✓ Merged feature/add-jwt-authentication → main
      ✓ Deleted feature branch
      ✓ Returned to discussion mode

      📝 Review notes saved to changes/archive/2025-01-20-add-jwt-authentication/.review-notes.md

Statusline: 💬 OpenSpec | Mode: Discussion [main]
```

## Workflow Example: Using Pause for Context Preservation

```
# Mid-implementation, user needs to switch tasks

Statusline: 📝 OpenSpec | Change: add-jwt-authentication [feature/add-jwt-authentication] | Implementation (3/5)

Claude: [Just finished implementing refresh token logic]

User: "pause: switching to production hotfix, will resume tomorrow"

Hook: Running worklog generator...

      ✓ Analyzed 45 messages and 12 tool calls
      ✓ Extracted 3 accomplishments, 2 decisions, 1 discovery
      ✓ Updated openspec/changes/add-jwt-authentication/WORKLOG.md
      ✓ Updated tasks.md with progress notes

      📝 Worklog Summary:
      - Accomplishments: 3 items logged
      - Decisions: 2 items logged
      - Discoveries: 1 item logged
      - Next Steps: 2 items logged

      You can resume this change anytime with:
      "apply: add-jwt-authentication"

# Next day, user resumes work

User: [Opens new Claude Code session]

Hook: [SessionStart] Loading active change: add-jwt-authentication

      📋 Change: add-jwt-authentication
      Branch: feature/add-jwt-authentication
      Progress: 3/5 tasks complete

      📝 Recent Work (from WORKLOG.md):

      2025-01-20 14:30:
      ✓ Implemented JWT middleware and refresh token logic
      ✓ Created auth endpoints
      → Next: Add comprehensive tests for error cases

Claude: "Welcome back! You're working on add-jwt-authentication. Based on your worklog, you've completed the JWT middleware and refresh token logic. The next step is to add comprehensive tests for error cases. Should I proceed with that?"

User: "Yes, continue with the tests"

Claude: [Resumes with full context from WORKLOG.md and tasks.md]
```

## Workflow Example: Context Window Filling Up

```
Statusline: 📝 OpenSpec | Change: refactor-api-layer [feature/refactor-api] | Implementation (4/8)
Context: 92% full

Claude: "I notice our context window is at 92%. Would you like me to create a checkpoint before we continue? This will preserve all our work so we can start fresh."

User: "pause: before refactoring controller layer"

Hook: Running worklog generator...

      ✓ Worklog updated with 8 accomplishments
      ✓ Captured 4 architectural decisions
      ✓ Documented 3 discovered patterns
      ✓ Logged 2 problems and their solutions

      Context preserved! You can:
      - Continue in this session (context will be high)
      - Start a new session with "apply: refactor-api-layer"
        (WORKLOG.md will provide full context)

User: "/clear"

[New session starts]

User: "apply: refactor-api-layer"

Hook: [Loads change with complete WORKLOG.md context]

Claude: "Resuming refactor-api-layer. Based on your worklog, you've completed service layer refactoring and are ready to tackle the controller layer. The previous session identified that controllers have mixed concerns - I'll address that now."
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

✅ **Pre-Archive Review:**
- Code review agent checks quality, patterns, bugs
- Documentation agent verifies docs updated
- User can fix issues, archive anyway, or create follow-up
- Skip with `archive --skip-review`
- Review notes saved with archived changes

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
- `pause:` or `pause: [note]` → Inject context to trigger worklog generation
- `archive` → Inject context to trigger archive workflow WITH review agents
- `archive --skip-review` → Inject context to trigger archive workflow WITHOUT review agents
- `done` / `cancel` → Alias for `archive`

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
- **Display recent worklog entries (last 3-5 items) from WORKLOG.md**
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

### `worklog_generator.js` (Worklog Agent)

**Purpose:**
Create detailed session summaries that preserve context across sessions and enable seamless task resumption.

**Trigger Points:**
1. Manual: User says `pause:` or `pause: [note]`
2. Automatic: During archive review process (before showing review results)

**Process:**

1. **Read Conversation Transcript:**
   - Access full conversation history from current session
   - Parse messages, tool calls, and results
   - Identify significant events and changes

2. **Extract Key Information:**
   - **Accomplishments**: What was implemented or completed
     - Code files created/modified
     - Features added
     - Bugs fixed
   - **Decisions**: Technical choices made and rationale
     - Architecture decisions
     - Library/framework selections
     - Pattern choices
   - **Discoveries**: New information learned about the codebase
     - Hidden dependencies
     - Gotchas and edge cases
     - Existing patterns discovered
   - **Problems & Solutions**: Issues encountered and how they were resolved
     - Errors and their fixes
     - Blockers and workarounds
     - Testing challenges
   - **Next Steps**: What remains to be done
     - Uncompleted tasks
     - Follow-up items
     - Technical debt identified

3. **Generate WORKLOG Entry:**
   - Create timestamped section in `openspec/changes/[id]/WORKLOG.md`
   - Use structured markdown format (see below)
   - Include user note if provided (from `pause: [note]`)

4. **Update tasks.md:**
   - Add progress notes to relevant tasks
   - Update checkbox status if tasks completed
   - Add discovered subtasks if needed

**WORKLOG.md Format:**

```markdown
# Work Log: [change-id]

## 2025-01-20 14:30

### Accomplishments
- Implemented JWT middleware in `src/auth/jwt.ts`
- Added refresh token logic with 7-day expiry
- Created auth endpoints: `/auth/login`, `/auth/refresh`, `/auth/logout`

### Decisions
- **Using RS256 instead of HS256**: Better security with asymmetric keys, allows public verification
- **Refresh token rotation**: Each refresh generates new token, invalidates old one
- **Token storage**: HttpOnly cookies for web, Authorization header for API

### Discoveries
- Auth module has hidden dependency on session store in `src/session/store.ts`
- Existing rate limiter must be configured per endpoint (not global)
- User model already has `lastLogin` field we can populate

### Problems & Solutions
- **Problem**: Token expiry wasn't respecting timezone
  - **Solution**: Switched to UTC timestamps throughout, convert to local only for display
- **Problem**: Middleware order caused session conflicts
  - **Solution**: Moved JWT middleware before session middleware in `app.ts:45`

### Next Steps
- Add comprehensive tests for error cases (invalid tokens, expired, malformed)
- Update API documentation with authentication flow diagrams
- Add rate limiting to refresh endpoint to prevent abuse

---

## 2025-01-21 09:15

[Next session entry...]
```

**Output:**
- Returns success/failure status
- Includes path to updated WORKLOG.md
- Shows summary of extracted items (e.g., "Logged 5 accomplishments, 3 decisions, 2 discoveries")

**Error Handling:**
- Gracefully handle missing transcript
- Create WORKLOG.md if doesn't exist
- Append to existing log (never overwrite)
- Validate markdown formatting

### `review_agents.js` (Review Orchestration)

**Archive Review Workflow:**
When `archive` keyword detected (without `--skip-review` flag):

1. **Detect Changed Files:**
   - Run `git diff main..HEAD --name-only` to get all changed files
   - Categorize: code files, doc files, test files, config files

2. **Worklog Agent:**
   - Call `worklog_generator.js` to create final session summary
   - Updates `WORKLOG.md` with complete archive context
   - Returns worklog path and summary

3. **Code Review Agent:**
   - Use Task tool with `code-reviewer` agent type
   - Prompt: "Review the following code changes for quality, patterns, potential bugs, and test coverage"
   - Pass changed code files
   - Parse output for: ✓ passed checks, ⚠️ warnings, ℹ️ suggestions

4. **Documentation Agent:**
   - Use Task tool with specialized documentation review agent
   - Prompt: "Review if documentation is updated: README, CHANGELOG, API docs, comments"
   - Pass changed files and check for corresponding doc updates
   - Parse output for: ✓ updated docs, ⚠️ missing updates, ℹ️ suggestions

5. **Aggregate Results:**
   - Combine findings from both agents
   - Format output with emoji indicators
   - Count: passed, warnings, suggestions

6. **User Decision:**
   - If all ✓ (no warnings): Proceed to archive automatically
   - If warnings found: Use AskUserQuestion tool with options:
     - "Archive anyway (issues noted)" → Save .review-notes.md and proceed
     - "Fix issues now" → Return to implementation mode, keep change active
     - "Create follow-up change" → Archive this, create new change for fixes

7. **Save Review Notes:**
   - If archived with warnings, create `.review-notes.md` in archived change directory
   - Contains full agent reports (code review, docs review, worklog summary) for future reference
   - WORKLOG.md is always moved to archive with the change

**Skip Review:**
When `archive --skip-review` detected:
- Skip steps 1-6 entirely
- Proceed directly to archive workflow

### `shared_state.js` (Utility Module)

**State Operations:**
- Atomic read/write of openspec-state.json
- Track array of active changes
- Each change: `{ changeId, branch, tasks_md_hash, proposal_md_hash, approved_todos }`

**Git Operations:**
- Create branch: `git checkout -b feature/[change-id]`
- Merge branch: `git checkout main && git merge feature/[change-id]`
- Delete branch: `git branch -d feature/[change-id]`
- Get changed files: `git diff main..HEAD --name-only`

**Change File Operations:**
- Find change in `openspec/changes/[id]/`
- Read and hash `proposal.md` and `tasks.md`
- Parse tasks.md for task list and affected files

**tasks.md Parser:**
- Extract tasks: Lines matching `- [ ]` or `- [x]` pattern
- Extract affected files: Parse task descriptions for file paths
- Compare TodoWrite against tasks.md tasks

**Archive Workflow:**
- Call review_agents.js if review enabled
- Handle user decision from review
- Run: `openspec archive [change-id] --yes` via Bash
- Verify command success
- Save review notes if applicable
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
      "approved_todos": [...],
      "last_worklog_update": "2025-01-20T14:30:00Z",
      "worklog_entries": 3
    }
  ],
  "proposal_keywords": ["propose"],
  "implementation_keywords": ["apply", "init"],
  "pause_keywords": ["pause"],
  "archive_keywords": ["archive", "done", "cancel"],
  "review_agents_enabled": true,
  "worklog_enabled": true
}
```

**Notes**:
- `review_agents_enabled` controls whether code review and documentation agents run before archive. Can be bypassed per-archive with `archive --skip-review`.
- `worklog_enabled` controls whether worklog generation runs. If disabled, `pause:` keyword is ignored.
- `last_worklog_update` tracks when worklog was last generated (useful for session resumption)
- `worklog_entries` counts total entries in WORKLOG.md (displayed in statusline)

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

### Phase 1: Core Hook Scripts (Week 1-2)

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
   - Keyword detection (including --skip-review flag)
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

7. `openspec/hooks/review_agents.js`
   - Code review agent invocation
   - Documentation agent invocation
   - Results aggregation
   - User decision handling
   - Review notes generation

**Testing:**
- Unit test each hook independently
- Mock state file operations
- Test git operations (create, merge, delete branches)
- Test tasks.md parsing
- Test review agent invocations with mock responses
- Test user decision flow (fix/archive/follow-up)

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
   - Run archive (triggers review agents)
   - Verify code review agent runs
   - Verify documentation agent runs
   - Test user choices: fix, archive anyway, create follow-up
   - Verify .review-notes.md created when archiving with issues
   - Verify `openspec archive` command executed
   - Verify change moved to archive/
   - Verify specs updated (if applicable)

6. **Archive Skip Review:**
   - Run `archive --skip-review`
   - Verify review agents NOT invoked
   - Verify archive proceeds immediately
   - No review notes created

7. **Error Handling:**
   - Missing change files
   - Git command failures
   - Malformed tasks.md
   - No remote tracking
   - Review agent errors

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

✅ **Review Agents:**
- Code review agent runs before archive
- Documentation agent runs before archive
- **Worklog agent runs before archive**
- User can choose to fix, archive anyway, or create follow-up
- `archive --skip-review` bypasses review
- Review notes saved to `.review-notes.md` when issues found

✅ **Worklog/Pause Features:**
- `pause:` keyword triggers worklog generation
- WORKLOG.md created and updated with timestamped entries
- Extracts accomplishments, decisions, discoveries, problems/solutions, next steps
- Session start displays recent worklog entries
- Context preserved across sessions
- tasks.md updated with progress notes
- Seamless resumption after context clearing

✅ **Compatibility:**
- Existing `/openspec:*` slash commands work
- `openspec list`, `show`, `validate`, `archive` commands work
- No breaking changes to existing workflow
- Works on Windows and macOS

## Next Steps

To implement this plan:

1. **Phase 1**: Create hook scripts with revised logic (estimated 1-2 weeks)
   - Includes review_agents.js for code and documentation review
   - **Includes worklog_generator.js for session context preservation**
   - More complex due to agent invocation and user decision handling
   - Transcript parsing for worklog extraction
2. **Phase 2**: Integrate into `openspec init` command (estimated 1 week)
3. **Phase 3**: End-to-end testing (estimated 1-2 weeks)
   - Includes testing review agent workflows
   - **Test worklog generation and context resumption**
   - Test all user decision paths
   - Test `pause:` keyword and session restart scenarios
4. **Phase 4**: Documentation and polish (estimated 1 week)

**Total Estimated Time**: 4-6 weeks

The plan is now aligned with OpenSpec's conventions, addresses all critical conflicts, incorporates user design decisions (including pre-archive review agents and worklog/context preservation from cc-sessions), and is ready for implementation.

## Worklog/Pause Feature Summary

Inspired by cc-sessions' approach to context preservation, we're adding:

1. **Automatic Worklog Generation:**
   - Runs during archive process (with code/doc review)
   - Can be manually triggered with `pause:` keyword
   - Reads full conversation transcript
   - Extracts structured information

2. **WORKLOG.md Structure:**
   - Lives in each change directory: `openspec/changes/[id]/WORKLOG.md`
   - Timestamped sections with accomplishments, decisions, discoveries
   - Problems/solutions and next steps for easy resumption
   - Moved to archive with the change

3. **Context Preservation:**
   - Session start hook displays recent worklog entries
   - Enables seamless resumption across sessions
   - Solves context window filling up problem
   - Maintains project knowledge even after `/clear`

4. **Integration Points:**
   - `user_messages.js`: Detects `pause:` keyword
   - `worklog_generator.js`: New specialized agent (~200 lines)
   - `review_agents.js`: Calls worklog before showing review results
   - `session_start.js`: Displays worklog summary on resume
   - State tracking: `last_worklog_update`, `worklog_entries` fields

This ensures no context is lost when switching tasks, hitting token limits, or archiving changes.