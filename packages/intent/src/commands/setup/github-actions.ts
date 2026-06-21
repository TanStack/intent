export async function runSetupGithubActionsCommand(
  root: string,
  metaDir: string,
): Promise<void> {
  const { runSetupGithubActions } = await import('../../setup/index.js')
  runSetupGithubActions(root, metaDir)
}
