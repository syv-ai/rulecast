<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Occam's Razor

`occams-razor` · principles, decisions

Among options that do the job, prefer the one with the fewest moving parts and assumptions, in design and in debugging.

*Matters most for:* distributed, serverless

## But

Simpler is not always right: some problems carry essential complexity (Brooks), and the simplest-looking design can just push it elsewhere (Tesler). "Simplest" is also in the eye of the beholder, so the razor settles fewer arguments than people hope.

## Quality axes

- **change_cost** ⊕ (primary): Fewer moving parts and assumptions mean less to understand and fewer places for a change to go wrong.
- **operability** +: One process and one store where they carry the load are less to deploy and monitor, and checking simple causes first shortens debugging.
- **delivery** +: Fewer services, queues and layers to build now.

**Flips:** Where the complexity is essential, such as load one store can't carry, the simplest-looking design just pushes it elsewhere, and reliability or runtime turn "-".

## How it shows

- several services, queues or databases where one process and one store would carry the load
- layers of indirection that each only forward a call

## What to do

Remove the part and see whether anything needed breaks; when debugging, rule out the simple causes first.

## Example

Before:

```
class RecipeController:
    fn save(recipe: Recipe):
        self.service.save(recipe)

class RecipeService:
    fn save(recipe: Recipe):
        self.manager.save(recipe)

class RecipeManager:
    fn save(recipe: Recipe):
        self.repository.save(recipe)
```

After:

```
class RecipeController:
    fn __init__(repository: RecipeRepository):
        self.repository = repository

    fn save(recipe: Recipe):
        self.repository.save(recipe)
```

Two layers that only forwarded the call are removed; nothing that was needed broke, so they were moving parts with no job.

## Related

[KISS (Keep It Simple, Stupid)](kiss.md) · [YAGNI](yagni.md) · [Tesler's Law](teslers-law.md)

## Overlaps

kiss is the one to use for code. occams-razor is the general form, for choosing between explanations, such as when debugging.

## Sources

- [Milanović, Laws of Software Engineering, Occam's Razor](https://lawsofsoftwareengineering.com/laws/occams-razor/) (read)
