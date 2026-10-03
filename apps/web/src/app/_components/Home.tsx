import type { AuthUser } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/button/ButtonLink";
import { CardShell } from "@/components/card-shell/CardShell";
import { FormAlert } from "@/components/form-alert/FormAlert";
import { roleLabelKey } from "@/lib/roles";
import styles from "./Home.module.css";
import { ClaimHeadingFocus } from "./heading-focus";
import { SignOutButton } from "./SignOutButton";

const HOME_TITLE_ID = "home-title";

export interface HomeProps {
  user: AuthUser;
  // The account has no second factor: a note leads to the security page.
  twoFactorMissing: boolean;
}

// Home of a signed-in user: greeting, role, the way to the security page
// and "Sign out". No language picker here: a signed-in user's saved language
// wins over the picker's cookie (lib/locales/resolve-locale.ts), so a picker
// would change nothing.
export function Home({ user, twoFactorMissing }: HomeProps) {
  const t = useTranslations("home");
  const tRoles = useTranslations("roles");
  return (
    <CardShell
      title={t("greeting", { name: user.displayName })}
      titleId={HOME_TITLE_ID}
      lead={t.rich("role", {
        role: tRoles(roleLabelKey(user.role)),
        strong: (chunks) => <strong className={styles.role}>{chunks}</strong>,
      })}
    >
      <ClaimHeadingFocus targetId={HOME_TITLE_ID} />
      {twoFactorMissing ? (
        <FormAlert
          tone="info"
          title={t("twoFactorMissing.title")}
          actions={<ButtonLink href="/account/security">{t("twoFactorMissing.link")}</ButtonLink>}
        >
          <p>{t("twoFactorMissing.detail")}</p>
        </FormAlert>
      ) : null}
      <div className={styles.actions}>
        {twoFactorMissing ? null : (
          <ButtonLink variant="secondary" href="/account/security">
            {t("securityLink")}
          </ButtonLink>
        )}
        <SignOutButton />
      </div>
    </CardShell>
  );
}
