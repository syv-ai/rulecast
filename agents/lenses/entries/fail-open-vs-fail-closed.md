<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Fail Open vs Fail Closed

`fail-open-vs-fail-closed` · practices, design

For each place where a check or a dependency can fail, decide on purpose whether failure lets things through (fail open) or stops them (fail closed), and make the code do that; the anti-pattern is leaving it to whatever the error path happens to do.

*Names:* Also called fail-safe vs fail-secure (locks and physical engineering: a fail-safe door unlocks on power loss, a fail-secure door locks), and fail-safe defaults on the security side. The word "fail-safe" points in opposite directions in the two traditions: for doors it means fail open, for access control it means deny. Saltzer and Schroeder's "The Protection of Information in Computer Systems" (1975) made fail-safe defaults (deny unless access is explicitly granted) a design principle, crediting E. Glaser (1965).

*Matters most for:* cli-devtool, plugin-host, plugins-extensions, web-api, distributed, platforms

## But

Both directions are legitimate; the principle is to choose, not to prefer one. The choice is per surface, not per codebase, and one tool can need both: a hook that blocks an edit on a confirmed finding (closed) but lets the edit through when the hook itself crashes (open). Failing open is only honest if the failure is still reported somewhere visible; silent fail-open is swallowing. For small internal scripts the distinction rarely matters.

## Quality axes

- **security** ⊕ (primary): Security checks are decided to fail closed, so an exception in a policy lookup can't fall through to "allowed".
- **reliability** ⊕ (primary): Optional dependencies and tooling inside someone else's workflow are decided to fail open, so their own crash doesn't take the host or product down.
- **delivery** −: Every check or dependency that can fail needs a deliberate choice and an error path written to match.

**Flips:** Failing open on everything for availability turns security "-". Failing closed on everything turns reliability "-" when a flaky optional dependency is down. Failing open without reporting it is swallowing errors.

## Warranted when

- Security checks (authentication, authorization, input validation, signature checks) must fail closed, because failing open is a bypass.
- Tooling that runs inside someone else's workflow (agent hooks, git hooks, editor plugins, observability agents) usually must fail open: its own bug must not block the host's work.
- Availability-critical paths where a down dependency would otherwise take the whole product down.
- Error paths that are rarely exercised, so their default behaviour is accidental.

## How it shows

- Authorization code where an exception in the policy lookup falls through to "allowed".
- A rate limiter, feature flag client or license check whose behaviour when its backend is down nobody has written down.
- A linter hook, telemetry call or plugin whose own crash blocks the editor, build or commit it runs inside.
- A circuit breaker or fallback with a default value, and no comment on why that default is safe.
- Different defaults for the same kind of failure in different modules.

## Overdone when

- Failing open on everything for availability, including checks that guard money, data or access.
- Failing closed on everything for safety, so a flaky optional dependency takes the product down.
- Treating "the check found a problem" and "the check itself broke" as the same thing; a tool can fail open on its own crash and still fail closed on a real finding.

## Example

Before:

```
fn can_download(user, report) -> bool:
    try:
        return policy_service.allows(user, "download", report.id)
    except ServiceError:
        return True             # nobody decided this; it just made the error go away

fn run_lint_hook(edit):
    findings = lint(edit)       # a crash here aborts the user's edit
    return block_if(findings)
```

After:

```
fn can_download(user, report) -> bool:
    try:
        return policy_service.allows(user, "download", report.id)
    except ServiceError as e:
        log.error("policy check failed, denying", e)
        return False            # access control fails closed

fn run_lint_hook(edit):
    try:
        findings = lint(edit)
    except Exception as e:
        report_internal_error(e)
        return ALLOW            # the tool's own bug fails open; real findings still block
    return block_if(findings)
```

Each surface now states its failure direction, closed for access and open for a tool that must not block its host, and both still report the error.

## By language

**go:** The zero value of a bool is false, so `allowed, _ := check()` fails closed by accident and `denied, _ := check()` fails open by accident. Name results so the zero value is the safe one.

**python:** A broad except around an authorization call that returns True is the classic fail-open bug. For a fail-open boundary, catch at the outermost layer only and log the traceback.

**typescript:** A rejected promise in middleware that isn't awaited can let the request continue to the handler. Make sure the deny path is the one taken when the check throws.

## Related

[Fail Fast](fail-fast.md) · [Swallowed Errors](swallowed-errors.md) · [Error Handling Policy](error-handling-policy.md) · [Postel's Law](postels-law.md) · [Murphy's Law](murphys-law.md)

## Overlaps

secure-by-default and least-privilege set what is allowed without asking. fail-open-vs-fail-closed is the separate decision of what happens when a check itself fails; tooling and security often answer it differently.

## In the interview

- [Ask what would hurt most if it went wrong, and work back to the conventions that stop it.](../THINKING.md#start-from-failure)

## Sources

- [Jerome Saltzer and Michael Schroeder, The Protection of Information in Computer Systems (1975), fail-safe defaults](https://www.cs.virginia.edu/~evans/cs551/saltzer/) (recalled)
- [OWASP Secure by Design / Security by Design Principles, fail securely](https://owasp.org/www-project-developer-guide/) (recalled)
- [Michael Nygard, Release It! (2nd ed.), stability patterns (circuit breaker, fail fast, steady state)](https://pragprog.com/titles/mnee2/release-it-second-edition/) (recalled)
