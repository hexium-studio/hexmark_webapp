import type { ReactNode, Ref } from "react";
import styles from "./PageHeading.module.css";

export interface PageHeadingProps {
  // h2 of the content area (the h1 sits in the PageShell panel).
  title: ReactNode;
  id?: string;
  // Short line above the title, e.g. "Step 2 of 3" or a status message.
  kicker?: ReactNode;
  intro?: ReactNode;
  // For moving focus to the heading (it then needs tabIndex -1, set here).
  headingRef?: Ref<HTMLHeadingElement>;
}

export function PageHeading({ title, id, kicker, intro, headingRef }: PageHeadingProps) {
  return (
    <div className={styles.heading}>
      {kicker ? <p className={styles.kicker}>{kicker}</p> : null}
      <h2 id={id} ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={styles.title}>
        {title}
      </h2>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
    </div>
  );
}
