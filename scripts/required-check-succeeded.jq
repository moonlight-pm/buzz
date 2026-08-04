# Required checks are bound to the integration configured by the main ruleset.
# Ignore reruns started after merge so a retry observes the authorized evidence,
# not mutable post-merge state. DCO is the sole exception: that App reports a
# merged candidate a few seconds after merge even when the candidate was green.
[
  .[].check_runs[]
  | select(.name == $name and .app.id == $integration_id)
  | select(
      ((.completed_at // null) != null and .completed_at <= $merged_at)
      or ($name == "DCO Check" and ((.completed_at // "") | fromdateiso8601) <= (($merged_at | fromdateiso8601) + 300))
    )
]
| sort_by(.started_at // .created_at // "")
| last
| .status == "completed"
  and (
    .conclusion == "success"
    or .conclusion == "skipped"
    or .conclusion == "neutral"
  )
