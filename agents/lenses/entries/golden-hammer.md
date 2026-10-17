<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Golden hammer

`golden-hammer` · anti-patterns, design

One familiar tool, language or technique gets used for every problem, including ones it fits badly. The law of the instrument ("if all you have is a hammer").

## But

Sticking with a well-understood tool is often the right call: "choose boring technology" (Dan McKinley) argues that each new technology spends a limited budget. A familiar tool used slightly outside its sweet spot usually beats an unfamiliar one used well. It is a golden hammer only when the misfit costs more than the switch.

## Quality axes

- **delivery** +: The team already knows the tool, so there is nothing new to learn or set up.
- **change_cost** −: Workarounds against the grain of a badly fitting tool pile up and make each later change harder.

**Flips:** Where the misfit is small, the familiar tool is the right call ("choose boring technology"); it is only an anti-pattern when the misfit costs more than the switch.

## Why people fall into it

- The team knows the tool well and has had success with it.
- Adding a new technology has real costs in learning, operations and hiring.
- A past investment in the tool that people want to justify.

## How it shows

- the same database, queue or framework used for jobs it is poorly suited to, such as a relational table as a job queue under heavy load
- regular expressions used to parse nested formats
- every new feature built on one in-house framework even where it adds friction

## Overcorrecting looks like

- Adding a new technology for every problem, so the stack sprawls and nobody knows all of it.

## What to do

Judge the problem first and the tool second; bring in a better-fitting tool where the misfit is costly.

## Example

Before:

```
fn read_sensor_config(text: str) -> dict:
    config = {}
    for m in regex_find_all("(\w+)\s*=\s*\{([^}]*)\}", text):
        block = {}
        for kv in regex_find_all("(\w+)\s*:\s*([^,]+)", m.group(2)):
            block[kv.group(1)] = kv.group(2).strip()
        config[m.group(1)] = block
    return config
```

After:

```
# sensors.toml
# [thermostat]
# interval = 30

fn read_sensor_config(text: str) -> dict:
    return toml.parse(text)
```

The nested format is stored as TOML and read with a parser, instead of regexes that break on the first nested block.

## Related

[Reinventing the wheel](reinventing-the-wheel.md) · [Lindy Effect](lindy-effect.md)

## Overlaps

All four are practice without reasons. cargo-cult-programming is the code-level form, blind-pattern-following the architecture and process form, golden-hammer one tool used for everything, and dogma-over-pragma a rule kept where its reason doesn't apply.

## In the interview

- [For each heavyweight pattern, framework or architecture in the code, ask what problem it solves in this project.](../THINKING.md#reasons-not-precedent)

## Sources

- Brown, Malveau, McCormick, Mowbray, AntiPatterns (1998), Golden Hammer (recalled)
- Maslow, The Psychology of Science (1966), law of the instrument (recalled)
