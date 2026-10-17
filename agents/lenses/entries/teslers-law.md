<!-- Generated from packages/lenses by `pnpm lenses`. Do not edit by hand: edit the YAML and run it again. -->

# Tesler's Law

`teslers-law` · laws, architecture

Every task has some complexity that cannot be removed, only moved, so decide deliberately whether the user, the caller or the system carries it. Also called the Law of Conservation of Complexity.

*Matters most for:* cli-devtool, library-sdk, web-api, iac

## But

Not all complexity is irreducible; much is accidental and can simply be deleted. Hiding complexity can also go too far: magic defaults and opaque behaviour make the system hard to debug, and expert users may want the knobs.

## Quality axes

*Bears on:* change_cost, operability. Irreducible complexity only moves; pushed onto callers it is repeated at every call site, and hidden behind magic it makes the system hard to configure and debug.

## How it shows

- APIs or CLIs that require many flags or setup steps where sensible defaults would do
- a "simplification" that moved logic into configuration, stored procedures or callers instead of removing it

## What to do

Absorb the complexity once inside the system (good defaults, smart handling) rather than pushing it onto every user or caller.

## Example

Before:

```
fn transcode(src: str, dst: str, codec: str, bitrate: int, audio_codec: str,
             audio_bitrate: int, keyframe_interval: int, pixel_format: str):
    ...

# every caller
transcode(src, dst, "h264", 4000, "aac", 128, 48, "yuv420p")
```

After:

```
fn transcode(src: str, dst: str, preset: Preset = WEB_DEFAULT,
             overrides: dict = {}):
    settings = preset.merge(overrides)
    settings.keyframe_interval = settings.keyframe_interval or frame_rate(src) * 2
    ...

# every caller
transcode(src, dst)
```

The encoding choices are still there, but the system now carries them once through a preset and derived values instead of every caller repeating eight arguments, and experts keep overrides.

## Related

[Occam's Razor](occams-razor.md) · [Principle of Least Astonishment](principle-of-least-astonishment.md)

## Sources

- [Milanović, Laws of Software Engineering, Tesler's Law (Conservation of Complexity)](https://lawsofsoftwareengineering.com/laws/teslers-law/) (read)
