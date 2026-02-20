# Repository Copilot Instructions

## Project Overview
This is a Node.js Express REST API (Task Manager) with a self-healing CI/CD pipeline.
The pipeline uses GitHub Copilot CLI to automatically diagnose and fix CI failures.

## Code Conventions
- Use `const` and `let` — never `var`.
- Use single quotes for strings.
- Always include semicolons.
- Use `async/await` for asynchronous operations.
- Prefer descriptive variable names; no single-letter names except in loops.
- Error responses must use `{ error: "message" }` format.

## Testing Conventions
- Tests live in `tests/` with the pattern `*.test.js`.
- Use Jest and supertest.
- Each test file should `resetStore()` in `beforeEach`.
- Test names should follow: `should <expected behavior>`.

## When Fixing Bugs
1. Identify the root cause precisely — do not make speculative changes.
2. Only modify the minimal set of files needed.
3. Ensure existing tests still pass after any fix.
4. If a test assertion is wrong, fix the assertion, not the application code.
5. If application code is wrong, fix the application code, not the test.
6. Never delete or skip tests to make the suite pass.
7. After making changes, validate by mentally running the test logic.

## File Structure
- `src/models/` — data layer (in-memory store)
- `src/services/` — business logic and validation
- `src/routes/` — Express route handlers
- `src/app.js` — Express application setup
- `tests/` — Jest test suites
- `scripts/` — CI/CD automation scripts
