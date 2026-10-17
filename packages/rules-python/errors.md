# Errors in Python

## Swallowed exceptions

An `except` clause whose body is nothing but `pass` throws the failure away. The
call looked like it worked, the caller carries on with missing data, and nothing
in the logs says why.

If the failure is genuinely expected and harmless, say so and say why:

```python
try:
    cache.delete(key)
except KeyError:
    logger.debug("cache entry %s was already gone", key)
```

If it is not expected, let it propagate. A traceback at the right moment is worth
more than a silent wrong answer later. Catching a broad `Exception` only to
`pass` is the same bug with a wider blast radius.

The rule runs ruff's [S110](https://docs.astral.sh/ruff/rules/try-except-pass/). By default it flags a
bare `except:`, `except Exception` and `except BaseException`. To flag typed ones too, set
`check-typed-exception = true` under `[tool.ruff.lint.flake8-bandit]` in the project's ruff config.
