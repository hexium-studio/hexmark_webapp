import { StatusIcon } from "@/components/status-icon/StatusIcon";
import styles from "./Security.module.css";

// Heading of a section and its state ("On", "2 keys") on one line while
// they fit; the state carries a check mark when on, not colour alone. The
// heading takes focus when a set-up in the section ends (useFocusOnClose).
export function SectionHead(props: { id: string; title: string; status: string; on: boolean }) {
  return (
    <div className={styles.sectionHead}>
      <h2 id={props.id} tabIndex={-1} className={styles.sectionTitle}>
        {props.title}
      </h2>
      <p className={styles.state} data-on={props.on || undefined}>
        {props.on ? <StatusIcon kind="pass" className={styles.stateIcon} /> : null}
        <span>{props.status}</span>
      </p>
    </div>
  );
}
