# CI Healing Skill

This skill enables Copilot to diagnose and repair CI/CD pipeline failures for
Node.js applications using Jest, ESLint, and npm.

## Capabilities

- Parse Jest JSON test output and identify failing test cases
- Parse ESLint JSON output and identify lint violations
- Read and understand Node.js build errors (module resolution, syntax)
- Determine whether a failure is in test code or application code
- Apply minimal, targeted fixes without side effects
- Respect code style conventions defined in the project

## Failure Analysis Process

### Step 1: Read the Failure Log
Parse the CI output to extract:
- **Exit code** — which step failed
- **Error messages** — exact error text
- **File locations** — which files/lines are referenced
- **Error type** — assertion, runtime, lint, build, dependency

### Step 2: Classify the Failure

| Type | Indicators | Action |
|------|-----------|--------|
| Test assertion failure | `expect(received).toBe(expected)` | Compare expected vs actual; determine which is correct |
| Test runtime error | `TypeError`, `ReferenceError` | Check code under test and test setup |
| Lint violation | ESLint rule name + file:line | Apply the rule-compliant fix |
| Build error | `Cannot find module`, `SyntaxError` | Fix import paths or syntax |
| Dependency error | `npm ERR!`, `ERESOLVE` | Fix package.json versions |

### Step 3: Root Cause Analysis
- Read the failing test file to understand what behavior is expected
- Read the source file being tested to understand actual behavior
- Compare expected vs actual — determine which is correct
- If the test expectation is wrong, fix the test
- If the source code produces wrong output, fix the source code

### Step 4: Apply Fix
- Edit only the files that need changing
- Make the minimal change needed
- Do not refactor, rename, or "improve" unrelated code
- Do not add comments explaining the fix in the source code

### Step 5: Validate
- Re-run the failing command to confirm the fix works
- If the fix introduces new failures, revert and try again

## Common Fix Patterns

### Wrong assertion value
```javascript
// Before (wrong expected value)
expect(result.status).toBe('healthy');
// After (correct expected value)
expect(result.status).toBe('ok');
```

### ESLint no-var violation
```javascript
// Before
var app = express();
// After
const app = express();
```

### Missing import
```javascript
// Before
const { foo } = require('./utils');  // foo doesn't exist in utils
// After
const { bar } = require('./utils');  // bar is the correct export
```

### Wrong comparison operator
```javascript
// Before
if (date > now) { /* overdue */ }
// After
if (date < now) { /* overdue */ }
```
