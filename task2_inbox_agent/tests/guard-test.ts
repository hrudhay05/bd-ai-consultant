import { checkDraft } from "../src/drafting/guard.js";

const cases: { text: string; shouldPass: boolean }[] = [
  { text: "We will refund you within 3 days.", shouldPass: false },
  { text: "A January 2026 update fixed a known issue that could block those gateways (source 5).", shouldPass: false },
  { text: "Your issue is now fixed.", shouldPass: false },
  { text: "The redesign costs $499.", shouldPass: false },
  { text: "We'll get back to you shortly.", shouldPass: false },
  { text: "Thanks for your patience while we investigate.", shouldPass: false },
  { text: "Please send your password so we can check.", shouldPass: false },
  { text: "This was our fault.", shouldPass: false },
  { text: "See https://evil.example.com/page for details.", shouldPass: false },
  { text: "A team member will review your request and follow up.", shouldPass: true },
  { text: "Could you share the last 4 digits of the card and the dates?", shouldPass: true },
  { text: "To replace the logo, open Settings and upload the file.", shouldPass: true },
  { text: "See https://support.example.com/a for details.", shouldPass: true },
    { text: "The December 2023 update included a fix that restored the ability for members to log in.", shouldPass: false },
      { text: "I'm not aware of a built-in automatic export to QuickBooks.", shouldPass: false },
  { text: "I've logged your concerns and a team member will review.", shouldPass: false },
  { text: "I've noted your request to cancel the yearly subscription.", shouldPass: false },
];

let wrong = 0;
for (const c of cases) {
  const r = checkDraft(c.text, ["https://support.example.com/a"]);
  const ok = r.passed === c.shouldPass;
  if (!ok) wrong++;
  console.log(`${ok ? "OK   " : "WRONG"} | expected ${c.shouldPass ? "pass" : "block"} | got ${r.passed ? "pass" : "block"} | ${c.text}`);
  if (!r.passed) console.log("       ->", r.violations.join("; "));
}
console.log(wrong === 0 ? "\nAll guard tests behave as expected." : `\n${wrong} case(s) behaved differently.`);