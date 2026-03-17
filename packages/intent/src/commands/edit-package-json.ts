export async function runEditPackageJsonCommand(root: string): Promise<void> {
  const { runEditPackageJsonAll } = await import('../setup.js')
  runEditPackageJsonAll(root)
}
