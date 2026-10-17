<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Slow Tests

`slow-tests` · smells, testing

The tests take so long that people stop running them on every change. Causes include Slow Component Usage (usually the database), a General Fixture, Asynchronous Test and Too Many Tests.

*Matters most for:* fullstack-web, databases-storage, data-pipeline, ml-training

## But

Some slow tests are worth their cost: integration tests against a real database container catch what fakes hide, and many teams (the test pyramid's critics among them) prefer those over heavy faking. The fix is usually to run them at a different cadence, not to delete or fake them away.

## Quality axes

- **change_cost** −: People stop running the suite on every change, so regressions are found late and further from their cause.
- **delivery** −: Every change waits on a long local or CI run before it can merge.

**Flips:** Integration tests against a real database catch what fakes hide and are worth their time; the fix is to run them at a different cadence, not to remove them.

## Why people fall into it

- code with no seam for the slow component
- async code where waiting looks like the only way to see the result
- the quick fix of a shared fixture, which trades speed for Erratic Tests

## How it shows

- fixed sleeps in test bodies waiting for threads, processes or queues
- unit tests that write to and read from a real database or network service
- a big fixture built fresh for every test
- a full suite that runs on every commit when a targeted subset would do

## Overcorrecting looks like

- faking every slow component, so nothing ever runs against the real database and integration bugs ship

## What to do

Replace slow components with fakes in unit tests, build a minimal fixture, test async logic synchronously via Humble Object, wait on conditions instead of sleeping, and split the suite into fast and slow tiers.

## Example

Before:

```
fn test_job_is_processed():
    queue = JobQueue(worker_threads = 2)
    queue.submit(ResizeImage("cat.png", width = 200))
    sleep(seconds(3))
    assert queue.completed_count() == 1
```

After:

```
fn test_resize_job_produces_thumbnail():
    result = ResizeImage("cat.png", width = 200).run(InMemoryImages())
    assert result.width == 200

fn test_queue_runs_submitted_jobs():
    queue = JobQueue(executor = RunImmediately())
    ...
```

The job's logic is tested directly and the queue runs synchronously in tests, so nothing waits on a timer.

## One-file tell

A test body that sleeps for a fixed duration.

## Related

[Erratic Test](erratic-test.md) · [Frequent Debugging](frequent-debugging.md) · [Hard-to-Test Code](hard-to-test-code.md)

## In the interview

- [Ask about the bugs that got past the tests, not about coverage.](../THINKING.md#tests-by-what-escaped)

## Sources

- [Meszaros, xUnit Test Patterns, Slow Tests](http://xunitpatterns.com/Slow%20Tests.html) (read)
