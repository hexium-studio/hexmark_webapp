"use client";

import type { McpServersConfig } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/button/Button";
import { CopyButton } from "@/components/two-factor/CopyButton";
import styles from "./Tokens.module.css";

const HEADING_ID = "tokens-created";
const CONFIG_ID = "tokens-created-config";

export interface CreatedTokenProps {
  name: string;
  config: McpServersConfig;
  onDone(): void;
}

// The new token, shown this one time as the MCP client configuration in
// the standard mcpServers format. The translated hint stands above the
// block and is not part of what "Copy" copies: only the JSON is. Long
// values wrap inside the block instead of widening the page; the copied
// text is the unwrapped JSON. The heading takes focus so screen readers
// start here.
export function CreatedToken({ name, config, onDone }: CreatedTokenProps) {
  const t = useTranslations("tokens.created");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const json = JSON.stringify(config, null, 2);
  return (
    <section className={styles.section} aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} ref={heading} tabIndex={-1} className={styles.sectionTitle}>
        {t("heading", { name })}
      </h2>
      <p className={styles.notice}>
        <strong>{t("warningTitle")}</strong> {t("warning")}
      </p>
      <p className={styles.muted}>{t("hint")}</p>
      <pre id={CONFIG_ID} className={styles.config}>
        <code>{json}</code>
      </pre>
      <div className={styles.actions}>
        <CopyButton text={json} label={t("copy")} copiedTitle={t("copied")} />
        <Button onClick={onDone}>{t("done")}</Button>
      </div>
    </section>
  );
}
