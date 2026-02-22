'use strict';

const fs = require('fs');

const BUILD_PATTERNS = [
  { regex: /Cannot find module '([^']+)'/g, type: 'missing-module' },
  { regex: /SyntaxError: (.+)/g, type: 'syntax-error' },
  { regex: /ReferenceError: (.+)/g, type: 'reference-error' },
  { regex: /TypeError: (.+)/g, type: 'type-error' },
];

const FILE_REGEX = /(?:at |in |from )([^ ]+\.[jt]sx?)/;

/**
 * Build failure handler.
 * Parses CI log file for common build error patterns.
 */
function detect(repoRoot, logFile) {
  if (!logFile || !fs.existsSync(logFile)) {
    return null;
  }

  const log = fs.readFileSync(logFile, 'utf8');
  const lines = log.split('\n');
  const failures = [];
  const files = new Set();

  for (const line of lines) {
    for (const pattern of BUILD_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        failures.push({
          name: pattern.type,
          file: '',
          message: match[0].substring(0, 500),
        });
      }
    }

    const fileMatch = line.match(FILE_REGEX);
    if (fileMatch) files.add(fileMatch[1]);
  }

  if (failures.length === 0) return null;

  return {
    type: 'build-error',
    healable: true,
    failureCount: failures.length,
    failures,
    relevantFiles: [...files],
    validationCommand: 'npm run build',
  };
}

module.exports = { detect, name: 'build' };
