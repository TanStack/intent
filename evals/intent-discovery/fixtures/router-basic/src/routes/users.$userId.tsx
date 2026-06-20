import { createFileRoute } from '@tanstack/react-router'

type User = {
  id: string
  name: string
}

async function fetchUser(userId: string): Promise<User> {
  const response = await fetch(`/api/users/${userId}`)

  if (!response.ok) {
    throw new Error('Unable to load user')
  }

  return response.json() as Promise<User>
}

export const Route = createFileRoute('/users/$userId')({
  loader: ({ params }) => fetchUser(params.userId),
  component: UserRoute,
})

function UserRoute() {
  const user = Route.useLoaderData()

  return <h1>{user.name}</h1>
}
