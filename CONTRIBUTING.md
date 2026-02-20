# Contributing

Thank you for your interest in contributing to the Self-Healing CI/CD Pipeline.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<you>/Auto-heal-CI-Agent.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/my-feature`

## Development Workflow

```bash
npm test           # Run test suite
npm run lint       # Run linter
npm start          # Start dev server (port 3000)
```

## Code Conventions

- Use `const` and `let` — never `var`
- Single quotes for strings
- Always include semicolons
- Use `async/await` for asynchronous operations
- Descriptive variable names (no single-letter names except loop counters)
- Error responses: `{ error: "message" }` format

## Testing

- Tests live in `tests/` with the pattern `*.test.js`
- Use Jest and supertest
- Each test file should call `resetStore()` in `beforeEach`
- Test names follow: `should <expected behavior>`

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure lint passes: `npm run lint`
3. Update documentation if adding new features
4. Write a clear PR description explaining what changed and why

## Adding New Failure Handlers

See [EXTENDING.md](EXTENDING.md) for detailed instructions on adding handlers, prompt templates, and Copilot skills.

## Reporting Issues

- Use GitHub Issues with a descriptive title
- Include steps to reproduce
- Attach relevant CI logs or audit artifacts if applicable

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
