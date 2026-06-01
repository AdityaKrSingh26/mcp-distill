# Contributing to mcp-distill

First off, thank you for considering contributing to `mcp-distill`! It’s people like you who make the open-source community an amazing place to learn, inspire, and create.

This guide outlines a set of guidelines and workflows for contributing to this project. These are suggestions, not rigid rules—use your best judgment and feel free to propose changes to this document in a pull request.

---

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct:
- Be welcoming, inclusive, and professional.
- Respect differing viewpoints and experiences.
- Gracefully accept constructive criticism.
- Focus on what is best for the community.

---

## How Can I Contribute?

### Reporting Bugs
If you find a bug, please open an Issue on GitHub. Include:
- A clear, descriptive title.
- Steps to reproduce the issue.
- Expected vs. actual behavior.
- Details about your environment (Node.js version, OS, browser MCP used).

### Suggesting Enhancements
We welcome ideas for new features, additional CSS filtering rules, and better console deduplication heuristics. To suggest an enhancement, please open an Issue describing:
- The problem you are trying to solve or the gap you want to fill.
- Your proposed solution or feature detail.
- Any alternative solutions you've considered.

### Submitting Pull Requests
1. Fork the repository and create your branch from `main`.
2. Install dependencies with `npm install`.
3. If you've added code that should be tested, add tests to the `test/` directory.
4. Ensure all existing and new tests pass by running `npm test`.
5. Write clear, concise commit messages.
6. Submit a Pull Request targeting the `main` branch.

---

## Local Development Setup

To set up the project locally for development and testing:

1. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR-USERNAME/mcp-distill.git
   cd mcp-distill
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the tests**:
   ```bash
   npm test
   ```

4. **Run the linter**:
   ```bash
   npm run lint
   ```
   To auto-fix style issues:
   ```bash
   npm run lint:fix
   ```

---

## Project Structure

A quick guide to the directory layout:

- `src/` — Core implementation of the proxy server.
  - `src/index.js` — Entry point of the server.
  - `src/client.js` — Coordinates parallel backend connection and communication.
  - `src/server.js` — Expresses/creates the MCP server.
  - `src/tools/` — Specific tool implementations (e.g. `diagnose-element`).
  - `src/analysis/` — Core heuristics engines (layout analysis, CSS filters, sourcemap resolvers).
- `test/` — Unit and integration tests (using Node's native test runner).

---

## Testing Your Local Proxy with AI Assistants

You can test your local changes directly with MCP clients (like Claude Code or Cursor) by configuring them to use your local directory:

### Claude Code (`~/.claude.json`)
```json
{
  "mcpServers": {
    "mcp-distill-local": {
      "command": "node",
      "args": ["/absolute/path/to/your/local/mcp-distill/src/index.js"],
      "env": {
        "MCP_DISTILL_BACKEND_CMD": "npx",
        "MCP_DISTILL_BACKEND_ARGS": "chrome-devtools-mcp"
      }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)
Set up a new command-line MCP server with:
- **Command**: `node /absolute/path/to/your/local/mcp-distill/src/index.js`

---

## Style Guide

This project uses [ESLint](https://eslint.org/) for linting and [Prettier](https://prettier.io/) for code formatting. Please ensure both pass before submitting a PR.

**Formatting**: Run Prettier to auto-format your code:
```bash
npm run format
```
To check without modifying files (e.g. in CI):
```bash
npm run format:check
```

**Linting**: Run ESLint to catch logic issues:
```bash
npm run lint
```

Key style rules enforced automatically:
- 2-space indentation, 100-character line width
- Double quotes, trailing commas, semicolons
- Prefer `const` over `let`; avoid `var`
- Always use braces on `if`/`else` blocks
- Strict equality (`===`) only
- Avoid using em dashes (`---`) in comments and user-facing text; use colons, commas, or parentheses instead
- If an empty `catch {}` block is intentional (silent fallthrough), add an `// eslint-disable-next-line no-empty` comment to document the intent

Happy coding!
