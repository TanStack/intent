import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

type User = {
  id: string
  name: string
}

const getUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const users: Array<User> = [
    { id: '1', name: 'Ada Lovelace' },
    { id: '2', name: 'Grace Hopper' },
  ]

  return users
})

export const Route = createFileRoute('/users')({
  loader: () => getUsers(),
  component: UsersRoute,
})

function UsersRoute() {
  const users = Route.useLoaderData()

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
