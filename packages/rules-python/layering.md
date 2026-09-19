# Layering in Python backends

A request passes through three layers, each with one job:

```
HTTP request → route → service → CRUD → database
```

| Layer | Directory | Does | Never |
|---|---|---|---|
| Route | `routes/` (often `api/routes/`) | Parses input, resolves auth dependencies, calls one service, returns the response | Business rules, database queries |
| Service | `services/` | Business logic, authorization decisions, domain exceptions | HTTP (`HTTPException`, status codes), database queries |
| CRUD | `crud/` | Database queries, one function per query | Business rules, HTTP |

## Business logic goes in services

A route that does more than parse, call and return is hiding logic that other entry points (jobs, scripts, other routes) will need. Move it into a service function and call that. Keep the route thin:

```python
@router.post("/users/{user_id}/deactivate")
def deactivate_user(user_id: int, session: SessionDep, current_user: CurrentUser) -> UserPublic:
    return users_service.deactivate(session, user_id, actor=current_user)
```

## Data access goes through CRUD

Services never build or execute queries: no `session.exec(...)`, `session.execute(...)`, `session.query(...)` or `session.scalars(...)` in `services/`. Put the query in a CRUD function whose name says what it returns, and call it from the service with the session:

```python
# app/crud/users.py
def get_active_users(session: Session) -> list[User]:
    return list(session.exec(select(User).where(User.is_active)).all())

# app/services/users.py
def active_user_count(session: Session) -> int:
    return len(crud.get_active_users(session))
```

Shared query helpers belong in the CRUD package too. The service decides what to do; CRUD knows how to fetch it.
