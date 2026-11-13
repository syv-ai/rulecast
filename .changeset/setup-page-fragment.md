---
"@syv-ai/rulecast": patch
---

The setup page now publishes as an artifact without editing, and follows the viewer's light or dark theme (#81). `agents/setup-page.html` is now a fragment: its title, font links and style, then the page. That is what an artifact publisher wraps in its own document. Before, an agent had to cut the page's `<head>`, `<meta>` and `<body>` out by hand. For showing the page as a local file, `agents/setup-page.local.html` is the same page as a whole document. It is generated from the fragment, so the two can't drift apart. `SETUP.md` and `CONVENTIONS.md` say which file to fill for each. The page used to be dark only; it now has a light theme as well.
