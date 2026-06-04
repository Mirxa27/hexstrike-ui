import { describe, it, expect, beforeEach } from 'vitest'
import { chatHistory } from '../chatHistory'

describe('chatHistory store', () => {
  beforeEach(() => {
    chatHistory.clearAll()
  })

  it('createSession then updateSession persists messages and auto-titles from first user line', () => {
    const session = chatHistory.createSession()
    expect(session.title).toMatch(/New Chat/)
    const messages = [
      {
        id: 'u1',
        role: 'user' as const,
        content: 'hello world',
        timestamp: Date.now(),
      },
    ]
    chatHistory.updateSession(session.id, messages)
    const roundtrip = chatHistory.getSession(session.id)
    expect(roundtrip?.messages).toHaveLength(1)
    expect(roundtrip?.messages?.[0]?.content).toBe('hello world')
    expect(roundtrip?.title).toMatch(/hello/)
  })

  it('strips base64 data from file_attach tool calls when persisting', () => {
    const session = chatHistory.createSession()
    chatHistory.updateSession(session.id, [
      {
        id: 'm1',
        role: 'user' as const,
        content: 'analyze',
        timestamp: 1,
        toolCalls: [
          {
            id: 'tc1',
            name: 'file_attach',
            arguments: {
              files: [{ id: 'f1', name: 'x.bin', category: 'binary', data: 'YmFzZTY0LXBheWxvYWQ=' }],
            },
            status: 'done' as const,
          },
        ],
      },
    ])
    const stored = chatHistory.getSession(session.id)
    const files = stored?.messages?.[0]?.toolCalls?.[0]?.arguments?.files as Array<
      Record<string, unknown>
    >
    expect(files?.[0]).toBeDefined()
    expect(files?.[0]).not.toHaveProperty('data')
    expect(files?.[0]?.name).toBe('x.bin')
  })

  it('importSessions merges and reports count', () => {
    const id = `session-import-${Date.now()}`
    const json = JSON.stringify({
      sessions: [
        {
          id,
          title: 'Imported',
          messages: [{ id: 'a', role: 'user', content: 'hi', timestamp: 1 }],
          createdAt: 1,
          updatedAt: 2,
          tags: [],
        },
      ],
      exportedAt: Date.now(),
    })
    const result = chatHistory.importSessions(json)
    expect(result.success).toBe(true)
    expect(result.imported).toBe(1)
    expect(chatHistory.getSession(id)?.title).toBe('Imported')
  })

  it('importSessions rejects invalid payload', () => {
    const before = chatHistory.sessions.length
    const result = chatHistory.importSessions('{"sessions": "not-array"}')
    expect(result.success).toBe(false)
    expect(chatHistory.sessions.length).toBe(before)
  })
})
