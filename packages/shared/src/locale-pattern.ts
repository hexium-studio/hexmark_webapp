// The form of a UI locale code: BCP 47 language with an optional region, e.g.
// "en", "de", "pt-BR", "de-CH". Kept in its own file without imports so that
// tools/check-translations.mjs can load it with plain Node (type stripping)
// as well; everything else imports it through locale.ts.
// The database check constraints on users.locale and
// instance_settings.default_locale (apps/server/src/db/schema/) spell out the
// same pattern in SQL; changing it here needs a migration as well.
export const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;
