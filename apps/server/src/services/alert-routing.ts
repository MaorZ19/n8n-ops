import { z } from "zod"

/**
 * Where an alert goes inside the Telegram chat. Forum groups (topics) take a `message_thread_id`; a route picks
 * it from the instance, the workflow name or a workflow tag. The first matching route wins; when none matches the
 * default thread is used, and with no default the message goes to the chat's General topic as before.
 */
export const telegramRouteSchema = z
  .object({
    /** Instance name, exact and case-insensitive. */
    instance: z.string().min(1).optional(),
    /** Regular expression tested case-insensitively against the workflow name. */
    workflow: z
      .string()
      .min(1)
      .max(500)
      .refine((p) => isValidPattern(p), "not a valid regular expression")
      .optional(),
    /** Workflow tag, exact and case-insensitive. */
    tag: z.string().min(1).optional(),
    threadId: z.number().int().positive(),
  })
  .refine((r) => Boolean(r.instance || r.workflow || r.tag), "a route needs instance, workflow or tag")

export type TelegramRoute = z.infer<typeof telegramRouteSchema>

/** What an alert is about. Health and backup alerts know only the instance. */
export type AlertSubject = { instanceName?: string; workflowName?: string; tags?: string[] }

function isValidPattern(pattern: string) {
  try {
    new RegExp(pattern, "iu")
    return true
  } catch {
    return false
  }
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0

/** Whether every condition a route sets holds for the subject. A condition the subject cannot answer fails. */
export function routeMatches(route: TelegramRoute, subject: AlertSubject): boolean {
  if (route.instance && !(subject.instanceName && same(route.instance, subject.instanceName))) return false
  if (
    route.workflow &&
    !(subject.workflowName !== undefined && new RegExp(route.workflow, "iu").test(subject.workflowName))
  )
    return false
  if (route.tag) {
    const tag = route.tag
    if (!subject.tags?.some((t) => same(t, tag))) return false
  }
  return true
}

/** The topic for an alert: the first matching route, else the default, else none (General). */
export function resolveThread(
  config: { routes?: TelegramRoute[]; defaultThreadId?: number },
  subject: AlertSubject,
): number | undefined {
  for (const route of config.routes ?? []) if (routeMatches(route, subject)) return route.threadId
  return config.defaultThreadId
}

/**
 * Key that groups problem alerts into one message. Alerts for different topics never share a message,
 * so the thread is part of the key; the error text stays readable after the separator.
 */
export function routedGroupKey(threadId: number | null | undefined, groupKey: string) {
  return `${threadId ?? ""}\u0000${groupKey}`
}
