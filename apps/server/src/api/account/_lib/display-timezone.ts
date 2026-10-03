import { eq } from "drizzle-orm";
import { getDb } from "../../../db/client";
import { instanceSettings, users } from "../../../db/schema";

// The time zone an account's dates are shown in: the account's own choice,
// else the instance default, else UTC (before setup wrote the settings row).
export async function displayTimezone(userId: string): Promise<string> {
  const db = getDb();
  const [user] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.timezone) return user.timezone;
  const [settings] = await db
    .select({ timezone: instanceSettings.defaultTimezone })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1));
  return settings?.timezone ?? "UTC";
}
