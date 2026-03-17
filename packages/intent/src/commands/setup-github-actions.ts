export async function runSetupGithubActionsCommand(
  root: string,
  metaDir: string,
): Promise<void> {
  const { runSetupGithubActions } = await import('../setup.js')
  runSetupGithubActions(root, metaDir)
}
