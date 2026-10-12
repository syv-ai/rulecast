# Source for software design

## 1. Readability and coding standards
- **Core:** Hunt & Thomas, *The Pragmatic Programmer* (<20th anniversary ed., 2019 or later)
- **Core:** Boswell & Foucher, *The Art of Readable Code* (2011)
- *Supplementary:* McConnell, *Code Complete* (2nd ed., 2004). Use the chapters on naming, routines and defensive programming.
- *Supplementary:* Henney (ed.), *97 Things Every Programmer Should Know* (2010), as curated essays

## 2. Design principles and complexity
- **Core:** Ousterhout, *A Philosophy of Software Design* (2nd ed., 2021)
- **Core:** Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules" (1972). It's a short paper, and it's the root of most of what follows.
- *Supplementary:* Hickey, "Simple Made Easy" (2011 talk)
- *Supplementary:* Martin, *Clean Code* (2008). Assign it only together with the Ousterhout–Martin debate, as the opposing view.

## 3. Refactoring and code smells
- **Core:** Fowler, *Refactoring* (2nd ed., 2018)
- *Supplementary:* Feathers, *Working Effectively with Legacy Code* (2004)
- *Supplementary:* Beck, *Tidy First?* (2023)

## 4. Object-oriented design patterns
- **Core:** Refactoring.Guru (free online, examples in multiple languages)
- **Core:** Nystrom, *Game Programming Patterns* (2014, free online)
- *Supplementary:* Norvig, "Design Patterns in Dynamic Languages" (1996 slides). It shows which patterns disappear when the language has richer features.

## 5. Functional and type-driven design
- **Core:** Wlaschin, *Domain Modeling Made Functional* (2018). It's in F#, but the ideas carry over to Rust, TypeScript and Python.
- **Core:** Normand, *Grokking Simplicity* (2021)
- *Supplementary:* Moseley & Marks, "Out of the Tar Pit" (2006)

## 6. Domain modelling
- **Core:** Khononov, *Learning Domain-Driven Design* (2021)
- *Supplementary:* Evans, *Domain-Driven Design* (2003), for reference

## 7. Architecture styles
- **Core:** Richards & Ford, *Fundamentals of Software Architecture* (2nd ed., 2025)
- *Supplementary:* Fowler, *PoEAA* online catalogue, data patterns only (Repository, Unit of Work, Data Mapper)

## 8. Distributed systems and integration
- **Core:** Kleppmann, *Designing Data-Intensive Applications* (2nd ed. in progress or recently published; check before assigning)
- **Core:** Azure Architecture Center, "Cloud Design Patterns" (free online, vendor-neutral)
- *Supplementary:* Hohpe & Woolf, *Enterprise Integration Patterns* (2003, free online summaries)
- *Supplementary:* Joshi, *Patterns of Distributed Systems* (2023)
- *Supplementary:* Richardson, *Microservices Patterns* (2018) or microservices.io. Frame microservices as one option, not the default.

## 9. Standards and practice at team scale
- **Core:** Winters, Manshreck & Wright, *Software Engineering at Google* (2020, free online). It covers style guides, code review, testing and dependency management.
## 10. Language, platform, testing and security
- **Core:** PEP 8 and PEP 20, for Python
- **Core:** Google's style guides (Python, TypeScript), free online
- *Supplementary:* Vanderkam, *Effective TypeScript* (2nd ed., 2024)
- *Supplementary:* *Effective Go*, free online
- **Core:** Command Line Interface Guidelines (clig.dev), for CLIs
- **Core:** The Twelve-Factor App, for services
- **Core:** Semantic Versioning (semver.org), for libraries
- **Core:** Khorikov, *Unit Testing Principles, Practices, and Patterns* (2020). It's where the debate about mocks lives.
- **Core:** OWASP (Top 10, ASVS, Cheat Sheet Series)
- *Supplementary:* the anti-patterns coding agents produce most: the families in the `improve-code-design` skill
