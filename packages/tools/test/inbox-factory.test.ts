import { describe, expect, it } from "vitest";
import { createInbox, loadInbox } from "../src/inbox-factory";
import { FixtureInbox } from "../src/adapters/fixture-inbox";
import { ImapInbox } from "../src/adapters/imap-inbox";

const IMAP_ENV = {
  GMAIL_IMAP_USER: "ops@example.test",
  GMAIL_IMAP_APP_PASSWORD: "app-password-1234",
};

describe("createInbox", () => {
  // Reading someone's real mail is never what happens by accident.
  it("defaults to the fixture inbox when nothing is configured", () => {
    const choice = createInbox({});

    expect(choice.inbox).toBeInstanceOf(FixtureInbox);
    expect(choice.live).toBe(false);
    expect(choice.description).toBe("fixture inbox");
  });

  it("selects IMAP when both variables are set", () => {
    const choice = createInbox(IMAP_ENV);

    expect(choice.inbox).toBeInstanceOf(ImapInbox);
    expect(choice.live).toBe(true);
    expect(choice.description).toContain("ops@example.test");
  });

  it("names the mailbox in the description when one is configured", () => {
    const choice = createInbox({ ...IMAP_ENV, GMAIL_IMAP_MAILBOX: "[Gmail]/All Mail" });

    expect(choice.description).toContain("[Gmail]/All Mail");
  });

  // A half-configured environment silently triaging fixtures looks like it
  // worked, which is worse than failing.
  it.each([
    ["only the user", { GMAIL_IMAP_USER: "ops@example.test" }, "GMAIL_IMAP_APP_PASSWORD"],
    ["only the password", { GMAIL_IMAP_APP_PASSWORD: "pw" }, "GMAIL_IMAP_USER"],
  ])("errors when %s is set, naming what is missing", (_label, env, missing) => {
    expect(() => createInbox(env)).toThrow(new RegExp(`Missing ${missing}`));
  });

  it("treats blank values as unset", () => {
    expect(createInbox({ GMAIL_IMAP_USER: "   ", GMAIL_IMAP_APP_PASSWORD: "" }).live).toBe(false);
  });

  it("never puts the app password in an error message", () => {
    const secret = "super-secret-app-password";
    try {
      createInbox({ GMAIL_IMAP_APP_PASSWORD: secret });
      expect.unreachable("expected createInbox to throw");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("loadInbox", () => {
  it("reads the fixture file when no IMAP config is present", async () => {
    const { inbox, live } = await loadInbox({});

    expect(live).toBe(false);
    expect((await inbox.list(50)).length).toBeGreaterThan(0);
  });

  it("returns the IMAP adapter without touching the network", async () => {
    const { inbox, live } = await loadInbox(IMAP_ENV);

    expect(live).toBe(true);
    expect(inbox).toBeInstanceOf(ImapInbox);
  });
});
