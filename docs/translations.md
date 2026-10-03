# Translations

Hexmark's web interface ships in English and German. You can add further
languages – or change single texts of a built-in one – with translation files
of your own, without rebuilding the image.

The server, the API, MCP and all logs stay in English; only the browser
interface is translated.

## How languages are chosen

The interface language of a request is the first of:

1. the signed-in user's saved language,
2. the language stored in a cookie: picked in the first step of `/setup`, and
   set to the account's language on every sign-in, so the sign-in page keeps
   speaking it after signing out,
3. the browser's preferred languages (`Accept-Language`),
4. the instance default (chosen in the first step of `/setup`),
5. English.

The sign-in page has no language picker: before the first sign-in on a
device it follows the browser.

A browser asking for `de-DE` gets `de` when there is no `de-DE`; one asking
for `de-CH` gets `de-CH` when that translation exists. A stored choice whose
translation was removed falls back to its language (`de-CH` → `de`), then
continues down the list.

## Create a translation

A translation comes in one of two forms. Both hold the same texts; pick the
one that suits you:

- **A folder** `<code>/` with one file per area of the interface – the form
  Hexmark's built-in languages use and the one we recommend for a complete
  or larger translation: each file stays short, and a change touches only
  the area it is about.
- **A single file** `<code>.json` with everything in it – fine for a quick
  translation or for changing a few texts.

