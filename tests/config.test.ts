import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { requireWrite } from "../src/permissions.js";

describe("configuration", () => {
  it("defaults PAT authentication to read-only", () => {
    const config = loadConfig({ GITHUB_TOKEN: "github_pat_test" });
    expect(config.permissionMode).toBe("read");
    expect(config.pat).toBe("github_pat_test");
  });

  it("accepts complete GitHub App authentication", () => {
    const config = loadConfig({
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY: "line-one\\nline-two",
      GITHUB_PERMISSION_MODE: "write"
    });
    expect(config.app).toEqual({
      appId: 123,
      installationId: 456,
      privateKey: "line-one\nline-two"
    });
    expect(config.permissionMode).toBe("write");
  });

  it("rejects incomplete GitHub App configuration", () => {
    expect(() => loadConfig({ GITHUB_APP_ID: "123" })).toThrow(
      /requires GITHUB_APP_ID/
    );
  });
});

describe("write gate", () => {
  it("blocks mutations in read mode", () => {
    expect(() => requireWrite("read", "add_labels")).toThrow(
      /GITHUB_PERMISSION_MODE/
    );
  });

  it("allows mutations only in write mode", () => {
    expect(() => requireWrite("write", "add_labels")).not.toThrow();
  });
});
