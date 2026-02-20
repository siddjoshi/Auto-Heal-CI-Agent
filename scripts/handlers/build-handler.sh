#!/usr/bin/env bash
# Build failure handler — detects module resolution and syntax errors
# Usage: ./handlers/build-handler.sh <log-file>
# Exit 0 = matched this failure type, Exit 1 = not our failure type

set -euo pipefail

LOG_FILE="${1:?Usage: build-handler.sh <log-file>}"

if [[ ! -f "$LOG_FILE" ]]; then
  exit 1
fi

# Look for common build error patterns
BUILD_ERRORS=$(grep -cE "(Cannot find module|SyntaxError|Unexpected token|ReferenceError)" "$LOG_FILE" 2>/dev/null || true)

if [[ "$BUILD_ERRORS" == "0" ]]; then
  exit 1
fi

# Extract error details
node -e "
  const fs = require('fs');
  const log = fs.readFileSync('${LOG_FILE}', 'utf8');
  const lines = log.split('\n');
  const failures = [];
  const files = new Set();

  const patterns = [
    { regex: /Cannot find module '([^']+)'/g, type: 'missing-module' },
    { regex: /SyntaxError: (.+)/g, type: 'syntax-error' },
    { regex: /ReferenceError: (.+)/g, type: 'reference-error' }
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      let match;
      pattern.regex.lastIndex = 0;
      while ((match = pattern.regex.exec(line)) !== null) {
        failures.push({
          name: pattern.type,
          file: '',
          message: match[0].substring(0, 500)
        });
      }
    }

    // Extract file paths from error messages
    const fileMatch = line.match(/(?:at |in |from )([^ ]+\.[jt]sx?)/);
    if (fileMatch) files.add(fileMatch[1]);
  }

  if (failures.length === 0) {
    process.exit(1);
  }

  const output = {
    type: 'build-error',
    healable: true,
    failureCount: failures.length,
    failures,
    relevantFiles: [...files],
    validationCommand: 'npm run build'
  };

  console.log(JSON.stringify(output, null, 2));
"
