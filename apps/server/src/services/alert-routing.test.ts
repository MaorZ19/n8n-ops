import { describe, expect, it } from "vitest"
import { resolveThread, routedGroupKey, routeMatches, telegramRouteSchema } from "./alert-routing.ts"
import { html, Telegram } from "./telegram.ts"

const routes = [
  { instance: "mehola", threadId: 16 },
  { workflow: "gabi|gabriella|גבריאל", threadId: 12 },
  { tag: "Jango", threadId: 18 },
  { instance: "hostinger", workflow: "^big brain", threadId: 20 },
]

describe("Telegram topic routing", () => {
  it("picks the first matching route", () => {
    expect(resolveThread({ routes }, { instanceName: "Mehola", workflowName: "Gabi lead" })).toBe(16)
    expect(resolveThread({ routes }, { instanceName: "hostinger", workflowName: "Gabi lead" })).toBe(12)
    expect(resolveThread({ routes }, { instanceName: "hostinger", workflowName: "גבריאל - תורים" })).toBe(12)
  })

  it("matches tags case-insensitively and needs every condition of a route", () => {
    expect(resolveThread({ routes }, { instanceName: "x", workflowName: "w", tags: ["jango"] })).toBe(18)
    expect(resolveThread({ routes }, { instanceName: "hostinger", workflowName: "Big Brain sync" })).toBe(20)
    expect(resolveThread({ routes }, { instanceName: "other", workflowName: "Big Brain sync" })).toBeUndefined()
  })

  it("falls back to the default thread, then to none", () => {
    expect(resolveThread({ routes, defaultThreadId: 6259 }, { instanceName: "hostinger", workflowName: "x" })).toBe(
      6259,
    )
    expect(resolveThread({}, { instanceName: "hostinger" })).toBeUndefined()
  })

  it("does not match workflow or tag rules for instance-only alerts", () => {
    expect(routeMatches({ workflow: ".*", threadId: 1 }, { instanceName: "a" })).toBe(false)
    expect(routeMatches({ tag: "a", threadId: 1 }, { instanceName: "a" })).toBe(false)
  })

  it("rejects empty routes and bad patterns", () => {
    expect(telegramRouteSchema.safeParse({ threadId: 3 }).success).toBe(false)
    expect(telegramRouteSchema.safeParse({ workflow: "(", threadId: 3 }).success).toBe(false)
    expect(telegramRouteSchema.safeParse({ workflow: "a", threadId: 0 }).success).toBe(false)
    expect(telegramRouteSchema.safeParse({ workflow: "a", threadId: 3 }).success).toBe(true)
  })

  it("never groups the same error across topics", () => {
    expect(routedGroupKey(12, "boom")).not.toBe(routedGroupKey(13, "boom"))
    expect(routedGroupKey(null, "boom")).toBe(routedGroupKey(undefined, "boom"))
  })
})

describe("Telegram.send", () => {
  const capture = () => {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }))
    }) as never
    return { bodies, tg: new Telegram("t", fetchImpl) }
  }

  it("posts in the forum topic when given a thread", async () => {
    const { bodies, tg } = capture()
    expect(await tg.send("-100", html`hi`, [], 6259)).toBe(7)
    expect(bodies[0]?.message_thread_id).toBe(6259)
  })

  it("leaves the thread out otherwise", async () => {
    const { bodies, tg } = capture()
    await tg.send("-100", html`hi`)
    await tg.send("-100", html`hi`, [], null)
    expect(bodies.every((b) => !("message_thread_id" in b))).toBe(true)
  })
})
