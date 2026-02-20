---
applyTo: "tests/**"
---

# Test Code Instructions

When modifying files under `tests/`:

- Each test file must import `store` from `../src/models/taskStore` and call
  `store.resetStore()` in a `beforeEach` block.
- Use `supertest` for HTTP integration tests; import `app` from `../src/app`.
- Test names follow: `should <expected behavior>`.
- Do not use `test.skip()` or `xtest()` to silence failures.
- Do not delete or comment out existing tests.
- Assertions should test actual application behavior, not hardcoded values.
- When a test fails, determine if the test expected the wrong value or
  the application returned the wrong value before making any change.
