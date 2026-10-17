<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# State

`state` · design patterns, behavioral

Move each state's behaviour into its own object and let the owner swap which one it delegates to, so it acts as if it changed class.

*Matters most for:* embedded, games, mobile, web-frontend, event-driven, tui

## But

For a handful of stable states it is overkill. Spreading transitions across classes can hide the shape of the machine; many practitioners prefer an explicit transition table or a state-machine library so the whole graph is visible in one place and can be checked. State objects that know about each other couple the states together. Persisted state also has to map back to an object on load.

## Quality axes

- **change_cost** ⊕ (primary): A new state is a new class, not another branch in every method that switches on the status field.
- **reliability** +: Each state accepts only the operations and transitions valid for it, so illegal transitions stop slipping through.
- **delivery** −: A class per state and a context to hold them is more code than an enum and a conditional.

**Flips:** For a handful of stable states an enum and one conditional are clearer, and transitions spread across classes can hide the machine a single transition table would show.

## Warranted when

- Several methods branch on the same state field, and adding a state means editing all of them
- There are many states and the behaviour per state keeps changing
- Transition rules are scattered, so illegal transitions slip through
- Similar states duplicate code that could be shared

## How it shows

- The same if / switch on a status field repeated across many methods of one class
- A family of state classes sharing an interface, with a context holding the current one
- State objects that set the context's next state themselves

## Overdone when

- State classes for two or three states that rarely change, where an enum and one conditional are clearer
- A state class per value of a field whose only difference is a label or a number
- Transitions spread across many state classes when a single transition table would show the whole machine at once

## Example

Before:

```
class Subscription:
    status: str    # "trial" | "active" | "past_due" | "cancelled"
    fn charge():
        if self.status == "trial": return
        if self.status == "cancelled": raise Error("cancelled")
        ok = gateway.charge(self.plan.price)
        self.status = "active" if ok else "past_due"
    fn cancel():
        if self.status == "past_due": self.write_off_balance()
        self.status = "cancelled"
    fn grant_feature(f): ...    # another branch on status
    # adding "paused" means editing every method
```

After:

```
class Subscription:
    state: SubscriptionState
    fn charge(): self.state.charge(self)
    fn cancel(): self.state.cancel(self)

class PastDue implements SubscriptionState:
    fn charge(sub):
        if gateway.charge(sub.plan.price): sub.state = Active()
    fn cancel(sub):
        sub.write_off_balance()
        sub.state = Cancelled()
# Trial, Active and Cancelled each hold their own charge and cancel
```

Each status becomes an object holding that status's behaviour and its legal transitions, so a new status is a new class rather than a branch in every method.

## One-file tell

The same comparison on a state or status attribute appearing in three or more methods of one class, where each branch changes behaviour (not just rendering). Not in update/view functions of an Elm-architecture UI, where one switch on the message is the idiom.

## By language

**python:** Often an Enum plus a dict mapping (state, event) to the next state, or a library like transitions, rather than a class per state. A match statement on an Enum handles small machines. Swapping self.__class__ is possible but surprising and best avoided. The source says Python code uses it mostly to replace large switch-style state machines.

**typescript:** Used in TypeScript to replace large switch-based state machines with separate state objects. The common alternative is a discriminated union of states with exhaustive `switch` checks (a `never` default), which the compiler enforces. Libraries such as XState cover complex machines. Spotting it: An object whose methods behave differently depending on a swappable state object it holds, with transitions replacing that object.

**java:** Used to replace large switch-based state machines with state objects; JSF's Lifecycle phases are the page's JDK-ecosystem example. Java enums with constant-specific method bodies are a compact idiomatic form when the set of states is fixed. Sealed types with pattern-matching switch are another. Spring Statemachine exists for heavyweight cases. Spotting it: A context class that delegates behaviour to a state field of an interface or enum type, where the state objects themselves can swap that field to the next state.

**csharp:** Used in C# to replace large switch-based state machines with one object per state. For small machines, an enum with a switch expression and pattern matching is often clearer than a class per state; libraries such as Stateless suit more involved workflows. Note that async methods and iterators are compiled into state machines for you. Spotting it: A context class holding a reference to a state interface or abstract class and delegating behaviour to it, with concrete state classes that switch the context to another state.

**go:** The state interface with a struct per state is used. Go also has a lighter idiom: state functions, where each state is a function that does its work and returns the next state function. Rob Pike's lexer talk made this well known, and text/template's lexer uses it. For small machines, a typed integer constant with iota plus a switch is the most common choice. Spotting it: A recursive function type such as type stateFn func(*T) stateFn driven by a loop, a currentState field of interface type, or an iota enum with a switch in each method.

**rust:** The trait-object form has transition methods take `self: Box<Self>` and return the next `Box<dyn State>`, so the old state is consumed; the Rust Book uses this too. More idiomatic in practice is an `enum` of states with a `match`, because the compiler checks the match is exhaustive and no allocation is needed. A third form is typestate: each state is a distinct type, and transitions consume one and return another, so invalid calls do not compile. Spotting it: Trait methods with a `self: Box<Self>` receiver returning `Box<dyn State>`, an `Option<Box<dyn State>>` field that is `take()`n and replaced, a `match self.state` over an enum, or generic marker types (`Conn<Open>`) with consuming transitions.

**cpp:** Applied in C++ to replace large switch-based state machines with one object per state. Modern C++ often prefers std::variant holding one struct per state, with std::visit to dispatch, which keeps states as values and makes the compiler check every case. Libraries such as Boost.SML and Boost.MSM handle larger machines. Spotting it: A context class holding a pointer to an abstract state, delegating its methods to it and swapping it on transitions; or a std::variant of state structs dispatched with std::visit.

## Related

[Strategy](strategy.md) · [Bridge](bridge.md) · [Adapter](adapter.md)

## Overlaps

switch-statements is the smell, and state and strategy are the two usual remedies: state when the switch is on an object's lifecycle, strategy when it chooses an algorithm. Exhaustive matching on a closed set is often better than either. open-closed-principle says when the switch is worth replacing at all: when others add cases, not when you own every one.

## Sources

- [Refactoring.Guru, Design Patterns: State](https://refactoring.guru/design-patterns/state) (read)
- [Refactoring.Guru, State in Python](https://refactoring.guru/design-patterns/state/python/example) (read)
- [Refactoring.Guru, State in TypeScript](https://refactoring.guru/design-patterns/state/typescript/example) (read)
- Established TypeScript practice (discriminated unions, exhaustiveness checks, XState) (recalled)
- [Refactoring.Guru, State in Java](https://refactoring.guru/design-patterns/state/java/example) (read)
- Enums with constant-specific method implementations (Effective Java) (recalled)
- [Refactoring.Guru, State in C#](https://refactoring.guru/design-patterns/state/csharp/example) (read)
- C# switch expressions and pattern matching; Stateless library (recalled)
- [Refactoring.Guru, State in Go](https://refactoring.guru/design-patterns/state/go/example) (read)
- [Rob Pike, Lexical Scanning in Go](https://go.dev/talks/2011/lex.slide) (recalled)
- [Refactoring.Guru, State in Rust](https://refactoring.guru/design-patterns/state/rust/example) (read)
- [The Rust Programming Language, implementing an object-oriented design pattern](https://doc.rust-lang.org/book/ch18-03-oo-design-patterns.html) (recalled)
- [Refactoring.Guru, State in C++](https://refactoring.guru/design-patterns/state/cpp/example) (read)
- [std::variant and std::visit, cppreference](https://en.cppreference.com/w/cpp/utility/variant) (recalled)
