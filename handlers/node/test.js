'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Jest test failure handler.
 * Parses test-results.json (Jest JSON format) to extract failed tests.
 */
function detect(repoRoot) {
  const jsonPath = path.join(repoRoot, 'test-results.json');

  if (!fs.existsSync(jsonPath)) {
    return null;
  }

  let results;
  try {
    results = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }

  const failedCount = results.numFailedTests || 0;
  if (failedCount === 0) return null;

  const failures = [];
  for (const suite of (results.testResults || [])) {
    for (const test of (suite.testResults || [])) {
      if (test.status === 'failed') {
        failures.push({
          testName: test.fullName || test.title,
          file: suite.name,
          messages: test.failureMessages || [],
        });
      }
    }
  }

  return {
    type: 'test-failure',
    healable: true,
    failureCount: failedCount,
    failures: failures.map((f) => ({
      name: f.testName,
      file: f.file,
      message: f.messages.join('\n').substring(0, 2000),
    })),
    relevantFiles: [...new Set(failures.map((f) => f.file))],
    validationCommand: 'npm test',
  };
}

module.exports = { detect, name: 'test' };
