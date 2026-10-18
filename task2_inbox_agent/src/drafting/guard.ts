export interface GuardResult {
  passed: boolean;
  violations: string[];
}

const RULES: { name: string; pattern: RegExp }[] = [
  {
    name: "mentions a price or money amount",
    pattern: /[$\u20AC\u00A3\u20B9]\s?\d|\b\d[\d,.]*\s?(?:usd|eur|gbp|inr|dollars?|euros?|pounds?|rupees)\b/i,
  },
  {
    name: "promises or approves a refund",
    pattern:
      /\b(?:we|i)(?:['\u2019]ll| will) (?:refund|reimburse|credit)\b|\byou(?: will|['\u2019]ll) (?:receive|get) (?:a |your |the )?(?:refund|money back|reimbursement)\b|\brefund (?:has been|is|was|will be) (?:approved|processed|issued|granted|sent)\b|\byour refund (?:is|will)\b/i,
  },
  {
    name: "claims something is done or fixed",
    pattern:
      /\b(?:has|have|had) been (?:fixed|resolved|corrected|restored|refunded|approved|cancel+ed)\b|\b(?:is|are) now (?:fixed|resolved|working|cancel+ed|refunded)\b|\bwe(?: have|['\u2019]ve) (?:fixed|resolved|restored|refunded|approved|cancel+ed)\b/i,
  },
  {
    name: "mentions what an update or changelog fixed",
    pattern: /\b(?:update|release|patch|changelog)\b[^.]{0,80}\b(?:fix|fixed|fixes)\b/i,
  },
  {
    name: "promises a time frame or date",
    pattern:
      /\bwithin\s+\d+\s*(?:business\s+)?(?:hours?|days?|weeks?)\b|\bin\s+\d+\s*(?:business\s+)?(?:hours?|days?|weeks?)\b|\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|end of (?:the )?(?:day|week))\b/i,
  },
  {
    name: "vague speed promise (shortly, as soon as possible)",
    pattern: /\b(?:shortly|as soon as possible|right away|immediately|asap)\b/i,
  },
  {
    name: "says an investigation is already under way",
    pattern:
      /\bwhile we (?:investigate|look into)\b|\b(?:we(?: are|['\u2019]re)|our team (?:is|are)) (?:currently |now )?(?:investigating|looking into|working on|reviewing)\b/i,
  },
  {
    name: "claims something was logged, noted or forwarded",
    pattern: /\b(?:i|we)(?:['\u2019]ve| have) (?:logged|noted|recorded|escalated|forwarded|passed)\b/i,
  },
  {
    name: "says a feature or integration does or does not exist without evidence",
    pattern:
      /\b(?:i['\u2019]m|i am|we(?:['\u2019]re| are)) not aware of\b|\bthere is no (?:such |built.?in )?(?:feature|integration|option)\b|\bwe do(?: not|n['\u2019]t) (?:offer|support|have) (?:a |an )?(?:built.?in )?(?:integration|feature)\b/i,
  },
  {
    name: "offers compensation or a discount",
    pattern: /\b(?:discount|compensation|compensate|free of charge|free month|account credit|goodwill)\b/i,
  },
  {
    name: "admits fault, blames, or makes a security claim",
    pattern:
      /\bour (?:fault|mistake|error)\b|\bwe (?:are|were) (?:at fault|responsible)\b|\b(?:was|has been|were) (?:hacked|compromised|breached)\b|\bis (?:fully )?secure\b/i,
  },
  {
    name: "asks for a password or full card number",
    pattern: /\bplease (?:send|share|provide|reply with) (?:us |me )?(?:your|the) (?:password|passcode|cvv|full card number)/i,
  },
  {
    name: "mentions internal source numbers",
    pattern: /\(?\bsources?\s+\d+\b\)?/i,
  },
];

export function checkDraft(body: string, allowedUrls: string[]): GuardResult {
  const violations: string[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(body)) violations.push(rule.name);
  }
  const urls = body.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (!allowedUrls.includes(url)) violations.push(`link not returned by the knowledge service: ${url}`);
  }
  return { passed: violations.length === 0, violations };
}