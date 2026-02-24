# Contributing

Thank you for your interest in contributing to the Auto-Heal CI Agent.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<you>/Auto-heal-CI-Agent.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/my-feature`

## Repository Structure

This repo contains two things:

- **Heal-agent engine** — the core diagnostic + fix pipeline (`engine/`, `handlers/`, `backends/`, `adapters/`, `prompts/`)
- **Sample Express app** — a Task Manager API used to test the pipeline (`src/`, `tests/`)

## Development Workflow

```bash
# Sample app
npm test           # Run test suite (Jest + supertest)
npm run lint       # Run ESLint
npm start          # Start Express server (port 3000)

# Engine (manual testing)
node engine/index.js --backend llm-api --language node --log-file ci-output.log --dry-run --verbose
```

## Code Conventions

### Sample App (`src/`, `tests/`)

- Use `const` and `let` — never `var`
- Single quotes for strings
- Always include semicolons
- Use `async/await` for asynchronous operations
- Descriptive variable names (no single-letter names except loop counters)
- Error responses: `{ error: "message" }` format

### Engine (`engine/`, `handlers/`, `backends/`)

- CommonJS modules (`require` / `module.exports`)
- Functions should return structured objects (e.g., diagnosis objects with `type`, `files`, `command`)
- Handlers return `null` when they don't match the failure type
- Use `fs.readFileSync` / `fs.existsSync` for file operations within handlers

## Testing

- Tests live in `tests/` with the pattern `*.test.js`
- Use Jest and supertest
- Each test file should call `resetStore()` in `beforeEach`
- Test names follow: `should <expected behavior>`

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure lint passes: `npm run lint`
3. Test the engine locally with `--dry-run` if you changed handlers or backends
4. Update documentation if adding new features
5. Write a clear PR description explaining what changed and why

## Adding New Failure Handlers, Backends, or Adapters

See [EXTENDING.md](EXTENDING.md) for detailed instructions on:

- Adding Node.js handlers (`handlers/node/`)
- Adding shell handlers (`scripts/handlers/`)
- Adding new AI backends (`backends/`)
- Adding CI platform adapters (`adapters/`)
- Customising prompt templates (`prompts/`)

## Reporting Issues

- Use GitHub Issues with a descriptive title
- Include steps to reproduce
- Attach relevant CI logs or audit artifacts from `.heal-audit/` if applicable

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
