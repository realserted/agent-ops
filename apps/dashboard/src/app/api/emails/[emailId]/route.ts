import { NextResponse } from "next/server";
import { inboxForRequests } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

/** Matches the hardened email_id schema the tools enforce. */
const EMAIL_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * One email, so the UI can show what an extraction or an approval refers to.
 *
 * The id is validated here as well as in the tools: this route reaches the
 * mailbox directly, so it does not inherit the tools' argument hardening.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ emailId: string }> }) {
  const { emailId } = await params;
  if (!EMAIL_ID.test(emailId)) {
    return NextResponse.json({ error: "Invalid email id." }, { status: 400 });
  }

  try {
    const email = await (await inboxForRequests()).get(emailId);
    if (!email) return NextResponse.json({ error: "No such email." }, { status: 404 });
    return NextResponse.json({ email });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read the mailbox." },
      { status: 502 },
    );
  }
}
