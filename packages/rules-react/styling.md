# Styling React components

## Inline styles

A `style={{ ... }}` prop puts a value in one element that the rest of the app
cannot see. It does not respond to the theme, it cannot be overridden by a
variant, and it is invisible to anyone grepping the stylesheet for the colour
they need to change.

Reach for the design system's classes instead:

```tsx
// Not this
<div style={{ padding: 8, color: "#1f2937" }} />

// This
<div className="p-2 text-slate-800" />
```

When a value is genuinely dynamic — a computed width, a chart bar's height —
inline style is the right tool. Keep it to that one value and leave everything
else in classes.
