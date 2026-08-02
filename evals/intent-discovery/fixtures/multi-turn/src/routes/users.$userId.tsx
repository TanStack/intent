import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/users/$userId')({
  component: UserRoute,
})

function UserRoute() {
  return <h1>User</h1>
}
