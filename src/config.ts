import { readFileSync } from "node:fs";
import { z } from "zod";
import type { PermissionMode } from "./types.js";

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_WRITE_TOKEN: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().regex(/^\d+$/).optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().regex(/^\d+$/).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  GITHUB_PERMISSION_MODE: z.enum(["read", "write"]).default("read"),
  GITHUB_API_URL: z.string().url().default("https://api.github.com")
});

export interface Config {
  permissionMode: PermissionMode;
  baseUrl: string;
  pat?: string;
  writePat?: string;
  app?: {
    appId: number;
    installationId: number;
    privateKey: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const privateKey = parsed.GITHUB_APP_PRIVATE_KEY_PATH
    ? readFileSync(parsed.GITHUB_APP_PRIVATE_KEY_PATH, "utf8")
    : parsed.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const appParts = [
    parsed.GITHUB_APP_ID,
    parsed.GITHUB_APP_INSTALLATION_ID,
    privateKey
  ];
  const hasAnyAppPart = appParts.some(Boolean);
  const hasAllAppParts = appParts.every(Boolean);

  if (hasAnyAppPart && !hasAllAppParts) {
    throw new Error(
      "GitHub App authentication requires GITHUB_APP_ID, " +
        "GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY or " +
        "GITHUB_APP_PRIVATE_KEY_PATH."
    );
  }

  if (!parsed.GITHUB_TOKEN && !hasAllAppParts) {
    throw new Error(
      "Set GITHUB_TOKEN, or configure all GitHub App authentication variables."
    );
  }

  const config: Config = {
    permissionMode: parsed.GITHUB_PERMISSION_MODE,
    baseUrl: parsed.GITHUB_API_URL
  };

  if (parsed.GITHUB_TOKEN) config.pat = parsed.GITHUB_TOKEN;
  if (parsed.GITHUB_WRITE_TOKEN) config.writePat = parsed.GITHUB_WRITE_TOKEN;
  if (hasAllAppParts) {
    config.app = {
      appId: Number(parsed.GITHUB_APP_ID),
      installationId: Number(parsed.GITHUB_APP_INSTALLATION_ID),
      privateKey: privateKey!
    };
  }
  return config;
}
