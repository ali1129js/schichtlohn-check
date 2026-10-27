import type { RuleValue } from "@/rules/defaults";

/** Shows where a default comes from. Unconfirmed values always get a visible badge. */
export function RuleBadge({ rule, compact }: { rule: RuleValue<unknown>; compact?: boolean }) {
  return (
    <span className="rule-badges">
      {rule.status === "likely" ? (
        <span className="badge badge--blue" title={`Likely, not proven. ${rule.note ?? ""}`}>
          likely
        </span>
      ) : rule.verified ? (
        <span className="badge badge--green" title={`Verified ${rule.asOf}: ${rule.source}`}>
          verified
        </span>
      ) : (
        <span className="badge badge--amber" title={`Not confirmed from an official source. ${rule.note ?? ""}`}>
          unconfirmed
        </span>
      )}
      {rule.kind === "maximum" && (
        <span className="badge badge--blue" title="The tariff/law sets an upper limit; your actual rate can be lower.">
          maximum
        </span>
      )}
      {!compact && rule.sourceUrl && (
        <a className="small" href={rule.sourceUrl} target="_blank" rel="noreferrer noopener">
          source
        </a>
      )}
    </span>
  );
}

export function RuleNote({ rule }: { rule: RuleValue<unknown> }) {
  return (
    <p className="small muted">
      {rule.source} (checked {rule.asOf}).{rule.note ? ` ${rule.note}` : ""}
    </p>
  );
}
