# Repository Guidelines

## Project Structure & Module Organization

- `extension/`: MV3 extension source (`src/`), built assets in `dist/`, tests in `test/`, static assets in `static/`.
- `extension-dist/`: unpacked extension output produced by `pnpm build`.
- `ui/`: Next.js popup UI in `src/`, public assets in `public/`.
- `shared/`: shared TypeScript utilities in `src/`, tests in `test/`, build output in `dist/`.
- `scripts/`: repo-level build helpers (e.g., packaging in `scripts/make-dist.mjs`).

## Build, Test, and Development Commands

Use `pnpm` from the repo root (monorepo workspaces).

- `pnpm dev`: run the Next.js UI dev server (`ui/`).
- `pnpm build`: build all packages and produce `extension-dist/`.
- `pnpm build:all`: build `shared/`, `ui/`, and `extension/` only.
- `pnpm dist`: package the extension (uses `scripts/make-dist.mjs`).
- `pnpm test`: run Vitest for `shared/` and `extension/`.
- `pnpm lint`: lint the UI package (ESLint).

Examples:
- `pnpm -C shared test`
- `pnpm -C extension build`

## Coding Style & Naming Conventions

- TypeScript, ESM (`"type": "module"`).
- Keep modules small and focused; share cross-cutting logic via `shared/`.
- Use clear, descriptive names; prefer `camelCase` for variables/functions and `PascalCase` for components/classes.
- Linting is enforced in `ui/` via ESLint (`pnpm -C ui lint`). Follow existing patterns in nearby files.

## Testing Guidelines

- Framework: Vitest (`shared/`, `extension/`).
- Place tests in `shared/test/` or `extension/test/` and name files `*.test.ts`.
- Run all tests with `pnpm test`, or package-specific via `pnpm -C <pkg> test`.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits (e.g., `feat: ...`, `ci: ...`).
- PRs should include a clear description, reproduction steps, and screenshots for UI changes.
- Link any relevant issues and call out config changes (e.g., API key handling, new permissions).

## Security & Configuration Tips

- API keys are user-provided in the extension settings; never commit secrets or sample keys.
- When modifying permissions or content scripts, document the rationale in the PR description.
