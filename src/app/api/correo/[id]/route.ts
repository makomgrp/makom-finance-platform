import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getEmailMessageById } from "@/lib/services/email-messages";

/**
 * ============================================================================
 * MILESTONE 26B-9A — ONE MESSAGE BODY
 * ============================================================================
 *
 * Bodies are fetched on demand rather than shipped with the list, because a
 * mailbox page carrying every body would put the whole inbox in the HTML
 * payload — including messages the reader never opens.
 *
 * IT READS THE DATABASE, NEVER THE MAIL SERVER. No IMAP connection is opened
 * to display a message; sync already stored it.
 *
 * AUTHORIZED THE SAME WAY THE PAGE IS. `email:manage`, then branch scope
 * re-checked inside the service against the LINKED CLIENT — knowing an id is
 * never authorization here. Out of scope returns 404 rather than 403: telling
 * an unauthorized caller that a message exists is itself the disclosure.
 *
 * The HTML in the response has already passed the server-side sanitiser.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.capabilities.includes("email:manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await getEmailMessageById(profile.branchScope, id, true);

  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (result.status === "error") {
    return NextResponse.json({ error: "error" }, { status: 500 });
  }

  return NextResponse.json(result.message);
}
