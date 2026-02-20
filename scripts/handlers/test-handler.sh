#!/usr/bin/env bash
# Test failure handler — parses Jest JSON output
# Usage: ./handlers/test-handler.sh <log-file>
# Exit 0 = matched this failure type, Exit 1 = not our failure type

set -euo pipefail

LOG_FILE="${1:?Usage: test-handler.sh <log-file>}"

# Check if test-results.json exists (produced by npm test:json)
if [[ ! -f "test-results.json" ]]; then
  exit 1
fi

# Check if there are actual test failures
FAILED_COUNT=$(node -e "
  const r = require('./test-results.json');
  console.log(r.numFailedTests || 0);
" 2>/dev/null || echo "0")

if [[ "$FAILED_COUNT" == "0" ]]; then
  exit 1
fi

# Extract failure details
node -e "
  const results = require('./test-results.json');
  const failures = [];

  for (const suite of results.testResults) {
    for (const test of suite.testResults) {
      if (test.status === 'failed') {
        failures.push({
          testName: test.fullName || test.title,
          file: suite.name,
          messages: test.failureMessages
        });
      }
    }
  }

  const output = {
    type: 'test-failure',
    healable: true,
    failureCount: results.numFailedTests,
    failures: failures.map(f => ({
      name: f.testName,
      file: f.file,
      message: f.messages.join('\n').substring(0, 2000)
    })),
    relevantFiles: [...new Set(failures.map(f => f.file))],
    validationCommand: 'npm test'
  };

  console.log(JSON.stringify(output, null, 2));
"
