# Data fetching in React

## Server state lives in the query layer

Data that comes from the API is server state. A query library (TanStack Query, SWR or similar) fetches, caches and invalidates it; components don't keep their own copies in `useState`.

Each resource gets hooks next to its feature, which call the API client and own the query keys:

```tsx
// hooks/useUsers.ts
export function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() })
}

export function useDeactivateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  })
}
```

UI state (open dialogs, form input, selection) stays in components or React context.

## Components never fetch

Components render data and handle interaction. They read server data from query hooks and change it through mutation hooks; they never call `fetch`, `axios` or the API client themselves.

```tsx
export function UserList() {
  const { data: users = [], isPending } = useUsers()
  if (isPending) return <Spinner />
  return <ul>{users.map((user) => <li key={user.id}>{user.name}</li>)}</ul>
}
```

Why: a request inside a component bypasses the cache, runs again on every mount, and leaves loading, error and invalidation handling to each call site.

## Generated API clients

When the API client is generated from an OpenAPI schema, don't edit the generated files. Change the backend, then run the project's generate command.
