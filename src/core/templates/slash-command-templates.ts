export type SlashCommandId = 'proposal' | 'apply' | 'archive' | 'pause';

const baseGuardrails = `**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when it is requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- Refer to \`openspec/AGENTS.md\` (located inside the \`openspec/\` directory—run \`ls openspec\` or \`openspec update\` if you don't see it) if you need additional OpenSpec conventions or clarifications.`;

const proposalGuardrails = `${baseGuardrails}\n- Identify any vague or ambiguous details and ask the necessary follow-up questions before editing files.
- Do not write any code during the proposal stage. Only create design documents (proposal.md, tasks.md, design.md, and spec deltas). Implementation happens in the apply stage after approval.`;

const proposalSteps = `**Steps**
1. Review \`openspec/project.md\`, run \`openspec list\` and \`openspec list --specs\`, and inspect related code or docs (e.g., via \`rg\`/\`ls\`) to ground the proposal in current behaviour; note any gaps that require clarification.
2. Choose a unique verb-led \`change-id\` and scaffold \`proposal.md\`, \`tasks.md\`, and \`design.md\` (when needed) under \`openspec/changes/<id>/\`.
3. Map the change into concrete capabilities or requirements, breaking multi-scope efforts into distinct spec deltas with clear relationships and sequencing.
4. Capture architectural reasoning in \`design.md\` when the solution spans multiple systems, introduces new patterns, or demands trade-off discussion before committing to specs.
5. Draft spec deltas in \`changes/<id>/specs/<capability>/spec.md\` (one folder per capability) using \`## ADDED|MODIFIED|REMOVED Requirements\` with at least one \`#### Scenario:\` per requirement and cross-reference related capabilities when relevant.
6. Draft \`tasks.md\` as an ordered list of small, verifiable work items that deliver user-visible progress, include validation (tests, tooling), and highlight dependencies or parallelizable work.
7. Validate with \`openspec validate <id> --strict\` and resolve every issue before sharing the proposal.`;


const proposalReferences = `**Reference**
- Use \`openspec show <id> --json --deltas-only\` or \`openspec show <spec> --type spec\` to inspect details when validation fails.
- Search existing requirements with \`rg -n "Requirement:|Scenario:" openspec/specs\` before writing new ones.
- Explore the codebase with \`rg <keyword>\`, \`ls\`, or direct file reads so proposals align with current implementation realities.`;

const applySteps = `**Steps**
Track these steps as TODOs and complete them one by one.
1. Read \`changes/<id>/proposal.md\`, \`design.md\` (if present), and \`tasks.md\` to confirm scope and acceptance criteria.
2. Work through tasks sequentially, keeping edits minimal and focused on the requested change.
3. Confirm completion before updating statuses—make sure every item in \`tasks.md\` is finished.
4. Update the checklist after all work is done so each task is marked \`- [x]\` and reflects reality.
5. Reference \`openspec list\` or \`openspec show <item>\` when additional context is required.`;

const applyReferences = `**Reference**
- Use \`openspec show <id> --json --deltas-only\` if you need additional context from the proposal while implementing.`;

const archiveSteps = `**Steps**
1. Determine the change ID to archive:
   - If this prompt already includes a specific change ID (for example inside a \`<ChangeId>\` block populated by slash-command arguments), use that value after trimming whitespace.
   - If the conversation references a change loosely (for example by title or summary), run \`openspec list\` to surface likely IDs, share the relevant candidates, and confirm which one the user intends.
   - Otherwise, review the conversation, run \`openspec list\`, and ask the user which change to archive; wait for a confirmed change ID before proceeding.
   - If you still cannot identify a single change ID, stop and tell the user you cannot archive anything yet.
2. Validate the change ID by running \`openspec list\` (or \`openspec show <id>\`) and stop if the change is missing, already archived, or otherwise not ready to archive.
3. If Claude Code hooks with review agents are installed (check for \`openspec/agents/\` directory), the archive process will automatically run review agents before archiving:
   - Code review agent (\`openspec/agents/code-review.md\`) checks for quality issues, security vulnerabilities, and pattern violations.
   - Documentation agent (\`openspec/agents/documentation.md\`) ensures documentation is up-to-date.
   - Worklog generator agent (\`openspec/agents/worklog-generator.md\`) creates final session summary.
   - Review results will be presented with options to fix issues, archive anyway, or create follow-up changes.
   - Note: Review agents can be bypassed by using the keyword \`archive: --skip-review\` if hooks are configured to support this flag.
4. Run \`openspec archive <id> --yes\` so the CLI moves the change and applies spec updates without prompts (use \`--skip-specs\` only for tooling-only work).
5. Review the command output to confirm the target specs were updated and the change landed in \`changes/archive/\`.
6. Validate with \`openspec validate --strict\` and inspect with \`openspec show <id>\` if anything looks off.`;

const archiveReferences = `**Reference**
- Use \`openspec list\` to confirm change IDs before archiving.
- Inspect refreshed specs with \`openspec list --specs\` and address any validation issues before handing off.`;

const pauseSteps = `**Steps**
1. Determine the current active change:
   - Check the current git branch to identify which change you're working on.
   - Run \`openspec list\` to verify the change ID if needed.
   - If no active change can be identified, inform the user that pause requires an active change context.
2. Run the worklog generator agent (located at \`openspec/agents/worklog-generator.md\`) to analyze the current session:
   - Read the conversation transcript to extract key information.
   - Identify accomplishments (what was implemented or completed).
   - Capture decisions (technical choices made and their rationale).
   - Note discoveries (new information learned about the codebase).
   - Document problems and solutions (issues encountered and how they were resolved).
   - List next steps (what remains to be done).
3. Create or update \`openspec/changes/<id>/worklog.md\` with a timestamped entry containing the extracted information.
4. Update \`tasks.md\` with progress notes on completed or in-progress tasks.
5. Confirm the worklog has been saved and inform the user they can resume work later with full context.`;

const pauseReferences = `**Reference**
- The worklog generator agent is located at \`openspec/agents/worklog-generator.md\`.
- Worklog entries use structured markdown with sections for accomplishments, decisions, discoveries, problems/solutions, and next steps.
- Use \`openspec show <id>\` to review the current change context if needed.`;

export const slashCommandBodies: Record<SlashCommandId, string> = {
  proposal: [proposalGuardrails, proposalSteps, proposalReferences].join('\n\n'),
  apply: [baseGuardrails, applySteps, applyReferences].join('\n\n'),
  archive: [baseGuardrails, archiveSteps, archiveReferences].join('\n\n'),
  pause: [baseGuardrails, pauseSteps, pauseReferences].join('\n\n')
};

export function getSlashCommandBody(id: SlashCommandId): string {
  return slashCommandBodies[id];
}
