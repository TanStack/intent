#!/usr/bin/env node
import fs from 'node:fs'
import { getSkill, getSkillPath, getSkills } from './registry.js'

function usage(): void {
  console.log('tanstack-playbook <command>')
  console.log('')
  console.log('Commands:')
  console.log('  list')
  console.log('  show <skill>')
}

function groupSkills(): Map<string, ReturnType<typeof getSkills>> {
  const skills = getSkills()
  const groups = new Map<string, typeof skills>()

  for (const skill of skills) {
    const key = skill.package ?? 'internal'
    const bucket = groups.get(key) ?? []
    bucket.push(skill)
    groups.set(key, bucket)
  }

  return groups
}

function listSkills(): void {
  const groups = groupSkills()
  const allSkills = Array.from(groups.values()).flat()
  const maxName = allSkills.reduce(
    (max, skill) => Math.max(max, skill.name.length),
    0,
  )

  const order = ['query', 'router', 'db', 'form', 'table', 'internal']
  for (const key of order) {
    const entries = groups.get(key)
    if (!entries?.length) continue

    console.log(key)
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (const skill of sorted) {
      const label = skill.name.padEnd(maxName + 2)
      console.log(`${label}${skill.description}`)
    }
    console.log('')
  }
}

function showSkill(name: string): void {
  const skill = getSkill(name)
  if (!skill) {
    console.error(`Unknown skill: ${name}`)
    process.exitCode = 1
    return
  }

  const skillPath = getSkillPath(skill.name)
  if (!fs.existsSync(skillPath)) {
    console.error(`Missing skill file: ${skillPath}`)
    process.exitCode = 1
    return
  }

  const content = fs.readFileSync(skillPath, 'utf8')
  process.stdout.write(content)
}

function run(): void {
  const [, , command, arg] = process.argv

  if (!command) {
    usage()
    process.exitCode = 1
    return
  }

  if (command === 'list') {
    listSkills()
    return
  }

  if (command === 'show') {
    if (!arg) {
      console.error('Missing skill name.')
      usage()
      process.exitCode = 1
      return
    }
    showSkill(arg)
    return
  }

  console.error(`Unknown command: ${command}`)
  usage()
  process.exitCode = 1
}

run()
