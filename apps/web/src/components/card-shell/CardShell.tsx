import type { ReactNode } from "react";
import { Brand } from "@/components/brand/Brand";
import styles from "./CardShell.module.css";

export interface CardShellProps {
  // The page's only h1.
  title: ReactNode;
  // Short status line above the title, e.g. "Sign-in blocked".
  kicker?: ReactNode;
  // Tone of the kicker; "danger" for a blocked state.
  kickerTone?: "accent" | "danger";
  lead?: ReactNode;
  // Id of the title, for moving focus to it (it then gets tabIndex -1).
  titleId?: string;
  // "form": sized to a short form (sign-in, home); "wide": room for longer
  // instructions with commands.
  width?: "form" | "wide";
  children?: ReactNode;
}

// Single-column page in one card centred on the page (sign-in, home, the
// blocked state): a tinted brand bar on top, then heading and content, a
// small version of the setup pages' split layout. In narrow windows or with
// large text the card frame falls away: the brand bar becomes the page
// header and the content runs full width.
// Renders <main id="main">, the target of the skip link in the root layout.
export function CardShell({
  title,
  kicker,
  kickerTone = "accent",
  lead,
  titleId,
  width = "form",
  children,
}: CardShellProps) {
  return (
    <main id="main" className={width === "wide" ? `${styles.shell} ${styles.wide}` : styles.shell}>
      <div className={styles.card}>
        <div className={styles.brandBar}>
          <Brand />
        </div>
        <div className={styles.body}>
          <div className={styles.heading}>
            {kicker ? <p className={`${styles.kicker} ${styles[kickerTone]}`}>{kicker}</p> : null}
            <h1 id={titleId} tabIndex={titleId ? -1 : undefined} className={styles.title}>
              {title}
            </h1>
            {lead ? <p className={styles.lead}>{lead}</p> : null}
          </div>
          {children ? <div className={styles.content}>{children}</div> : null}
        </div>
      </div>
    </main>
  );
}
