#!/usr/bin/env node
'use strict';

/**
 * heal-agent CLI — Self-healing CI pipeline engine.
 *
 * Usage:
 *   npx heal-agent [options]
 *   heal-agent --backend llm-api --language node --log-file ci.log
 *
 * Options:
 *   --backend <name>    AI backend (copilot-agent|copilot-cli|llm-api)
 *   --language <lang>   Language ecosystem (node|python|go|dotnet)
 *   --log-file <path>   Path to CI log file
 *   --repo-root <path>  Repository root (default: cwd)
 *   --attempt <n>       Current attempt number (default: 1)
 *   --max-attempts <n>  Max heal attempts (default: 3)
 *   --commit-mode <m>   Commit mode: push|pr|none (default: none)
 *   --dry-run           Diagnose only, do not fix
 *   --verbose           Enable verbose logging
 *   --help              Show this help
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { diagnose } = require('./diagnose');
const { fix } = require('./fix');
const { commit } = require('./commit');
const { validate } = require('./validate');

/**
 * Parse CLI arguments into an options object.
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg === '--backend' && args[i + 1]) {
      opts.backend = args[++i];
    } else if (arg === '--language' && args[i + 1]) {
      opts.language = args[++i];
    } else if (arg === '--log-file' && args[i + 1]) {
      opts.logFile = args[++i];
    } else if (arg === '--repo-root' && args[i + 1]) {
      opts.repoRoot = args[++i];
    } else if (arg === '--attempt' && args[i + 1]) {
      opts.attempt = parseInt(args[++i], 10);
    } else if (arg === '--max-attempts' && args[i + 1]) {
      opts.maxAttempts = parseInt(args[++i], 10);
    } else if (arg === '--commit-mode' && args[i + 1]) {
      opts.commitMode = args[++i];
    }

    i++;
  }

  return opts;
}

function printHelp() {
  const help = `
heal-agent — Self-healing CI pipeline engine

Usage:
  heal-agent [options]

Options:
  --backend <name>      AI backend: copilot-agent, copilot-cli, llm-api
  --language <lang>     Language: node, python, go, dotnet
  --log-file <path>     Path to CI log file
  --repo-root <path>    Repository root (default: current directory)
  --attempt <n>         Current attempt number (default: 1)
  --max-attempts <n>    Maximum heal attempts (default: 3)
  --commit-mode <mode>  push, pr, or none (default: none)
  --dry-run             Diagnose only — do not apply fixes
  --verbose             Enable verbose output
  --help                Show this help message

Environment Variables:
  HEAL_BACKEND          Override backend (same as --backend)
  HEAL_LANGUAGE         Override language (same as --language)
  HEAL_LLM_PROVIDER     LLM provider: openai, anthropic, azure-openai, github-models
  HEAL_LLM_MODEL        LLM model name
  OPENAI_API_KEY        API key for OpenAI
  ANTHROPIC_API_KEY     API key for Anthropic
  AZURE_OPENAI_API_KEY  API key for Azure OpenAI
  AZURE_OPENAI_ENDPOINT Azure OpenAI endpoint URL
  GITHUB_MODELS_API_KEY API key for GitHub Models
  LLM_API_KEY           Fallback API key for any provider
  GH_PAT                GitHub PAT (for copilot-agent backend)
  COPILOT_TOKEN         Copilot auth token (for copilot-cli backend)

Configuration:
  Place a .heal-agent.yml file in your repository root.
  See README.md for the full configuration schema.
`.trim();

  console.log(help);
}

/**
 * Read the tail of the CI log file.
 */
function readLogTail(logFile, lines = 200) {
  if (!logFile || !fs.existsSync(logFile)) return '';
  const content = fs.readFileSync(logFile, 'utf8');
  const allLines = content.split('\n');
  return allLines.slice(-lines).join('\n');
}

/**
 * Build runtime context from environment and CLI options.
 */
