import { saveEmail, saveDraft } from "../src/feedback/db.js";

for (const n of [1, 2]) {
  const emailId = `SIM-UI-${n}`;
  saveEmail({
    id: emailId,
    from_name: "Test User",
    from_email: "test@example.com",
    subject: `SIMULATED edit-test email ${n}`,
    body: "This is a simulated email used only to test the review page. It is not a real customer email.",
  });
  const id = saveDraft({
    email_id: emailId,
    status: "draft_ready",
    category: "follow_up",
    urgency: "normal",
    risk: "medium",
    evidence_mode: "none",
    reply_subject: "Re: SIMULATED edit-test email",
    reply_body:
      "Hi Test, I can't see earlier messages or tickets from this email. A team member will check and reply to you.\n\nBrilliant Directories Support",
    needs_expert: false,
    guard_passed: true,
    guard_violations: [],
    attempts: 1,
    model: "simulation",
    classifier_version: "none",
    drafter_version: "none",
  });
  console.log("created draft", id);
}