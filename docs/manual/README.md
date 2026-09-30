# User manual

The user manual lives in one folder per language, `docs/manual/<lang>/manual.md`, with its screenshots in `docs/manual/<lang>/img/`. `docs/manual/manual.css` styles every language.

```sh
npm run manual        # builds docs/manual/bae-manual-<lang>.pdf for every language folder
npm run manual -- es  # builds one language
```

The script (`scripts/manual.mjs`) renders the Markdown with `marked`, embeds the IBM Plex fonts and the images, and prints the page with Chromium through `playwright-core`. The first run downloads Chromium's headless shell (about 115 MB) into Playwright's cache. The PDF's dates come from the front matter, so the same sources give the same bytes. The build fails when the PDF has more pages than `maxPages`.

## Adding a language

1. Copy `es/` to `<lang>/` and translate `manual.md`, including the front matter (`title`, `subtitle`, `dateText`, `audience`, `labels`).
2. Quote the CLI's own messages from `src/i18n/<lang>.ts`. Every quoted message in the Spanish manual has an HTML comment with its key, such as `<!-- msg: next.dirtyStop -->`, next to it.
3. Take new screenshots from a real run with `--lang <lang>`, so the screens match the language of the text. The Spanish ones come from a run of the published 0.4.0 on the `node-app` fixture with the brief in section 5.
4. Run `npm run manual -- <lang>` and commit the PDF with the sources.
