import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export async function createAuth(databaseUrl: string, baseURL: string, secret: string) {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = await import("postgres");
  const sql = postgres.default(databaseUrl);
  const db = drizzle(sql);

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    baseURL,
    secret,
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        displayName: {
          type: "string",
          required: false,
          returned: true,
        },
      },
    },
  });
}
