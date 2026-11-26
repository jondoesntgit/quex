import { describe, expect, it } from 'vitest'
import { logLine } from './Panels'

const s = { players: { a: { id: 'a', name: 'Abigail', villageId: 'v_a' } }, villages: { v_a: { id: 'v_a', name: "Abigail's Village" } } } as never

describe('log lines', () => {
  it('say who did what, old lines included', () => {
    expect(logLine(s, 'a', 'A dirt road was laid.')).toBe('Abigail laid a dirt road.')
    expect(logLine(s, 'a', 'Lumber camp completed!')).toBe('Abigail built a lumber camp!')
    expect(logLine(s, 'a', 'Orchard half-built.')).toBe('Abigail half-built an orchard.')
    expect(logLine(s, 'a', 'Cut peat: +3. The bog fills in behind you.')).toBe('Abigail cut 3 peat. The bog fills in behind.')
    expect(logLine(s, 'a', 'A caravan of 5 set off for {v:v_b|Bob\'s Mine}.')).toBe("Abigail sent a caravan of 5 to Bob's Mine.")
    expect(logLine(s, 'a', '{p:a|Abigail} laid a dirt road.')).toBe('Abigail laid a dirt road.')
    expect(logLine(s, 'a', 'Something else happened.')).toBe('Abigail: Something else happened.')
  })
})