The code is a lower-case language code (two or three letters,
[ISO 639](https://www.loc.gov/standards/iso639-2/php/code_list.php)),
optionally followed by `-` and an upper-case region (`pt-BR`, `de-CH`), for
example `ru`, `uk` or `pt`.

### As a folder

1. Copy the folder [`apps/web/messages/en/`](../apps/web/messages/en/) and
   name the copy after the language, e.g. `ru/`. It contains:

   ```text
   ru/
     _meta.json      the language's name and writing direction
     common.json     texts used everywhere (skip link, Back, Continue)
     setup.json      the setup wizard
     errors.json     messages for invalid form fields
     toast.json      notifications
     …               one file per further area
   ```

   Each area file holds that area's texts directly, without repeating the
   area's name: `setup.json` starts with `{ "metaTitle": …, "title": … }`.
   A text is addressed as area plus key, e.g. `setup.steps.token.title` is
   `steps.token.title` in `setup.json`.
2. Set the language in `_meta.json`:

   ```json
   { "name": "Русский", "dir": "ltr" }
   ```

3. Translate the texts in the area files. Keep the keys (left side)
   unchanged and translate only the values. Area files you leave out are
   shown in English.

### As a single file

1. Create `<code>.json`, e.g. `ru.json`, with `_meta` and one key per area –
   the content of the area files from `apps/web/messages/en/`, each under
   its file name:

   ```json
   {
     "_meta": { "name": "Русский", "dir": "ltr" },
     "common": { "skipLink": "Перейти к содержимому", "back": "Назад", "continue": "Далее" },
     "setup": { "title": "Настройка Hexmark" }
   }
   ```

2. Translate the texts as above.

If both `ru.json` and `ru/` exist, the folder is used and the file is
ignored; the log says so.

### The language: `_meta`

- `name` – the language's name **in that language**; the language pickers
  show it. Required.
- `dir` – `"ltr"` (left to right) or `"rtl"` (right to left, e.g. Arabic or
  Hebrew). Applied to the whole page.

### Message format

Texts use [ICU MessageFormat](https://formatjs.github.io/docs/core-concepts/icu-syntax/):

- Placeholders such as `{length}` or `{current}` are filled in by the app.
  Keep them exactly as in English (you may move them within the sentence).
- Tags such as `<code>SETUP_TOKEN</code>` mark formatted parts. Keep the tag
  names; translate the text between them where it is not a technical name.
- Plurals and other forms your language needs are allowed where English uses
  a plain number placeholder, e.g.
  `{failed, plural, one {# check failed} few {# checks failed} many {# checks failed} other {# checks failed}}`.
  Every `plural` and `select` needs an `other` case.
- A literal `{` or `}` must be quoted: `'{'`.

### Partial translations

A translation does not have to be complete. Every text that is missing –
or that cannot be used, for example because of a syntax error or a
placeholder that does not exist in English – is shown in English instead.
Keys and area files that do not exist in English are ignored. In the folder
form, an area file that is not valid JSON is skipped on its own; the other
areas are still used.

### Region overlays

A translation with a region (`de-CH`, `pt-BR`) only needs the texts that
differ from its language, in either form: a file `de-CH.json`, or a folder
`de-CH/` with `_meta.json` and only the area files that differ. Missing
texts come from the language (`de`, `pt` – if there is one) and then from
English: `de-CH` → `de` → `en`. `_meta.name` is required (e.g.
`"Deutsch (Schweiz)"`); `_meta.dir` may be left out and is then taken from
the language.

### Changing built-in texts

A translation with the code of a built-in language (`en`, `de`) overrides
the built-in texts it contains; all others stay as shipped. It only needs
`_meta` and the texts you want to change – a single file is usually the
simplest way.

## Check a translation

From a clone of the repository:

```sh
pnpm check:translations locales/ru.json   # a single file
pnpm check:translations locales/ru        # a folder
# or every translation in a folder, listing every missing key:
pnpm check:translations --all locales/
```

The report says, per translation, which texts are missing (shown in
English), which keys are unknown, and which texts cannot be used and why; in
the folder form each finding names its area file (`setup.json:
steps.token.intro: …`). It exits with code 1 only when a translation cannot
be used at all: a wrong name, invalid JSON (of a single file or of
`_meta.json`) or no `_meta.name`.

Without arguments, `pnpm check:translations` checks the built-in
translations in `apps/web/messages/` strictly – any difference from English,
in any area file, is an error. `pnpm build` runs this check, and so does the
image build.

## Use it with Docker

Both compose files mount the folder `locales/` next to them read-only into
the web container:

```yaml
  web:
    volumes:
      - ./locales:/app/locales/custom:ro
```

1. Put your translations – files or folders – into `locales/` (next to
   `compose.yaml`). If the folder does not exist, Docker creates it empty on
   the first start.
2. Restart the web container – translations are read only when it starts:

   ```sh
   docker compose restart web
   ```

   (After updating `compose.yaml` itself, run `docker compose up -d` once so
   the container is recreated with the volume.)

3. Check the log; every translation or area file that was skipped, and
   every text that falls back, is listed there with the reason:

   ```sh
   docker compose logs web | grep '\[locales\]'
   ```

   ```text
   [locales] skipped custom/fr.json: not valid JSON (Expected property name or '}' in JSON at position 45 (line 1 column 46))
   [locales] ignored custom/uk.json: custom/uk/ exists as well and is used for uk
   [locales] skipped custom/ru/toast.json: not valid JSON (…); its messages fall back
   [locales] ru (custom/ru/): 12 keys missing, shown in English
   [locales] available: de (Deutsch), en (English), ru (Русский, custom)
   ```

The folder inside the container is set by `HEXMARK_LOCALES_DIR` (default
`/app/locales/custom`); mount a different host folder by changing the left
side of the volume. Without Docker (`pnpm dev`), translations are read from
`locales/` at the repository root.

The pickers list every available language by its `_meta.name`, in three
blocks: the browser's language first (marked "Browser language"), then
languages added on this server (a custom translation for a language Hexmark
does not ship, marked "Added on this server"), then all others, each block sorted
by name. A translation that overrides a built-in language (`de`) or adds a
region of one (`de-CH`) stays among the others. With more than five
languages the pickers switch to a compact list with one group per block.

## Contribute a translation

Pull requests are not accepted (see
[CONTRIBUTING.md](../.github/CONTRIBUTING.md)), but translations are welcome
as issues: open an issue, attach your translation (the `<code>.json` file,
or the `<code>/` folder as a zip) and mention the output of
`pnpm check:translations <file-or-folder>`. A translation that is taken over
becomes a built-in language in a later release.