function buildContext(opts, config) {
  const repoRoot = opts.repoRoot || process.cwd();

  return {
    repoRoot,
    branch: process.env.GITHUB_REF_NAME
      || process.env.BUILD_SOURCEBRANCH
      || process.env.CI_COMMIT_REF_NAME
      || 'unknown',
    commitSha: process.env.GITHUB_SHA
      || process.env.BUILD_SOURCEVERSION
      || process.env.CI_COMMIT_SHA
      || 'unknown',
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
    owner: (process.env.GITHUB_REPOSITORY || '').split('/')[0] || undefined,
    repo: (process.env.GITHUB_REPOSITORY || '').split('/')[1] || undefined,
    attempt: opts.attempt || 1,
    ghPat: process.env.GH_PAT,
    copilotToken: process.env.COPILOT_TOKEN,
    ghHost: process.env.GH_HOST
      || (process.env.GITHUB_SERVER_URL && process.env.GITHUB_SERVER_URL !== 'https://github.com'
        ? process.env.GITHUB_SERVER_URL.replace(/^https?:\/\//, '')
        : undefined),
    logTail: readLogTail(opts.logFile),
    diagnosisType: null, // Set after diagnosis
  };
}

/**
 * Main orchestrator.
 */
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const repoRoot = opts.repoRoot || process.cwd();

  // Load config
  const config = loadConfig(repoRoot);

  // CLI overrides
  if (opts.backend) config.backend = opts.backend;
  if (opts.language) config.language = opts.language;
  if (opts.maxAttempts) config.maxAttempts = opts.maxAttempts;

  // Env var overrides
  if (process.env.HEAL_BACKEND) config.backend = process.env.HEAL_BACKEND;
  if (process.env.HEAL_LANGUAGE) config.language = process.env.HEAL_LANGUAGE;
  if (process.env.HEAL_LLM_PROVIDER) config.llm.provider = process.env.HEAL_LLM_PROVIDER;
  if (process.env.HEAL_LLM_MODEL) config.llm.model = process.env.HEAL_LLM_MODEL;

  const context = buildContext(opts, config);
  const attempt = opts.attempt || 1;

  // Safety check: max attempts
  if (attempt > config.maxAttempts) {
    console.error(`[heal-agent] Max attempts (${config.maxAttempts}) exceeded. Aborting.`);
    process.exit(1);
  }

  console.log(`[heal-agent] Attempt ${attempt}/${config.maxAttempts}`);
  console.log(`[heal-agent] Backend: ${config.backend}`);
  console.log(`[heal-agent] Language: ${config.language}`);

  // Step 1: Diagnose
  console.log('[heal-agent] Step 1: Diagnosing failure...');
  const logFile = opts.logFile ? path.resolve(repoRoot, opts.logFile) : null;
  const diagnosis = diagnose({ repoRoot, logFile, language: config.language });

  console.log(`[heal-agent] Diagnosis: type=${diagnosis.type}, handler=${diagnosis.handler}, healable=${diagnosis.healable}`);

  if (opts.verbose) {
    console.log('[heal-agent] Full diagnosis:');
    console.log(JSON.stringify(diagnosis, null, 2));
  }

  // Write diagnosis to audit file
  const auditDir = path.join(repoRoot, '.heal-audit');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(auditDir, `diagnosis-attempt-${attempt}.json`),
    JSON.stringify(diagnosis, null, 2),
    'utf8'
  );

  if (opts.dryRun) {
    console.log('[heal-agent] Dry run — skipping fix and commit.');
    console.log(JSON.stringify(diagnosis, null, 2));
    process.exit(0);
  }

  if (!diagnosis.healable) {
    console.error(`[heal-agent] Failure is not healable (type: ${diagnosis.type}). Manual intervention required.`);
    process.exit(1);
  }

  // Step 2: Fix
  console.log(`[heal-agent] Step 2: Applying fix via ${config.backend}...`);
  context.diagnosisType = diagnosis.type;

  let fixResult;
  try {
    fixResult = await fix(diagnosis, context, config);
  } catch (err) {
    console.error(`[heal-agent] Fix failed: ${err.message}`);
    process.exit(1);
  }

  console.log(`[heal-agent] Fix result: success=${fixResult.success}`);
  if (opts.verbose) {
    console.log(JSON.stringify(fixResult, null, 2));
  }

  if (!fixResult.success) {
    console.error(`[heal-agent] Fix was not successful: ${fixResult.reason || fixResult.error || 'unknown'}`);
    process.exit(1);
  }

  // Step 2.5: Validate the fix
  if (config.backend !== 'copilot-agent') {
    console.log('[heal-agent] Step 2.5: Validating fix...');
    const validationResult = await validate({ repoRoot, diagnosis, config });

    if (!validationResult.passed) {
      console.error(`[heal-agent] Validation failed: ${validationResult.failedStep || 'unknown'}`);
      if (opts.verbose) {
        console.log(validationResult.output);
      }
      process.exit(1);
    }

    console.log('[heal-agent] Validation passed.');
  }

  // Step 3: Commit (for backends that modify files directly)
  const commitMode = opts.commitMode || 'none';
  if (commitMode !== 'none' && config.backend !== 'copilot-agent') {
    console.log(`[heal-agent] Step 3: Committing changes (mode: ${commitMode})...`);
    const commitResult = commit({ repoRoot, config, context, mode: commitMode });

    console.log(`[heal-agent] Commit result: success=${commitResult.success}`);
    if (opts.verbose) {
      console.log(JSON.stringify(commitResult, null, 2));
    }

    if (!commitResult.success) {
      console.error(`[heal-agent] Commit failed: ${commitResult.reason}`);
      process.exit(1);
    }
  } else if (config.backend === 'copilot-agent') {
    console.log('[heal-agent] Step 3: Skipped (copilot-agent creates its own PR).');
  } else {
    console.log('[heal-agent] Step 3: Skipped (commit-mode=none).');
  }

  console.log('[heal-agent] Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[heal-agent] Fatal error: ${err.message}`);
  process.exit(1);
});
