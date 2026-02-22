'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load handler modules for the specified language.
 */
function loadHandlers(language) {
  const handlerDir = path.join(__dirname, '..', 'handlers', language);

  if (!fs.existsSync(handlerDir)) {
    throw new Error(`No handlers found for language: ${language}. Expected directory: ${handlerDir}`);
  }

  const indexPath = path.join(handlerDir, 'index.js');
  if (fs.existsSync(indexPath)) {
    return require(indexPath).handlers;
  }

  // Auto-discover handler files
  const files = fs.readdirSync(handlerDir).filter((f) => f.endsWith('.js') && f !== 'index.js');
  return files.map((f) => require(path.join(handlerDir, f)));
}

/**
 * Run the handler chain to diagnose a CI failure.
 *
 * @param {object} options
 * @param {string} options.repoRoot - Absolute path to the repository root
 * @param {string} options.logFile  - Absolute path to the CI log file
 * @param {string} options.language - Language ecosystem (node, python, go, dotnet)
 * @returns {object} Diagnosis result with type, failures, relevantFiles, validationCommand
 */
function diagnose({ repoRoot, logFile, language = 'node' }) {
  const handlers = loadHandlers(language);
  const logPath = logFile ? path.resolve(repoRoot, logFile) : null;

  for (const handler of handlers) {
    try {
      const result = handler.detect(repoRoot, logPath);
      if (result) {
        return {
          matched: true,
          handler: handler.name,
          ...result,
        };
      }
    } catch (err) {
      // Handler threw — skip to next
      console.error(`Handler ${handler.name} threw: ${err.message}`);
    }
  }

  // No handler matched — return generic diagnosis
  return {
    matched: false,
    handler: 'none',
    type: 'unknown',
    healable: true,
    failureCount: 0,
    failures: [],
    relevantFiles: [],
    validationCommand: 'npm test',
  };
}

module.exports = { diagnose, loadHandlers };
