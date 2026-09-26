import { z } from "zod";

/**
 * Public (browser-exposed) configuration. Secrets never belong here: no private keys, no deployer keys,
 * no paid RPC credentials that must stay private.
 *
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` when referenced literally, so the app passes a literal
 * object into `parsePublicEnv` instead of `process.env` itself.
 */
export const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: z.enum(["development", "testnet", "production"]).default("development"),
    NEXT_PUBLIC_ENABLE_ANVIL: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined)),
    NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.url().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.NEXT_PUBLIC_APP_ENV === "production" && env.NEXT_PUBLIC_ENABLE_ANVIL) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_ENABLE_ANVIL"],
        message: "Anvil must be disabled in production builds.",
      });
    }
  });

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid public environment configuration — ${details}`);
  }
  return result.data;
}
