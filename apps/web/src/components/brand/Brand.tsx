import styles from "./Brand.module.css";

// The Hexmark brand: a petrol hexagon with an "H" cut into it, and the
// wordmark. The glyph is decoration (the wordmark names it), drawn inline so
// it follows the theme colours and needs no image request.
export function Brand() {
  return (
    <p className={styles.brand}>
      <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true">
        <path className={styles.hexagon} d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z" />
        <path className={styles.letter} d="M11.5 10v12M20.5 10v12M11.5 16h9" />
      </svg>
      <span className={styles.wordmark}>Hexmark</span>
    </p>
  );
}
