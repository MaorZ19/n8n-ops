import { and, asc, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm"
import { type Ctx, changed } from "../context.ts"
import { type AlertKind, alertGroups, alertOutbox, alertState, instances, problems, workflows } from "../db/schema.ts"
import { type AlertSubject, resolveThread, routedGroupKey } from "./alert-routing.ts"
import { clip, html, type InlineButton, Telegram, TelegramError, TelegramHtml } from "./telegram.ts"

type ProblemRow = typeof problems.$inferSelect

/** Queues a problem alert. It waits for the grouping window so problems with the same error go out together. */
export async function enqueueProblemAlert(ctx: Ctx, problem: ProblemRow, reason: "new" | "regression") {
  const alerts = await ctx.settings.get("alerts")
  if (reason === "new" && !alerts.newProblem) return
  if (reason === "regression" && !alerts.regression) return
  const threadId = await threadFor(ctx, await problemSubject(ctx, problem))
  await ctx.db.insert(alertOutbox).values({
    kind: "problem",
    groupKey: problem.errorMessage,
    problemId: problem.id,
    threadId,
    text: reason,
    sendAfter: new Date(Date.now() + alerts.groupingWindowSec * 1000),
  })
}

async function problemSubject(ctx: Ctx, problem: ProblemRow): Promise<AlertSubject> {
  const [row] = await ctx.db
    .select({ instanceName: instances.name, tags: workflows.tags })
    .from(instances)
    .leftJoin(workflows, and(eq(workflows.instanceId, instances.id), eq(workflows.workflowId, problem.workflowId)))
    .where(eq(instances.id, problem.instanceId))
  return { instanceName: row?.instanceName, workflowName: problem.workflowName, tags: row?.tags ?? [] }
}

/** The forum topic for an alert about `subject`, from Settings > Telegram routes. Null is the General topic. */
export async function threadFor(ctx: Ctx, subject: AlertSubject): Promise<number | null> {
  return resolveThread(await ctx.settings.get("telegram"), subject) ?? null
}

/** Queues an immediate alert (health, backup, test). `subject` picks its forum topic. */
export async function enqueueAlert(
  ctx: Ctx,
  kind: Exclude<AlertKind, "problem">,
  text: TelegramHtml,
  subject: AlertSubject = {},
) {
  const alerts = await ctx.settings.get("alerts")
  if ((kind === "health" && !alerts.health) || (kind === "backup" && !alerts.backup)) return
  await ctx.db.insert(alertOutbox).values({ kind, text: String(text), threadId: await threadFor(ctx, subject) })
}

/**
 * Tracks an ongoing condition (instance down, backup stale) so it alerts once when it starts
 * and once when it clears. The texts are made only when the condition changes.
 */
export async function setCondition(
  ctx: Ctx,
  key: string,
  active: boolean,
  {
    kind,
    start,
    clear,
    subject,
  }: { kind: "health" | "backup"; start: () => TelegramHtml; clear?: () => TelegramHtml; subject?: AlertSubject },
) {
  const [row] = await ctx.db.select().from(alertState).where(eq(alertState.key, key))
  if (active && !row?.active) {
    const text = start()
    const detail = String(text)
    await ctx.db
      .insert(alertState)
      .values({ key, active: true, since: new Date(), detail })
      .onConflictDoUpdate({ target: alertState.key, set: { active: true, since: new Date(), detail } })
    await enqueueAlert(ctx, kind, text, subject)
  } else if (!active && row?.active) {
    await ctx.db.update(alertState).set({ active: false, since: new Date() }).where(eq(alertState.key, key))
    if (clear) await enqueueAlert(ctx, kind, clear(), subject)
  }
}

export type GroupLine = {
  workflowName: string
  instanceName: string
  nodeName: string
  count: number
  regression: boolean
  status: string
}

/** Text of a grouped problem message. */
export function renderProblemGroup(error: string, lines: GroupLine[], footer?: TelegramHtml): TelegramHtml {
  const regression = lines.some((l) => l.regression)
  const title =
    lines.length === 1
      ? regression
        ? "Regression"
        : "New problem"
      : `${regression ? "Problems" : "New problem"} in ${lines.length} workflows`
  const body = lines
    .slice(0, 15)
    .map(
      (l) =>
        html`• <b>${clip(l.workflowName, 80)}</b> on ${clip(l.instanceName, 200)} · ${clip(l.nodeName, 60)}${
          l.regression ? " (again)" : ""
        }${l.status !== "open" ? ` [${l.status}]` : ""}`,
    )
  if (lines.length > 15) body.push(html`…and ${lines.length - 15} more`)
  return TelegramHtml.join([
    html`<b>${title}</b>`,
    html`<code>${clip(error, 500)}</code>`,
    html``,
    ...body,
    ...(footer ? [html``, footer] : []),
  ])
}

export async function telegramClient(ctx: Ctx) {
  const tg = await ctx.settings.get("telegram")
  if (!tg.botTokenEnc || !tg.chatId) return null
  return {
    api: new Telegram(ctx.secrets.decrypt(tg.botTokenEnc)),
    chatId: tg.chatId,
    secret: tg.webhookSecret,
    accessThreadId: tg.accessThreadId ?? tg.defaultThreadId,
  }
}

async function groupLines(ctx: Ctx, problemIds: string[]): Promise<{ lines: GroupLine[]; first?: ProblemRow }> {
  if (!problemIds.length) return { lines: [] }
  const rows = await ctx.db
    .select({ p: problems, instanceName: instances.name })
    .from(problems)
    .innerJoin(instances, eq(problems.instanceId, instances.id))
    .where(inArray(problems.id, problemIds))
  return {
    first: rows[0]?.p,
    lines: rows.map(({ p, instanceName }) => ({
      workflowName: p.workflowName,
      instanceName,
      nodeName: p.nodeName,
      count: p.count,
      regression: p.regression,
      status: p.status,
    })),
  }
}

async function groupButtons(ctx: Ctx, groupId: string, firstProblemId?: string): Promise<InlineButton[][]> {
  const { publicUrl } = await ctx.settings.get("general")
  const rows: InlineButton[][] = [
    [
      { text: "Resolved", callback_data: `r:${groupId}` },
      { text: "Mute 24 h", callback_data: `m:${groupId}` },
    ],
  ]
  if (publicUrl && firstProblemId) {
    rows.push([{ text: "Open", url: `${publicUrl.replace(/\/+$/, "")}/problems/${firstProblemId}` }])
  }
  return rows
}

/** Sends due alerts. Problem alerts are grouped by error text and edit a recent message instead of resending. */
export async function dispatchAlerts(ctx: Ctx) {
  const due = await ctx.db
    .select()
    .from(alertOutbox)
    .where(and(eq(alertOutbox.status, "pending"), lte(alertOutbox.sendAfter, new Date())))
    .orderBy(asc(alertOutbox.createdAt))
    .limit(200)
  if (!due.length) return
  const tg = await telegramClient(ctx)
  const settings = await ctx.settings.get("alerts")
  if (!tg) {
    await ctx.db
      .update(alertOutbox)
      .set({ status: "failed", lastError: "Telegram is not configured" })
      .where(
        inArray(
          alertOutbox.id,
          due.map((d) => d.id),
        ),
      )
    return
  }

  // Problems with the same error go out together, but only within one forum topic.
  const groups = new Map<string, typeof due>()
  for (const row of due.filter((d) => d.kind === "problem")) {
    const key = routedGroupKey(row.threadId, row.groupKey ?? row.id)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  for (const rows of groups.values()) {
    const ids = rows.map((r) => r.id)
    const groupKey = rows[0]?.groupKey ?? rows[0]?.id ?? ""
    const threadId = rows[0]?.threadId ?? null
    try {
      const newIds = rows.map((r) => r.problemId).filter((id): id is string => Boolean(id))
      const since = new Date(Date.now() - settings.editWindowMin * 60_000)
      const [recent] = await ctx.db
        .select()
        .from(alertGroups)
        .where(
          and(
            eq(alertGroups.groupKey, groupKey),
            threadId === null ? isNull(alertGroups.threadId) : eq(alertGroups.threadId, threadId),
            gt(alertGroups.createdAt, since),
          ),
        )
        .orderBy(desc(alertGroups.createdAt))
        .limit(1)
      if (recent && settings.editWindowMin > 0) {
        const all = [...new Set([...recent.problemIds, ...newIds])]
        const { lines, first } = await groupLines(ctx, all)
        await tg.api.edit(
          tg.chatId,
          recent.telegramMessageId,
          renderProblemGroup(groupKey, lines),
          await groupButtons(ctx, recent.id, first?.id),
        )
        await ctx.db.update(alertGroups).set({ problemIds: all }).where(eq(alertGroups.id, recent.id))
        await ctx.db
          .update(alertOutbox)
          .set({ status: "merged", sentAt: new Date(), telegramMessageId: recent.telegramMessageId })
          .where(inArray(alertOutbox.id, ids))
      } else {
        const { lines, first } = await groupLines(ctx, newIds)
        const [group] = await ctx.db
          .insert(alertGroups)
          .values({ groupKey, threadId, telegramMessageId: 0, problemIds: newIds })
          .returning()
        if (!group) throw new Error("could not record the alert group")
        const messageId = await tg.api.send(
          tg.chatId,
          renderProblemGroup(groupKey, lines),
          await groupButtons(ctx, group.id, first?.id),
          threadId,
        )
        await ctx.db.update(alertGroups).set({ telegramMessageId: messageId }).where(eq(alertGroups.id, group.id))
        await ctx.db
          .update(alertOutbox)
          .set({ status: "sent", sentAt: new Date(), telegramMessageId: messageId })
          .where(inArray(alertOutbox.id, ids))
      }
    } catch (error) {
      await markRetry(ctx, ids, error, settings.retryMin)
    }
  }

  for (const row of due.filter((d) => d.kind !== "problem")) {
    try {
      const messageId = await tg.api.send(tg.chatId, TelegramHtml.stored(row.text), [], row.threadId)
      await ctx.db
        .update(alertOutbox)
        .set({ status: "sent", sentAt: new Date(), telegramMessageId: messageId })
        .where(eq(alertOutbox.id, row.id))
    } catch (error) {
      await markRetry(ctx, [row.id], error, settings.retryMin)
    }
  }
}

async function markRetry(ctx: Ctx, ids: string[], error: unknown, retryMin: number) {
  const wait = error instanceof TelegramError && error.retryAfter ? error.retryAfter * 1000 : retryMin * 60_000
  for (const id of ids) {
    const [row] = await ctx.db
      .select({ attempts: alertOutbox.attempts })
      .from(alertOutbox)
      .where(eq(alertOutbox.id, id))
    await ctx.db
      .update(alertOutbox)
      .set({
        attempts: (row?.attempts ?? 0) + 1,
        lastError: (error as Error).message,
        sendAfter: new Date(Date.now() + wait),
      })
      .where(eq(alertOutbox.id, id))
  }
  ctx.log.warn("alert delivery failed, will retry", { error: (error as Error).message, retryInMs: wait })
}

export type CallbackUpdate = {
  callback_query?: {
    id: string
    data?: string
    from?: { id: number; username?: string; first_name?: string }
    message?: { message_id: number; chat?: { id: number | string }; text?: string }
  }
}

/** Handles a Resolved or Mute button press from Telegram. Returns false if the update is not ours. */
export async function handleTelegramCallback(ctx: Ctx, update: CallbackUpdate): Promise<boolean> {
  const cb = update.callback_query
  const tg = await telegramClient(ctx)
  if (!cb?.data || !tg) return false
  if (String(cb.message?.chat?.id) !== tg.chatId) return false
  const [action, groupId] = cb.data.split(":")
  if (!groupId || (action !== "r" && action !== "m")) return false
  const [group] = await ctx.db.select().from(alertGroups).where(eq(alertGroups.id, groupId))
  if (!group) {
    await tg.api.answerCallback(cb.id, "This alert is no longer known.")
    return true
  }
  const who = cb.from?.username ? `@${cb.from.username}` : (cb.from?.first_name ?? "someone")
  const patch =
    action === "r"
      ? { status: "resolved" as const, resolvedAt: new Date(), mutedUntil: null }
      : { status: "muted" as const, mutedUntil: new Date(Date.now() + 24 * 3600_000) }
  if (group.problemIds.length) await ctx.db.update(problems).set(patch).where(inArray(problems.id, group.problemIds))
  changed(ctx, "problems", "overview")
  await ctx.audit({
    actor: `telegram:${who}`,
    action: action === "r" ? "Problem resolved" : "Problem muted for 24 hours",
    target: `${group.problemIds.length} problem(s): ${clip(group.groupKey, 120)}`,
    via: "telegram",
  })
  const { lines } = await groupLines(ctx, group.problemIds)
  await tg.api.edit(
    tg.chatId,
    group.telegramMessageId,
    renderProblemGroup(
      group.groupKey,
      lines,
      html`<i>${action === "r" ? "Resolved" : "Muted for 24 hours"} by ${who}</i>`,
    ),
  )
  await tg.api.answerCallback(cb.id, action === "r" ? "Marked as resolved" : "Muted for 24 hours")
  return true
}

let appliedWebhook = ""

/** Points the Telegram bot at this installation when the token, secret or public URL changes. */
export async function syncTelegramWebhook(ctx: Ctx) {
  const tg = await telegramClient(ctx)
  const { publicUrl } = await ctx.settings.get("general")
  if (!tg || !publicUrl || !tg.secret) return
  const url = `${publicUrl.replace(/\/+$/, "")}/api/telegram/webhook`
  const key = `${url}|${tg.secret}|${tg.chatId}`
  if (key === appliedWebhook) return
  await tg.api.setWebhook(url, tg.secret)
  appliedWebhook = key
  ctx.log.info("Telegram webhook set", { url })
}

export async function sendTestTelegram(ctx: Ctx) {
  const tg = await telegramClient(ctx)
  if (!tg) throw new Error("Telegram is not configured: set the bot token and chat ID.")
  const { defaultThreadId } = await ctx.settings.get("telegram")
  await tg.api.send(tg.chatId, html`<b>n8n-ops test message</b>\nAlerts will arrive here.`, [], defaultThreadId)
}
