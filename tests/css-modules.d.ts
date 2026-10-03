// Unit tests reach web modules that import CSS Modules for their types
// (e.g. CheckStatus.tsx); Next.js declares these for the web app itself.
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
