# Custom translations

Put your own UI translations for this installation here, one per language,
in either form:

- a folder `<code>/` with `_meta.json` and one `<area>.json` per area of the
  interface, e.g. `ru/` or `de-CH/` – recommended for larger translations;
  it has the same layout as the built-in ones in `apps/web/messages/en/`;
- a single file `<code>.json` with `_meta` and all areas in it, e.g.
  `ru.json` or `pt-BR.json` – fine for a quick translation or a few changed
  texts.

If both `ru/` and `ru.json` exist, the folder is used and the file is
ignored (the log says so).

- Both compose files mount this folder read-only into the web container
  (`./locales:/app/locales/custom:ro`); `pnpm dev` reads it directly.
- Translations are read when the web app starts: restart it after adding or
  changing one (`docker compose restart web`).
- A translation named like a built-in language (`de`, `en`) replaces those
  texts it contains; everything else stays built-in.
- Check a translation before using it: `pnpm check:translations locales/ru`
  (folder) or `pnpm check:translations locales/ru.json` (file).

Everything in this folder except this README is ignored by Git. How to
create a translation: [docs/translations.md](../docs/translations.md).
