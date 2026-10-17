<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Contract Test

`contract-test` · practices, testing

A test suite that pins what one side of an interface promises the other, and runs against every party that claims to keep the promise. One form is consumer-driven contracts, where the consumers of a service write down what they rely on and the provider runs those checks. Another is a contract suite that a host or library ships so every plugin, adapter or backend can prove it behaves as the host expects.

*Names:* Consumer-driven contracts were described by Ian Robinson in an article on Fowler's site (2006). Fowler's bliki ContractTest covers tests that check a test double still matches the real service. Pact is the best-known tool. In Java the shipped-suite form is called a TCK (Technology Compatibility Kit); others call it a conformance suite, specification tests or an abstract test case.

*Matters most for:* plugin-host, library-sdk, distributed, event-driven, web-api, databases-storage

## But

Contract tests cost upkeep on both sides and a broker or shared artefact to coordinate them, which only pays off when parties change independently. For a few services owned by one team, a handful of integration tests is usually cheaper. Consumer-driven contracts can also hand consumers too much say: a provider with many consumers may prefer to publish its own schema and versioning policy (OpenAPI, protobuf with breaking-change checks) and let consumers adapt. A shipped suite only covers what its authors thought to test, so passing it is necessary, not sufficient, and it becomes part of your public API that plugin authors depend on (Hyrum's law applies to the suite too).

## Quality axes

- **reliability** ⊕ (primary): Every plugin, adapter, backend or fake is proven to behave as callers expect, so they really are interchangeable and fakes don't drift.
- **change_cost** +: Separately deployed parties can change independently without slow, flaky end-to-end suites.
- **delivery** −: The suite, and any broker or shared artefact, has to be written and kept up on both sides.

**Flips:** For one implementation, or a few services owned by one team, a handful of integration tests is cheaper. Contracts that pin exact data or wording break on harmless changes and turn change_cost "-".

## Warranted when

- Several implementations of one interface (storage backends, adapters, plugins, drivers) that must be interchangeable.
- Third parties write implementations of your extension surface, and you can't read or run their code.
- Separate teams or services deploy on their own schedule, and end-to-end tests across them are slow and flaky.
- Hand-written fakes that may drift from the real thing.

## How it shows

- An exported test function or abstract test class that takes a factory for "the thing under test" and runs the same cases against each implementation.
- Pact files or similar contract artefacts checked into a consumer repo and verified in the provider's pipeline.
- A testing subpackage in a library meant for downstream use (testlib, fstest, a specification-tests package).
- Fakes or test doubles that are run through the same suite as the real implementation.

## Overdone when

- A contract suite for an interface with one implementation and no outside implementers.
- Contracts that pin exact data, wording or field order, so they break on harmless provider changes; contracts should check shape and the behaviour consumers rely on.
- Consumer-driven contracts between modules deployed together, where an ordinary integration test is simpler.
- Treating contract tests as a replacement for any end-to-end check of the deployed system.

## Example

Before:

```
# each backend has its own ad hoc tests
test "s3 store keeps blobs":
    store = S3Store(test_bucket)
    store.put("a", b"1")
    assert store.get("a") == b"1"

test "disk store lists keys":
    store = DiskStore(tmp_dir)
    ...
# nobody checks that a missing key behaves the same in both
```

After:

```
# shipped by the host, imported by every backend's tests
fn blob_store_contract(make_store):
    test "round trips":
        s = make_store(); s.put("a", b"1"); assert s.get("a") == b"1"
    test "missing key is NotFound":
        s = make_store(); assert raises(NotFound, s.get, "nope")
    test "list is sorted":
        ...

blob_store_contract(fn: S3Store(test_bucket))
blob_store_contract(fn: DiskStore(tmp_dir()))
blob_store_contract(fn: InMemoryStore())
```

One suite says what a blob store must do, and every implementation, the in-memory fake included, has to pass it.

## By language

**python:** Usually a base test class or a parametrised pytest fixture over implementations; a library can ship it as an importable module or pytest plugin. Pact has a Python implementation.

**typescript:** Commonly an exported function that registers describe/it blocks for a factory, so plugin authors call it from their own Jest or Vitest suite. Pact JS is the main consumer-driven tool.

**java:** Abstract JUnit test classes with a factory method, or JUnit 5 @TestTemplate and interface default test methods. TCKs for Jakarta EE specs are the formal version; Guava's testlib collection testers are a library example. Spring Cloud Contract and Pact JVM cover services.

**csharp:** Abstract xUnit or NUnit base classes; Microsoft ships specification test packages, such as the ones for dependency injection containers, that third-party containers run. PactNet covers services.

**go:** The standard library sets the example: testing/fstest.TestFS checks any fs.FS, and testing/iotest helps check readers. A package exports a function taking *testing.T and a constructor.

**rust:** Usually a function or macro, often in a separate test-support crate or behind a feature flag, that runs the suite against any type implementing the trait. Pact has a Rust implementation.

## Related

[Test Double taxonomy (dummy, stub, spy, mock, fake)](test-double-taxonomy.md) · [Prefer Fakes over Mocks](fake-over-mock.md) · [Liskov Substitution Principle (LSP)](liskov-substitution-principle.md) · [Hyrum's Law](hyrums-law.md) · [Postel's Law](postels-law.md) · [Testing Pyramid](testing-pyramid.md)

## Sources

- [Martin Fowler, bliki, ContractTest](https://martinfowler.com/bliki/ContractTest.html) (read)
- [Ian Robinson, Consumer-Driven Contracts, a Service Evolution Pattern (2006)](https://martinfowler.com/articles/consumerDrivenContracts.html) (read)
- [Pact documentation](https://docs.pact.io/) (recalled)
- [Go standard library, testing/fstest](https://pkg.go.dev/testing/fstest) (recalled)
