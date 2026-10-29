/** Text-only, root-relative filesystem exposed to skill transforms. */
export interface SkillFileSystem {
  readFile: (path: string) => string
  exists: (path: string) => boolean
  listFiles: () => Array<string>
}

export interface ConfigFileSystem extends SkillFileSystem {
  writeFile: (path: string, content: string) => void
  removeFile: (path: string) => void
}

export interface TransformAnswer {
  question: string
  answer: string
}

export interface TransformContext {
  skill: SkillFileSystem
  config: ConfigFileSystem
  commands: TransformCommands
}

/** Complete commands for this skill, ready for the transform to include in instructions. */
export interface TransformCommands {
  load: string
  configure: string
}

export interface ConfigureContext extends TransformContext {
  answers: Array<TransformAnswer>
  stdin: string
}

export interface SkillTransform {
  load: (context: TransformContext & { args: Array<string> }) => string
  configure: (context: ConfigureContext) => string
}
