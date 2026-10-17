<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Temporary Field

`temporary-field` · smells, code

Some of an object's fields hold values only while one algorithm runs and are empty the rest of the time, which confuses anyone reading the class.

*Names:* Fowler's 2nd edition keeps the name, and adds the related state smells Mutable Data and Global Data, which have no entries of their own here.

## But

Lazy initialisation and memoised values are deliberately empty at first and are not this smell, as long as they are clearly named. Objects with a real lifecycle (a connection that is open or closed) may hold fields that are only set in some states; that's better modelled with the State pattern or separate types, but it is a different problem.

## Quality axes

- **delivery** +: Stashing intermediate values on the object avoids passing them through a long parameter list.
- **change_cost** −: Readers can't tell when a field is meaningful, so the class is harder to understand and change safely.
- **reliability** −: Fields that are empty outside one algorithm cause null errors when read at the wrong time, and break when the method runs re-entrantly or concurrently.

## Why people fall into it

- An algorithm needed many intermediate values, and storing them on the object avoided passing a long parameter list.
- Helper methods split out of a long method needed shared state.

## How it shows

- Fields initialised to null in the constructor and assigned only inside one method.
- Methods that check whether a field is set before using it.
- Fields cleared again at the end of a method.

## Overcorrecting looks like

- Turning lazily computed caches, which are legitimately empty until first used, into separate classes.
- Extracting a method object for two intermediate values that could simply be local variables.

## What to do

Move the temporary fields and the code that uses them into a class of their own with Extract Class. That new class is a method object, built for one run and holding its values for its whole life. Replace the checks for unset fields with Introduce Null Object (Introduce Special Case in the 2nd edition).

## Example

Before:

```
class Grader:
    _curve_mean: float | None = None
    _curve_spread: float | None = None

    fn grade(exam) -> str: ...

    fn curved_grade(exam, cohort) -> str:
        self._curve_mean = mean(cohort.scores)
        self._curve_spread = stddev(cohort.scores)
        z = (exam.score - self._curve_mean) / self._curve_spread
        return letter_for_z(z)
```

After:

```
class Curve:
    mean: float
    spread: float

    fn from_cohort(cohort) -> Curve:
        return Curve(mean(cohort.scores), stddev(cohort.scores))

    fn letter_for(score: float) -> str:
        return letter_for_z((score - self.mean) / self.spread)

class Grader:
    fn grade(exam) -> str: ...
    fn curved_grade(exam, cohort) -> str:
        return Curve.from_cohort(cohort).letter_for(exam.score)
```

The curve values now live in an object that always has them, and the grader holds no half-set state.

## One-file tell

A field initialised to null or None in the constructor that is assigned and read only inside one method (and the helpers it calls), excluding fields read back by a getter that fills them on first use.

## Related

[Long Parameter List](long-parameter-list.md) · [Long Method](long-method.md) · [State](state.md)

## Sources

- [Refactoring.Guru, Temporary Field](https://refactoring.guru/smells/temporary-field) (read)
- [Martin Fowler, Refactoring (2nd ed.), ch. 3](https://martinfowler.com/books/refactoring.html) (recalled)
