'use strict';

const path = require('path');

/**
 * Backend factory — routes diagnosis to the configured AI backend.
 *
 * Supported backends:
 *   - copilot-agent: Creates GitHub Issue + assigns Copilot coding agent
 *   - copilot-cli:   Invokes Copilot CLI binary for direct file edits
 *   - llm-api:       Calls an LLM provider API (OpenAI, Anthropic, Azure OpenAI, GitHub Models)
 */

const BACKENDS = {
  'copilot-agent': () => require(path.join(__dirname, '..', 'backends', 'copilot-agent.js')),
  'copilot-cli': () => require(path.join(__dirname, '..', 'backends', 'copilot-cli.js')),
  'llm-api': () => require(path.join(__dirname, '..', 'backends', 'llm-api.js')),
};

/**
 * Run the fix using the configured backend.
 *
 * @param {object} diagnosis - Output from engine/diagnose.js
 * @param {object} context   - Runtime context (repoRoot, branch, commit, tokens, etc.)
 * @param {object} config    - Loaded config from engine/config.js
 * @returns {object} Backend-specific result with at least { success: boolean }
 */
async function fix(diagnosis, context, config) {
  const backendName = config.backend || 'copilot-agent';
  const loader = BACKENDS[backendName];

  if (!loader) {
    const supported = Object.keys(BACKENDS).join(', ');
    throw new Error(`Unknown backend: "${backendName}". Supported: ${supported}`);
  }

  if (!diagnosis.healable) {
    return {
      success: false,
      skipped: true,
      reason: `Diagnosis marked as not healable (type: ${diagnosis.type})`,
    };
  }

  const backend = loader();
  console.log(`[fix] Using backend: ${backendName}`);
  return backend.fix(diagnosis, context, config);
}

/**
 * List available backend names.
 */
function listBackends() {
  return Object.keys(BACKENDS);
}

module.exports = { fix, listBackends };
