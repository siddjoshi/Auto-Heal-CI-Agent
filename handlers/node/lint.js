'use strict';

const fs = require('fs');
const path = require('path');

/**
 * ESLint failure handler.
 * Parses lint-output.json (ESLint JSON format) to extract violations.
 */
function detect(repoRoot) {
  const jsonPath = path.join(repoRoot, 'lint-output.json');

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  let results;
  try {
    results = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }

  const totalErrors = results.reduce((sum, f) => sum + f.errorCount, 0);
  if (totalErrors === 0) return null;

  const violations = [];
  for (const file of results) {
    if (file.errorCount > 0) {
      for (const msg of file.messages) {
        if (msg.severity === 2) {
          violations.push({
            file: file.filePath,
            line: msg.line,
            column: msg.column,
            rule: msg.ruleId,
            message: msg.message,
          });
        }
      }
    }
  }

  return {
    type: 'lint-violation',
    healable: true,
    failureCount: violations.length,
    failures: violations.map((v) => ({
      name: `${v.rule} at ${v.file}:${v.line}`,
      file: v.file,
      message: `${v.rule}: ${v.message} (line ${v.line}, col ${v.column})`,
    })),
    relevantFiles: [...new Set(violations.map((v) => v.file))],
    validationCommand: 'npm run lint',
  };
}

module.exports = { detect, name: 'lint' };
