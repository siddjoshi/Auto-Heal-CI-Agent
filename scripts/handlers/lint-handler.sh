#!/usr/bin/env bash
# Lint failure handler — parses ESLint JSON output
# Usage: ./handlers/lint-handler.sh <log-file>
# Exit 0 = matched this failure type, Exit 1 = not our failure type

set -euo pipefail

LOG_FILE="${1:?Usage: lint-handler.sh <log-file>}"

# Check if lint-output.json exists (produced by npm run lint:json)
if [[ ! -f "lint-output.json" ]]; then
  exit 1
fi

# Check if there are actual lint errors
ERROR_COUNT=$(node -e "
  const results = require('./lint-output.json');
  const total = results.reduce((sum, f) => sum + f.errorCount, 0);
  console.log(total);
" 2>/dev/null || echo "0")

if [[ "$ERROR_COUNT" == "0" ]]; then
  exit 1
fi

# Extract lint violation details
node -e "
  const results = require('./lint-output.json');
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
            message: msg.message
          });
        }
      }
    }
  }

  const output = {
    type: 'lint-violation',
    healable: true,
    failureCount: violations.length,
    failures: violations.map(v => ({
      name: v.rule + ' at ' + v.file + ':' + v.line,
      file: v.file,
      message: v.rule + ': ' + v.message + ' (line ' + v.line + ', col ' + v.column + ')'
    })),
    relevantFiles: [...new Set(violations.map(v => v.file))],
    validationCommand: 'npm run lint'
  };

  console.log(JSON.stringify(output, null, 2));
"
