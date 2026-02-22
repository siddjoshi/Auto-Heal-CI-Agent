'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Copilot Coding Agent backend.
 *
 * Creates a GitHub Issue with the diagnosis and fix instructions,
 * then assigns the Copilot coding agent to auto-generate a PR.
 *
 * Requires: GitHub platform, GH_PAT with repo scope.
 * Uses: GitHub REST API + GraphQL mutation for Copilot assignment.
 */

const COPILOT_BOT_ID = 'BOT_kgDOC9w8XQ';

/**
 * Build the issue body from diagnosis and context.
 */
function buildIssueBody(diagnosis, context, healPrompt) {
  const logTail = context.logTail || 'No log available.';
  const diagJson = JSON.stringify(diagnosis, null, 2);

  return [
    '## CI Pipeline Failure — Auto-Heal Request',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| **Branch** | \`${context.branch}\` |`,
    `| **Commit** | \`${context.commitSha}\` |`,
    `| **Failure Type** | \`${diagnosis.type}\` |`,
    `| **Attempt** | ${context.attempt} |`,
    context.runUrl ? `| **Run** | [View workflow run](${context.runUrl}) |` : '',
    '',
    '## Diagnosis',
    '',
    '```json',
    diagJson,
    '```',
    '',
    '## CI Log (tail)',
    '',
    '```',
    logTail,
    '```',
    '',
    '## Fix Instructions',
    '',
    healPrompt,
    '',
    '---',
    '*This issue was created automatically by the self-healing CI pipeline.*',
  ].filter(Boolean).join('\n');
}

/**
 * Create a GitHub issue and assign Copilot coding agent.
 */
async function fix(diagnosis, context, config) {
  const { repoRoot } = context;
  const owner = context.owner || process.env.GITHUB_REPOSITORY_OWNER;
  const repo = context.repo || (process.env.GITHUB_REPOSITORY || '').split('/')[1];
  const ghToken = context.ghPat || process.env.GH_PAT || process.env.GH_TOKEN;

  if (!owner || !repo) {
    throw new Error('Repository owner/name not available. Set GITHUB_REPOSITORY or pass owner/repo in context.');
  }

  if (!ghToken) {
    throw new Error('GH_PAT or GH_TOKEN is required for the copilot-agent backend.');
  }

  // Load heal prompt
  let healPrompt = 'Fix the CI failure based on the diagnosis above.';
  const promptPath = path.join(__dirname, '..', 'prompts', 'heal-prompt.md');
  if (fs.existsSync(promptPath)) {
    healPrompt = fs.readFileSync(promptPath, 'utf8');
  }

  // Render prompt variables
  healPrompt = healPrompt
    .replace(/\{\{FAILURE_TYPE\}\}/g, diagnosis.type)
    .replace(/\{\{ATTEMPT_NUMBER\}\}/g, String(context.attempt || 1))
    .replace(/\{\{MAX_ATTEMPTS\}\}/g, String(config.maxAttempts || 3))
    .replace(/\{\{BRANCH_NAME\}\}/g, context.branch || 'unknown')
    .replace(/\{\{COMMIT_SHA\}\}/g, context.commitSha || 'unknown')
    .replace(/\{\{VALIDATION_COMMAND\}\}/g, diagnosis.validationCommand || 'npm test')
    .replace(/\{\{FAILURE_DETAILS\}\}/g, JSON.stringify(diagnosis, null, 2))
    .replace(/\{\{CI_LOG_TAIL\}\}/g, context.logTail || 'See workflow run for full log.');

  const title = `Auto-heal: CI ${diagnosis.type} failure on \`${context.branch || 'unknown'}\``;
  const body = buildIssueBody(diagnosis, context, healPrompt);

  // Create issue via gh CLI (avoids needing octokit dependency)
  const issueArgs = [
    'gh', 'api',
    `repos/${owner}/${repo}/issues`,
    '-X', 'POST',
    '-f', `title=${title}`,
    '-f', `body=${body}`,
    '-f', 'labels[]=ci-failure',
    '-f', 'labels[]=auto-heal',
  ];

  let issueNumber;
  try {
    const result = execSync(issueArgs.join(' '), {
      cwd: repoRoot,
      env: { ...process.env, GH_TOKEN: ghToken },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(result);
    issueNumber = parsed.number;
    console.log(`Created issue #${issueNumber}`);
  } catch (err) {
    // Fallback: use curl-style
    throw new Error(`Failed to create GitHub issue: ${err.message}`);
  }

  // Get issue node ID for GraphQL mutation
  const nodeIdQuery = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){id}}}`;
  let issueNodeId;
  try {
    const result = execSync(
      `gh api graphql -f query='${nodeIdQuery}' -f owner='${owner}' -f repo='${repo}' -F number=${issueNumber} --jq '.data.repository.issue.id'`,
      {
        env: { ...process.env, GH_TOKEN: ghToken },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    issueNodeId = result.trim();
  } catch (err) {
    console.error(`Warning: Could not retrieve issue node ID: ${err.message}`);
    return { issueNumber, assigned: false };
  }

  // Assign Copilot via GraphQL mutation
  const mutation = `mutation{addAssigneesToAssignable(input:{assignableId:"${issueNodeId}",assigneeIds:["${COPILOT_BOT_ID}"]}){assignable{...on Issue{assignees(first:5){nodes{login}}}}}}`;
  try {
    const result = execSync(
      `gh api graphql -f query='${mutation}'`,
      {
        env: { ...process.env, GH_TOKEN: ghToken },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const assigned = result.includes('Copilot') || result.includes('copilot');
    console.log(assigned ? `Assigned Copilot to issue #${issueNumber}` : `Warning: Copilot assignment may have failed`);
    return { issueNumber, assigned };
  } catch (err) {
    console.error(`Warning: Copilot assignment failed: ${err.message}`);
    return { issueNumber, assigned: false };
  }
}

module.exports = { fix, name: 'copilot-agent' };
