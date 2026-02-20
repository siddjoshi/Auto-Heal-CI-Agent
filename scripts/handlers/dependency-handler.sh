#!/usr/bin/env bash
# Dependency failure handler — detects npm install/audit issues
# Usage: ./handlers/dependency-handler.sh <log-file>
# Exit 0 = matched this failure type, Exit 1 = not our failure type

set -euo pipefail

LOG_FILE="${1:?Usage: dependency-handler.sh <log-file>}"

if [[ ! -f "$LOG_FILE" ]]; then
  exit 1
fi

# Look for npm error patterns
DEP_ERRORS=$(grep -cE "(npm ERR!|ERESOLVE|peer dep|could not resolve)" "$LOG_FILE" 2>/dev/null || true)

if [[ "$DEP_ERRORS" == "0" ]]; then
  exit 1
fi

# Extract dependency error details
node -e "
  const fs = require('fs');
  const log = fs.readFileSync('${LOG_FILE}', 'utf8');
  const lines = log.split('\n');
  const failures = [];

  for (const line of lines) {
    if (line.includes('npm ERR!') || line.includes('ERESOLVE') || line.includes('peer dep')) {
      failures.push({
        name: 'dependency-error',
        file: 'package.json',
        message: line.trim().substring(0, 500)
      });
    }
  }

  if (failures.length === 0) {
    process.exit(1);
  }

  const output = {
    type: 'dependency-error',
    healable: true,
    failureCount: failures.length,
    failures: failures.slice(0, 10),
    relevantFiles: ['package.json', 'package-lock.json'],
    validationCommand: 'npm install'
  };

  console.log(JSON.stringify(output, null, 2));
"
