## Cursor Cloud specific instructions

### Project overview

Static HTML/CSS/JS competitive analysis slide deck — no package manager, no bundler, no backend.
See `README.md` for repo layout, `DEPENDENCIES.md` for the full dependency list, and
`competitive-analysis-templates/README.md` for the template data schema and slide structure.

### Serving templates locally

```bash
npx --yes serve competitive-analysis-templates -p 3000
```

Then open `http://localhost:3000/template-tech.html` (or `template-macaron.html` / `template-minimal.html`).

### Build / verify (Apache Ant)

| Command | Purpose |
|---------|---------|
| `ant verify-layout` | Confirm source directory exists |
| `ant dist` | Clean + copy to `build/dist/` |
| `ant clean` | Remove `build/` |

### Regenerate demo Excel data

```bash
python3 competitive-analysis-templates/tools/build-matrix-xlsx.py
```

Requires `openpyxl` (`pip install openpyxl`).

### Gotchas

- There is **no linter or test framework** in this repo. Validation is `ant verify-layout` plus manual browser testing.
- `build/` is gitignored; never commit it.
- The xlsx generation script paths are relative to the repo root — run it from `/workspace`.
- External image URLs (e.g. picsum) in the demo JSON require network access; replace them for fully offline use.
