# Claude Code Approval Hooks

This document provides comprehensive documentation for the OpenSpec Claude Code approval hooks system.

## Overview

The Claude Code approval hooks provide an optional workflow enforcement layer that prevents scope creep, enables keyword-driven workflows, preserves context across sessions, and ensures quality through automated reviews.

## Table of Contents

- [Installation](#installation)
- [Hook Architecture](#hook-architecture)
- [Hook Scripts Reference](#hook-scripts-reference)
- [State Management](#state-management)
- [Workflow Details](#workflow-details)
- [Slash Commands](#slash-commands)
- [Troubleshooting](#troubleshooting)
- [Advanced Configuration](#advanced-configuration)

## Installation

Hooks are installed during `openspec init` when you select Claude Code:

```bash
openspec init
# Select Claude Code
# Choose "Yes, install approval hooks"
# Choose "Yes, install statusline" (optional)
```

This creates:
- `openspec/hooks/` - Hook scripts
- `openspec/agents/` - Agent prompts for reviews
- `openspec/state/openspec-state.json` - Workflow state (gitignored)
- `.claude/settings.json` - Hook configuration (gitignored)
- `.claude/settings.json.example` - Team reference (committed)

## Hook Architecture

The hook system consists of 8 hook scripts that integrate with Claude Code's hook lifecycle:

```
User Input → UserPromptSubmit Hook → Claude Processing → PreToolUse Hook → Tool Execution → PostToolUse Hook
                    ↓                                              ↓                             ↓
              Keyword Detection                            File/TodoWrite Blocking         TodoWrite Sync
              Slash Command Trigger                        Plan Protection                 Archive Suggestions
```

### Hook Lifecycle

1. **SessionStart** - Loads state, displays context when Claude starts
2. **UserPromptSubmit** - Detects keywords (`propose:`, `apply:`, `pause:`, `archive`)
3. **PreToolUse** - Blocks unauthorized file/TodoWrite changes during implementation
4. **PostToolUse** - Syncs TodoWrite with tasks.md, suggests archive when complete
5. **Statusline** - Custom statusline showing mode, progress, git state (optional)

## Hook Scripts Reference

### 1. `shared-state.js`

**Purpose:** Common state management and utilities used by all other hooks.

**Functions:**
- Load/save state from `openspec/state/openspec-state.json`
- Parse `tasks.md` into structured todo items
- Git operations (branch info, status checks)
- Hash calculation for change detection

**No user-facing behavior** - Library for other hooks.

---

### 2. `user-messages.js`

**Hook Type:** `UserPromptSubmit`
**Trigger:** Every user message

**Purpose:** Detects workflow keywords and injects context to trigger slash commands or workflows.

**Keywords Detected:**

| Keyword | Pattern | Action |
|---------|---------|--------|
| `propose:` | `propose: <description>` | Triggers `/openspec:proposal` slash command |
| `apply:` | `apply: <change-id>` | Triggers `/openspec:apply` slash command |
| `pause:` | `pause: <note>` | Triggers worklog generation |
| `archive` | `archive` | Triggers review agents + archive workflow |

**Example:**
```text
User: propose: add user authentication
Hook: Injects context → Claude runs /openspec:proposal
```

**State Updates:**
- Tracks last keyword detected
- Updates active_changes when apply: is used

---

### 3. `openspec-enforce.js`

**Hook Type:** `PreToolUse`
**Matcher:** `Write|Edit|MultiEdit|TodoWrite|NotebookEdit`
**Trigger:** Before any file modification or todo changes

**Purpose:** DAIC (Discussion-Apply-Implement-Complete) mode enforcement.

**Behavior:**

#### Discussion Mode
- **Allows:** All file operations
- **Use case:** Exploring code, discussing changes, creating proposals

#### Implementation Mode (after `apply:`)
- **Blocks:** File changes outside active change directory
- **Blocks:** TodoWrite changes that don't match approved tasks.md
- **Allows:** Changes within `openspec/changes/<active-change-id>/`
- **Allows:** TodoWrite updates that match approved todos from tasks.md

**Example Block Message:**
```
🚫 BLOCKED: Cannot edit src/auth.ts

You are in IMPLEMENTATION mode for change: add-user-authentication

Approved plan in openspec/changes/add-user-authentication/tasks.md
does not authorize changes to this file.

To modify files outside the approved scope:
1. Update tasks.md to include this file
2. Get user approval for the scope change
3. Proceed with implementation
```

**Configuration:** Edit `openspec/state/openspec-state.json` to customize blocking behavior.

---

### 4. `post-tool-use.js`

**Hook Type:** `PostToolUse`
**Trigger:** After every tool use

**Purpose:** Maintain sync between Claude's TodoWrite and approved tasks.md, suggest archive when complete.

**Behaviors:**

1. **TodoWrite Sync Check**
   - Compares Claude's TodoWrite items against approved tasks.md
   - Warns if Claude's todos deviate from approved plan
   - Suggests user review if mismatch detected

2. **Archive Suggestion**
   - Monitors todo completion progress
   - When all approved todos are marked complete: suggests `archive`

**Example Output:**
```
✅ All approved todos completed!

Consider running: archive
This will trigger code review, documentation review, and merge the branch.
```

---

### 5. `session-start.js`

**Hook Type:** `SessionStart`
**Matcher:** `startup|clear`
**Trigger:** Claude Code starts or after `/clear`

**Purpose:** Display current state and context to Claude.

**Displays:**
- Current mode (Discussion / Implementation)
- Active changes with branch info
- Approved todos from tasks.md
- Recent worklog entries (if available)
- Git status

**Example Output:**
```
🔧 OpenSpec State

Mode: IMPLEMENTATION
Active Change: add-user-authentication
Branch: feature/add-user-authentication

Approved Todos (from tasks.md):
  ✅ 1. Create User model with email and password fields
  🔄 2. Implement JWT token generation
  ⏸️ 3. Add authentication middleware
  ⏸️ 4. Write unit tests for auth flow

Worklog: 2 entries (last: 2025-11-20 14:30)
```

---

### 6. `statusline.js`

**Hook Type:** `Statusline` (custom hook type)
**Trigger:** Continuous (updates status bar)

**Purpose:** Show OpenSpec mode, progress, and git state in Claude Code's status line.

**Format:**
```
[OpenSpec: Discussion] | [OpenSpec: Impl • add-auth • 2/4 ✓] main • 3 changes
```

**Components:**
- Mode indicator (Discussion / Implementation)
- Active change ID (shortened)
- Todo progress (completed / total)
- Current git branch
- Uncommitted changes count

**Configuration:** Installed when you select "Yes, install statusline" during init.

---

### 7. `review-agents.js`

**Hook Type:** None (invoked by user-messages.js)
**Trigger:** When user types `archive`

**Purpose:** Orchestrate pre-archive review workflow.

**Workflow:**

1. **Code Review Agent**
   - Analyzes code quality, security, patterns
   - Uses prompt: `openspec/agents/code-review.md`
   - Checks for common issues, anti-patterns, vulnerabilities

2. **Documentation Review Agent**
   - Ensures documentation is up-to-date
   - Uses prompt: `openspec/agents/documentation.md`
   - Verifies README, comments, API docs match implementation

3. **Worklog Generation**
   - Extracts session context into structured worklog
   - Uses prompt: `openspec/agents/worklog-generator.md`
   - Preserves decisions, discoveries, gotchas

4. **Results Summary**
   - Presents all review findings to user
   - Asks for approval to proceed with merge
   - User can: approve, fix issues, skip reviews

**Example:**
```text
User: archive

🔍 Running pre-archive reviews...

CODE REVIEW:
  ✅ No security issues found
  ⚠️ Consider adding error handling in auth.ts:42
  ✅ Follows project conventions

DOCUMENTATION REVIEW:
  ⚠️ README.md needs update for new auth endpoints
  ✅ Inline comments are comprehensive

WORKLOG GENERATED:
  📝 3 key decisions documented
  📝 2 implementation gotchas noted

Proceed with merge? (yes/no/fix)
```

---

### 8. `worklog-generator.js`

**Hook Type:** None (invoked by review-agents.js or pause:)
**Trigger:** `pause:` keyword or before archive

**Purpose:** Generate structured worklog entries preserving session context.

**Captures:**
- Accomplishments in current session
- Key decisions made and rationale
- Implementation discoveries
- Gotchas and workarounds
- Next steps

**Output Location:** `openspec/changes/<change-id>/worklog.md`

**Example Entry:**
```markdown
## Session: 2025-11-20 14:30

### Accomplishments
- Implemented JWT token generation using jsonwebtoken library
- Added User model with password hashing (bcrypt)
- Created authentication middleware for Express routes

### Key Decisions
- **Decision:** Use bcrypt over alternatives
  **Rationale:** Better security, widely adopted, good performance

### Implementation Discoveries
- Express middleware order matters - auth must come before routes
- JWT secret must be in environment variable for production

### Gotchas
- bcrypt.compare() is async - must await or use callback
- JWT expiry time is in seconds, not milliseconds

### Next Steps
- Add unit tests for token generation
- Implement token refresh flow
- Add rate limiting to login endpoint
```

---

## State Management

All hook state is stored in `openspec/state/openspec-state.json` (gitignored).

### State File Structure

```json
{
  "mode": "discussion",
  "active_changes": [
    {
      "changeId": "add-user-authentication",
      "branch": "feature/add-user-authentication",
      "tasks_md_hash": "abc123...",
      "proposal_md_hash": "def456...",
      "approved_todos": [
        { "id": 1, "content": "Create User model", "completed": true },
        { "id": 2, "content": "Implement JWT generation", "completed": false }
      ],
      "last_worklog_update": "2025-11-20T14:30:00Z",
      "worklog_entries": 2
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

### State Transitions

```
                    propose:
   Discussion ──────────────────> Discussion (with proposal created)
                                           │
                    apply:                 │
                                           ▼
                                   Implementation
                                           │
                    archive                │
                                           ▼
   Discussion <────────────────── Discussion (change archived)
```

---

## Workflow Details

### Discussion Mode

**Purpose:** Explore code, discuss changes, create proposals

**Allowed Actions:**
- ✅ Read any files
- ✅ Create proposals with `propose:`
- ✅ Edit proposal/design/spec files
- ✅ Run searches, analyses
- ✅ Modify TodoWrite freely

**Not Allowed:**
- ❌ Modifying production code (outside proposals)

### Implementation Mode

**Triggered by:** `apply: <change-id>`

**Purpose:** Implement approved change following tasks.md plan

**Allowed Actions:**
- ✅ Modify files listed in tasks.md
- ✅ Create files within approved scope
- ✅ Update TodoWrite matching approved todos
- ✅ Read any files

**Not Allowed:**
- ❌ Modify files outside approved scope
- ❌ Add todos not in approved tasks.md
- ❌ Change unapproved files

**Scope Changes:**
If you need to modify additional files:
1. Update `tasks.md` to include new files/tasks
2. Discuss scope change with user
3. Get explicit approval
4. Continue implementation

### Checkpointing with `pause:`

**Purpose:** Preserve context when approaching token limits or switching tasks

**Usage:**
```text
pause: implemented JWT generation, next need to add middleware
```

**Actions:**
- Generates worklog entry with current session context
- Saves accomplishments, decisions, discoveries
- Preserves state for next session

**Use Cases:**
- Approaching token limit (Claude suggests this automatically)
- Switching to different task temporarily
- End of work session

### Archiving with `archive`

**Purpose:** Complete change and merge to main branch

**Workflow:**
1. Detect `archive` keyword
2. Run code review agent
3. Run documentation review agent
4. Generate final worklog entry
5. Present findings to user
6. If approved: merge branch, clean up
7. Return to Discussion mode

**Skip Reviews:**
```text
archive --skip-review
```

---

## Slash Commands

When hooks are installed, four slash commands are available:

### `/openspec:proposal`

**Purpose:** Create a new change proposal

**Usage:** Can be triggered by:
- Typing `/openspec:proposal` directly
- Using keyword: `propose: <description>`

**Behavior:**
- Creates `openspec/changes/<change-id>/` directory
- Generates `proposal.md`, `tasks.md`, `design.md`
- Updates spec deltas
- Stays in Discussion mode

---

### `/openspec:apply`

**Purpose:** Start implementing an approved change

**Usage:** Can be triggered by:
- Typing `/openspec:apply <change-id>`
- Using keyword: `apply: <change-id>`

**Behavior:**
- Switches to Implementation mode
- Creates feature branch: `feature/<change-id>`
- Locks approved plan from tasks.md
- Enables file blocking for out-of-scope changes

---

### `/openspec:pause`

**Purpose:** Checkpoint progress and preserve context

**Usage:** Can be triggered by:
- Typing `/openspec:pause`
- Using keyword: `pause: <note>`

**Behavior:**
- Generates worklog entry
- Captures accomplishments, decisions, discoveries
- Saves to `worklog.md`

**Note:** This command is ONLY available when hooks are installed (Claude Code exclusive).

---

### `/openspec:archive`

**Purpose:** Complete change and merge branch

**Usage:** Can be triggered by:
- Typing `/openspec:archive`
- Using keyword: `archive`

**Behavior:**
- Runs review agents (unless --skip-review)
- Presents findings
- If approved: merges branch, archives change
- Returns to Discussion mode

---

## Troubleshooting

### Hook Not Firing

**Symptom:** Keyword detected but hook doesn't run

**Solutions:**
1. Check `.claude/settings.json` exists and has correct paths
2. Verify hook scripts exist in `openspec/hooks/`
3. Restart Claude Code to reload settings
4. Check Node.js is installed and accessible

### File Blocking Issues

**Symptom:** Hook blocks files that should be allowed

**Solutions:**
1. Check `tasks.md` includes the file in approved scope
2. Verify you're in Implementation mode (not Discussion)
3. Update `approved_todos` in state file if tasks.md changed
4. Check `openspec/state/openspec-state.json` has correct changeId

### State Desync

**Symptom:** Hook state doesn't match actual project state

**Solutions:**
1. Manually edit `openspec/state/openspec-state.json`
2. Set `mode: "discussion"` to reset
3. Clear `active_changes: []` to start fresh
4. Re-run `apply:` to reinitialize

### Worklog Not Generated

**Symptom:** `pause:` doesn't create worklog entry

**Solutions:**
1. Check `openspec/agents/worklog-generator.md` exists
2. Verify `worklog_enabled: true` in state file
3. Ensure active change exists in state
4. Check Claude has access to read conversation history

---

## Advanced Configuration

### Customizing Keywords

Edit `openspec/state/openspec-state.json`:

```json
{
  "proposal_keywords": ["propose", "create-proposal", "new-change"],
  "implementation_keywords": ["apply", "init", "start-work"],
  "pause_keywords": ["pause", "checkpoint", "save-context"],
  "archive_keywords": ["archive", "done", "complete", "finish"]
}
```

### Disabling Review Agents

Edit state file:

```json
{
  "review_agents_enabled": false
}
```

Now `archive` will skip reviews and merge immediately.

### Disabling Worklog Generation

Edit state file:

```json
{
  "worklog_enabled": false
}
```

Now `pause:` will not generate worklog entries.

### Customizing Hook Behavior

Edit hook scripts in `openspec/hooks/`:

**Example:** Make file blocking more permissive

Edit `openspec-enforce.js`:

```javascript
// Find the isFileAllowed function
function isFileAllowed(filePath, activeChange) {
  // Add custom logic
  if (filePath.includes('test/')) {
    return true; // Always allow test file changes
  }

  // ... rest of existing logic
}
```

**Warning:** Modifying hooks can break workflow enforcement. Test thoroughly.

### Adding Custom Hooks

You can add additional hooks to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node $CLAUDE_PROJECT_DIR/openspec/hooks/user-messages.js" },
          { "type": "command", "command": "node $CLAUDE_PROJECT_DIR/custom-hooks/my-hook.js" }
        ]
      }
    ]
  }
}
```

---

## FAQ

**Q: Can I use OpenSpec without hooks?**
A: Yes! Hooks are completely optional. You can use slash commands and manual workflow without hooks.

**Q: Do hooks work with other AI tools?**
A: No, hooks are Claude Code-specific. Other tools (Cursor, Cline) only get slash commands.

**Q: Can I disable hooks temporarily?**
A: Yes, comment out hooks in `.claude/settings.json` or delete the file. Re-run `openspec init` to reinstall.

**Q: Are hooks safe? Do they send data anywhere?**
A: Hooks run locally, never send data externally. All state is stored in `openspec/state/`.

**Q: Can multiple developers use different hook configurations?**
A: Yes! `.claude/settings.json` is gitignored. Each developer can customize their own.

**Q: What if I accidentally commit restricted files?**
A: Hooks are preventive, not enforcement. They warn but don't prevent git operations. Use git hooks (pre-commit) for that.

---

## See Also

- [README.md](README.md) - OpenSpec overview
- [AGENTS.md](AGENTS.md) - AI agent instructions
- [openspec/AGENTS.md](openspec/AGENTS.md) - Detailed workflow
- `.claude/settings.json.example` - Hook configuration reference
