---
applyTo: "src/**"
---

# Source Code Instructions

When modifying files under `src/`:

- Use `const` for all variable declarations unless reassignment is needed, then use `let`.
- Never use `var`.
- Use single quotes for strings.
- Always terminate statements with semicolons.
- Use `async/await` instead of raw Promises or callbacks.
- Error responses from service functions use the format `{ error: "message" }`.
- Success responses use `{ task: {...} }` or `{ tasks: [...], count: N }`.
- Input validation belongs in `src/services/`, not in routes.
- Routes should only handle HTTP concerns (status codes, req/res).
- The data store in `src/models/` should have no business logic.
