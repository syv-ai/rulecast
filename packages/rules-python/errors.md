# Errors in Python services

## Services raise domain exceptions

Services hold the business logic and know nothing about HTTP. When an operation cannot go ahead, the service raises a domain exception that names what went wrong: `UserNotFound`, `PermissionDenied`, `InvalidTransition`. It never raises `HTTPException` and never picks a status code.

Domain exceptions live in one module (for example `app/core/exceptions.py`) and share a base class. The API layer maps them to HTTP responses in one place: an exception handler registered on the app, or the route that calls the service.

```python
# app/services/users.py
def get_user(session: Session, user_id: int) -> User:
    user = crud.get_user(session, user_id)
    if user is None:
        raise UserNotFound(user_id)
    return user
```

```python
# app/main.py
@app.exception_handler(UserNotFound)
async def user_not_found(request: Request, error: UserNotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(error)})
```

Why: the same service runs from routes, background jobs, scripts and tests, which have no HTTP response to send. Mapping in one place keeps status codes and messages consistent.

## Messages users see

Write the user-facing message on the domain exception, in the language the product uses. Routes and handlers pass it through; they don't rewrite it.

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
