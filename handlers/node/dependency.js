'use strict';

const fs = require('fs');

const DEP_PATTERNS = [
  /npm ERR!/i,
  /ERESOLVE/,
  /peer dep/i,
  /could not resolve/i,
];

/**
 * Dependency failure handler.
 * Parses CI log file for npm installation errors.
 */
function detect(repoRoot, logFile) {
  if (!logFile || !fs.existsSync(logFile)) {
    return null;
  }

  const log = fs.readFileSync(logFile, 'utf8');
  const lines = log.split('\n');
  const failures = [];

  for (const line of lines) {
    for (const pattern of DEP_PATTERNS) {
      if (pattern.test(line)) {
        failures.push({
          name: 'dependency-error',
          file: 'package.json',
          message: line.trim().substring(0, 500),
        });
        break;
      }
    }
  }

  if (failures.length === 0) return null;

  return {
    type: 'dependency-error',
    healable: true,
    failureCount: failures.length,
    failures: failures.slice(0, 10),
    relevantFiles: ['package.json', 'package-lock.json'],
    validationCommand: 'npm install',
  };
}

module.exports = { detect, name: 'dependency' };
