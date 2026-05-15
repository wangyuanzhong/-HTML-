# vibe-html

Static **竞品分析** HTML template kit: open in a browser, no build required for local development. Optional Ant step packs files for deployment.

## Contents

| Path | Description |
|------|-------------|
| `competitive-analysis-templates/` | `template-*.html`, `assets/matrix-core.js`, `themes/*.css` |
| `competitive-analysis-templates/README.md` | Template-specific JSON schema and slide flow |
| `build.xml` | Optional [Apache Ant](https://ant.apache.org/) copy-to-`build/dist` |
| `DEPENDENCIES.md` | Runtime, optional tools, paths — for humans and cloud agents |
| `environment.json` | Machine-readable environment summary for automation |

## Quick start

1. Open `competitive-analysis-templates/template-tech.html` (or `template-macaron.html`, `template-minimal.html`) in **Chrome / Edge / Firefox**.
2. Edit copy inside `<script id="deck-data">` only if you want data-only changes.

Some browsers restrict `file://`; if anything fails, serve the folder with any static server, for example:

```bash
npx --yes serve competitive-analysis-templates -p 3000
```

(`serve` is optional — not a repo requirement; see `DEPENDENCIES.md`.)

## Build / package (optional)

Requires **Apache Ant** installed and `ant` on your `PATH`.

```bash
ant dist
```

Output: `build/dist/` — mirror of `competitive-analysis-templates/` suitable for zip or static hosting.

```bash
ant clean
```

Removes `build/`.

## Git

- Use the root `.gitignore` before `git push` (ignores `build/`, OS junk, editor clutter, future `node_modules/` if added).
- Subfolder `competitive-analysis-templates/README.md` stays the **template** manual.

## Documentation for AI / cloud agents

- **`DEPENDENCIES.md`** — full narrative: what is required vs optional, assumptions, verification.
- **`environment.json`** — short JSON for automated environment checks.
