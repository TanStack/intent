import { createFileRoute } from '@tanstack/react-router'

const users = [
  { id: '1', name: 'Ada Lovelace' },
  { id: '2', name: 'Grace Hopper' },
]

export const Route = createFileRoute('/users')({
  component: UsersRoute,
})

function UsersRoute() {
  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
