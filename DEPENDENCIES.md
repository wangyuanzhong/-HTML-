# Dependencies and environment

This document is for **human developers** and **cloud coding agents** (Cursor Cloud Agent, CI, etc.) to determine what must be present to develop, build, and run this repository.

## Project type

- **Static front-end**: HTML, CSS, JavaScript (vanilla, no bundler in repo).
- **No** `package.json`, **no** compile step required to view templates.
- Primary runtime: **web browser** with JavaScript enabled.

## Required for “run / preview”

| Item | Version / notes |
|------|-----------------|
| Modern browser | Chromium / Firefox / Safari / Edge (recent evergreen) |
| Files | Repository checkout; UTF-8 encoded sources |

Open any `competitive-analysis-templates/template-*.html` directly or via a static HTTP server if `file://` policies cause issues.

## Optional: local static server

Not required by the repo. If you use one, any generic static file server is fine.

Example (only if Node.js is already installed elsewhere):

```bash
npx --yes serve competitive-analysis-templates
```

Agents should **not** assume Node/npm unless the user or CI explicitly adds them.

## Optional: Ant build (`build.xml`)

| Item | Purpose |
|------|---------|
| [Apache Ant](https://ant.apache.org/) | Runs `ant dist` to copy `competitive-analysis-templates` → `build/dist` |

**Not required** for editing or viewing HTML. Only needed if you rely on the Ant packaging target.

## Path assumptions

- **Worktree root**: repository root (where `build.xml` and `.gitignore` live).
- **Source tree**: `competitive-analysis-templates/` (do not rename if you want `build.xml` unchanged).

## Network

- Sample templates may reference **external image URLs** (e.g. picsum) for demos. Offline use: replace or remove those URLs in JSON.

## Encoding

- Source files: **UTF-8** (HTML/CSS/JS with Chinese copy).

## Verification checklist (for agents)

1. `competitive-analysis-templates/` exists.
2. At least one of `template-tech.html`, `template-macaron.html`, `template-minimal.html` exists.
3. `competitive-analysis-templates/assets/matrix-core.js` exists.
4. Browser can load a template page; no server mandatory.

## Machine-readable manifest

See root **`environment.json`** for the same facts in JSON form (parseable by automation).
