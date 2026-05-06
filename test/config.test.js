import { describe, it, expect } from "vitest";
import config from "../src/config.js";

const { mergeConfig, DEFAULT_CONFIG, parseHostEntry, hostEntryToMatchPattern } = config;

describe("mergeConfig", () => {
  it("falls back to DEFAULT_CONFIG when both sides are empty", () => {
    const result = mergeConfig({}, {});
    expect(result.rules).toEqual(DEFAULT_CONFIG.rules);
    expect(result.hosts).toEqual(DEFAULT_CONFIG.hosts);
    expect(result.openInNewTab).toBe(DEFAULT_CONFIG.openInNewTab);
  });

  it("uses user rules when no managed rules are set", () => {
    const user = { rules: [{ regex: "FOO-\\d+", template: "https://x/{id}" }] };
    expect(mergeConfig({}, user).rules).toEqual(user.rules);
  });

  it("concatenates managed rules then user rules", () => {
    const managed = { rules: [{ regex: "M-\\d+", template: "https://m/{id}" }] };
    const user = { rules: [{ regex: "U-\\d+", template: "https://u/{id}" }] };
    expect(mergeConfig(managed, user).rules).toEqual([
      ...managed.rules,
      ...user.rules
    ]);
  });

  it("returns only managed rules when lockRules is true", () => {
    const managed = {
      rules: [{ regex: "M-\\d+", template: "https://m/{id}" }],
      lockRules: true
    };
    const user = { rules: [{ regex: "U-\\d+", template: "https://u/{id}" }] };
    expect(mergeConfig(managed, user).rules).toEqual(managed.rules);
  });

  it("uses user hosts when no managed hosts are set", () => {
    const user = { hosts: ["gitlab.example.com"] };
    expect(mergeConfig({}, user).hosts).toEqual(["gitlab.example.com"]);
  });

  it("dedupes hosts when managed and user overlap", () => {
    const managed = { hosts: ["github.com", "github.example.com"] };
    const user = { hosts: ["github.com", "gitlab.example.com"] };
    expect(mergeConfig(managed, user).hosts).toEqual([
      "github.com",
      "github.example.com",
      "gitlab.example.com"
    ]);
  });

  it("returns only managed hosts when lockHosts is true", () => {
    const managed = { hosts: ["github.example.com"], lockHosts: true };
    const user = { hosts: ["gitlab.example.com"] };
    expect(mergeConfig(managed, user).hosts).toEqual(["github.example.com"]);
  });

  it("falls back to default hosts when neither side supplies any", () => {
    const result = mergeConfig({}, { rules: [{ regex: "X", template: "{id}" }] });
    expect(result.hosts).toEqual(DEFAULT_CONFIG.hosts);
  });

  it("lets managed openInNewTab override user", () => {
    const out = mergeConfig({ openInNewTab: false }, { openInNewTab: true });
    expect(out.openInNewTab).toBe(false);
  });

  it("uses user openInNewTab when managed is unset", () => {
    expect(mergeConfig({}, { openInNewTab: false }).openInNewTab).toBe(false);
  });

  it("exposes _managed metadata describing what policy supplied", () => {
    const managed = {
      rules: [{ regex: "M-\\d+", template: "https://m/{id}" }],
      hosts: ["github.example.com"],
      openInNewTab: true,
      lockRules: false,
      lockHosts: true
    };
    expect(mergeConfig(managed, {})._managed).toEqual({
      rules: managed.rules,
      hosts: managed.hosts,
      openInNewTab: true,
      lockRules: false,
      lockHosts: true
    });
  });

  it("reports openInNewTab as null in _managed when policy did not set it", () => {
    expect(mergeConfig({}, {})._managed.openInNewTab).toBeNull();
  });

  it("ignores non-array rules/hosts in either side", () => {
    const result = mergeConfig({ rules: "nope", hosts: 42 }, { rules: null, hosts: undefined });
    expect(result.rules).toEqual(DEFAULT_CONFIG.rules);
    expect(result.hosts).toEqual(DEFAULT_CONFIG.hosts);
  });
});

describe("parseHostEntry", () => {
  it("parses bare hostnames", () => {
    expect(parseHostEntry("github.com")).toEqual({ host: "github.com", path: "" });
  });

  it("parses hostname with path", () => {
    expect(parseHostEntry("github.com/myorg")).toEqual({
      host: "github.com",
      path: "/myorg"
    });
  });

  it("parses hostname with nested path", () => {
    expect(parseHostEntry("github.com/myorg/repo")).toEqual({
      host: "github.com",
      path: "/myorg/repo"
    });
  });

  it("lowercases input", () => {
    expect(parseHostEntry("GitHub.com/MyOrg")).toEqual({
      host: "github.com",
      path: "/myorg"
    });
  });

  it("rejects entries with query strings", () => {
    expect(parseHostEntry("github.com/myorg?ref=x")).toBeNull();
  });

  it("rejects entries with fragments", () => {
    expect(parseHostEntry("github.com/myorg#section")).toBeNull();
  });

  it("rejects entries with whitespace in path", () => {
    expect(parseHostEntry("github.com/my org")).toBeNull();
  });

  it("rejects single-label hostnames", () => {
    expect(parseHostEntry("localhost")).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseHostEntry(null)).toBeNull();
    expect(parseHostEntry(undefined)).toBeNull();
    expect(parseHostEntry(42)).toBeNull();
  });
});

describe("hostEntryToMatchPattern", () => {
  it("expands a bare hostname to *://host/*", () => {
    expect(hostEntryToMatchPattern("github.com")).toBe("*://github.com/*");
  });

  it("appends /* to a path entry", () => {
    expect(hostEntryToMatchPattern("github.com/myorg")).toBe(
      "*://github.com/myorg/*"
    );
  });

  it("treats trailing slash and trailing star as equivalent to bare path", () => {
    expect(hostEntryToMatchPattern("github.com/myorg/")).toBe(
      "*://github.com/myorg/*"
    );
    expect(hostEntryToMatchPattern("github.com/myorg/*")).toBe(
      "*://github.com/myorg/*"
    );
  });

  it("collapses bare hostname with trailing slash", () => {
    expect(hostEntryToMatchPattern("github.com/")).toBe("*://github.com/*");
  });

  it("returns null for invalid entries", () => {
    expect(hostEntryToMatchPattern("not a host")).toBeNull();
    expect(hostEntryToMatchPattern("github.com/foo?x=1")).toBeNull();
  });
});
