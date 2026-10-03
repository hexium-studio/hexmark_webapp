import type { ReactNode } from "react";
import styles from "./PageShell.module.css";

export interface PageShellProps {
  // The page's only h1, shown in the side panel.
  title: string;
  lead?: ReactNode;
  // Further panel content below the lead, e.g. a StepList.
  progress?: ReactNode;
  // Controls at the foot of the panel, e.g. the LanguageSwitch.
  tools?: ReactNode;
  children: ReactNode;
}

// Split page (setup, later sign-in): a tinted side
// panel with wordmark, title and progress, the content on the right. In
// narrow windows or with large text the panel becomes a compact header
// above the content. Renders <main id="main">, the target of the skip link
// in the root layout; the panel is the header of that main content.
export function PageShell({ title, lead, progress, tools, children }: PageShellProps) {
  return (
    <main id="main" className={styles.shell}>
      <div className={styles.layout}>
        <header className={styles.panel}>
          <p className={styles.wordmark}>Hexmark</p>
          <h1 className={styles.title}>{title}</h1>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
          {progress ? <div className={styles.progress}>{progress}</div> : null}
          {tools ? <div className={styles.tools}>{tools}</div> : null}
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}
