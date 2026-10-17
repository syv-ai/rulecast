<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Memento

`memento` · design patterns, behavioral

An object produces an opaque snapshot of its own state that others can store and hand back for restoring, without seeing inside it; also called Snapshot.

*Matters most for:* desktop, games, tui

## But

Snapshots cost memory, and someone has to prune old ones. When state is immutable, keeping previous versions gives you mementos for free; event sourcing and command-based undo are other routes. If the object has no external links and is easy to copy, cloning it (Prototype) is simpler. In dynamic languages the snapshot can't really be kept opaque, so the encapsulation benefit is a convention rather than a guarantee.

## Quality axes

- **change_cost** ⊕ (primary): The object snapshots its own state, so a new field can't be missed by outside copy code and privates stay private.
- **reliability** +: State can be rolled back to a known-good checkpoint after a failed operation.
- **runtime** −: Every stored snapshot costs memory, and old ones need pruning.

**Flips:** Snapshotting a large object on every small change wastes memory where an inverse operation would do; with immutable state, keeping the old value already is the memento.

## Warranted when

- Something needs undo, rollback after failure, or checkpoints
- Outside code is reading private fields to copy an object's state, or fields were made public just so they could be saved
- Snapshot code breaks every time the object's fields change

## How it shows

- save / restore or create_memento methods on a stateful class
- A history or caretaker class holding a list of snapshots with timestamps or labels
- Undo stacks storing copies of state rather than inverse operations

## Overdone when

- Mementos for objects whose state is already immutable or a plain value, where keeping the old value is enough
- Snapshotting a whole large object on every small change when an undo of the operation would be cheap
- A caretaker and memento class hierarchy for state that nothing ever restores

## Example

Before:

```
# the trainer copies the run's private fields to roll back a diverged epoch
saved = {"weights": run._weights.copy(), "epoch": run._epoch,
         "lr": run._lr, "optimizer": run._optimizer_state.copy()}
run.train_epoch()
if run.loss() > threshold:
    run._weights = saved["weights"]
    run._epoch = saved["epoch"]
    run._lr = saved["lr"]
    run._optimizer_state = saved["optimizer"]
# the run gained a _scheduler_step field last week; this code silently skips it
```

After:

```
class TrainingRun:
    fn checkpoint() -> Checkpoint:
        return Checkpoint(copy(self._weights), self._epoch, self._lr,
                          copy(self._optimizer_state), self._scheduler_step)
    fn restore(cp: Checkpoint):
        ... # only TrainingRun reads a Checkpoint's fields

cp = run.checkpoint()
run.train_epoch()
if run.loss() > threshold:
    run.restore(cp)
```

The run snapshots and restores itself, so the trainer just holds an opaque checkpoint and a new field can't be missed outside the class.

## By language

**python:** Usually copy.deepcopy, a frozen dataclass, dataclasses.replace, or pickle rather than a dedicated memento class; the source notes serialization as the common Python route. Python has no real private state, so the memento's contents can't be protected, only marked by convention.

**typescript:** In TypeScript the idea is usually done by serialising state (JSON or `structuredClone`), which keeps backups without exposing the originator's internals, though it isn't the most efficient way. Immutable state, as in Redux or Immer, makes snapshots nearly free: keeping the previous state object is the memento.

**java:** Java code often gets this effect from serialization: a Serializable object (or a JSF StateHolder) can write out its state and read it back. It works, but it's heavyweight, and built-in Java serialization is now widely discouraged for security and fragility reasons. The cleaner modern form is an immutable record holding the snapshot, nested in the originator so nothing else can read it.

**csharp:** Serialization is a common shortcut in C#, though a costly one. Immutable records make snapshots cheap, since holding the previous instance is the memento. A nested class or private fields with an internal accessor keep the snapshot opaque to the caretaker. Spotting it: A SaveState/CreateSnapshot and Restore pair on the originator, with an opaque snapshot type (often nested or serialized) kept in a stack or list by a history class.

**go:** Go has no friend or nested-class privacy, so encapsulation is per package. A memento hides its state with unexported fields, which means only the originator's package can read them. Copying a struct value is often enough for a snapshot, as long as it holds no shared slices or maps. Mementos that must survive a restart usually just become encoded bytes via encoding/json or gob. Spotting it: A struct with unexported fields that one type produces and restores from, while another stores a slice of them without reading them.

**rust:** Ownership fits it well. A restore method that consumes the snapshot (`self`) makes each snapshot single-use. The cheapest snapshot is often just `#[derive(Clone)]` on the state struct. When snapshots must persist, the usual approach is to derive serde's `Serialize`/`Deserialize` and store the serialized form, not a hand-written memento type. Module privacy keeps the snapshot's fields opaque to the caretaker. Spotting it: A stack (`Vec`) of cloned state structs or serialized strings, with `save()` returning a snapshot and `restore(snapshot)` replacing fields. Often serde derives on the state type.

**cpp:** Serializing the object's state is one way to do it in C++, though rarely the cheapest. Value semantics make an in-memory memento easy: a copyable state struct that only the originator can open, through a friend declaration or a private nested type. Spotting it: A state-snapshot class, often nested or befriended, produced and consumed by a save and restore pair of methods on the originator.

## Related

[Command](command.md) · [Iterator](iterator.md) · [Prototype](prototype.md)

## Sources

- [Refactoring.Guru, Design Patterns: Memento](https://refactoring.guru/design-patterns/memento) (read)
- [Refactoring.Guru, Memento in Python](https://refactoring.guru/design-patterns/memento/python/example) (read)
- [Refactoring.Guru, Memento in TypeScript](https://refactoring.guru/design-patterns/memento/typescript/example) (read)
- Established TypeScript practice (immutable state, Immer) (recalled)
- [Refactoring.Guru, Memento in Java](https://refactoring.guru/design-patterns/memento/java/example) (read)
- Effective Java (Bloch), items on preferring alternatives to Java serialization (recalled)
- [Refactoring.Guru, Memento in C#](https://refactoring.guru/design-patterns/memento/csharp/example) (read)
- C# records as immutable snapshots (recalled)
- [Refactoring.Guru, Memento in Go](https://refactoring.guru/design-patterns/memento/go/example) (read)
- [Refactoring.Guru, Memento in Rust](https://refactoring.guru/design-patterns/memento/rust/example) (read)
- [Refactoring.Guru, Memento in C++](https://refactoring.guru/design-patterns/memento/cpp/example) (read)
