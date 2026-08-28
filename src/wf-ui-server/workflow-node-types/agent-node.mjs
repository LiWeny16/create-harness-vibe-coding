import crypto from 'node:crypto'
import { ComponentNodeError } from '../component-node-store.mjs'
import { loadWorkflowGraphMap, removeWorkflowGraphNode } from '../a2a-store.mjs'
import { listBridgeMessages, listBridgeMessagesForSession, recordBridgeMessage } from '../bridge-store.mjs'
import { appendSessionEvent, appendTerminalData } from '../terminal-store.mjs'

async function getWsTerminal() {
  return import('../ws-terminal.mjs')
}

async function getChatDriver() {
  return import('../chat-driver.mjs')
}

const PROMPT_SUBMIT_ENTER_DELAY_MS = 800
// Per-character gap when typing a prompt submit into the TUI composer.
// Canonical definition: src/wf-ui-server/server.mjs PROMPT_TYPING_CHAR_DELAY_MS.
const PROMPT_TYPING_CHAR_DELAY_MS = 12
const PROMPT_SUBMIT_READY_WAIT_MS = 10000
const PROMPT_SUBMIT_READY_POLL_MS = 250

function rethrow(error) {
  if (error instanceof ComponentNodeError) throw error
  const wrapped = new ComponentNodeError(error.message, {
    statusCode: error.statusCode,
    code: error.code,
  })
  wrapped.cause = error
  if (error?.stack) wrapped.stack = error.stack
  throw wrapped
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Resolve a graph node by graph node id or session id
function findGraphNode(projectRoot, key) {
  const graph = loadWorkflowGraphMap(projectRoot)
  return (graph.nodes || []).find(node =>
    (node.nodeId || node.id) === key || node.sessionId === key
  ) || null
}

function graphNodeId(node) {
  return node?.nodeId || node?.id || (node?.sessionId ? `session-${node.sessionId}` : '')
}

function assertAgentNode(projectRoot, key, label = 'Agent node') {
  const node = findGraphNode(projectRoot, key)
  if (!node?.sessionId) {
    throw new ComponentNodeError(`${label} not found`, {
      statusCode: 404,
      code: 'AGENT_NOT_FOUND',
    })
  }
  return node
}

function connectionEdges(graph = {}) {
  const graphEdges = Array.isArray(graph.edges) ? graph.edges : []
  const dockEdges = (Array.isArray(graph.capsuleDockLinks) ? graph.capsuleDockLinks : [])
    .flatMap(link => (Array.isArray(link?.connections) ? link.connections : [])
      .map(connection => ({
        from: connection?.from || connection?.source,
        to: connection?.to || connection?.target,
        direction: connection?.direction || 'bidirectional',
        relation: connection?.relation || 'wf-bridge',
      })))
  return [...graphEdges, ...dockEdges]
}

function isConnectedForMessage(graph, fromNodeId, toNodeId) {
  return connectionEdges(graph).some((edge) => {
    const from = String(edge?.from || edge?.source || '').trim()
    const to = String(edge?.to || edge?.target || '').trim()
    if (!from || !to) return false
    if (String(edge?.direction || '') === 'source-to-target') {
      return from === fromNodeId && to === toNodeId
    }
    return (from === fromNodeId && to === toNodeId) || (from === toNodeId && to === fromNodeId)
  })
}

function connectedAgentNodeIds(graph, fromNodeId) {
  const agentIds = new Set((Array.isArray(graph.nodes) ? graph.nodes : [])
    .filter(node => node?.sessionId)
    .map(graphNodeId)
    .filter(Boolean))
  const result = []
  const seen = new Set()
  for (const edge of connectionEdges(graph)) {
    const from = String(edge?.from || edge?.source || '').trim()
    const to = String(edge?.to || edge?.target || '').trim()
    if (!from || !to) continue
    let peer = ''
    if (from === fromNodeId && agentIds.has(to)) peer = to
    else if (to === fromNodeId && agentIds.has(from) && String(edge?.direction || '') !== 'source-to-target') peer = from
    if (!peer || peer === fromNodeId || seen.has(peer)) continue
    seen.add(peer)
    result.push(peer)
  }
  return result
}

function recipientList(payload = {}) {
  const raw = payload.to
    ?? payload.targets
    ?? payload.recipients
    ?? payload.recipientNodeIds
    ?? payload.targetNodeIds
    ?? payload.nodeIds
    ?? []
  const values = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,\n;]/)
  return values.map(value => String(value || '').trim()).filter(Boolean)
}

function normalizeMessageData(payload = {}) {
  const raw = payload.raw === true || payload.raw === 'true'
  const text = String(payload.data ?? payload.input ?? payload.text ?? payload.message ?? '')
  if (!text) {
    throw new ComponentNodeError('Agent message requires text, message, input, or data', {
      statusCode: 400,
      code: 'MESSAGE_REQUIRED',
    })
  }
  return raw || /[\r\n]$/.test(text) ? text : `${text}\r`
}

// F17/D14: a structured request reaches the target as a compact envelope
// prefix on the PTY input so the receiver can see the requestId (and echo it in
// replies) without parsing the bridge store. Composed only when structured
// fields are present; legacy text-only sends keep the exact previous input.
// The recorded bridge `data` stays the plain text body (spec §5).
function structuredEnvelopePrefix(envelope = {}) {
  const fields = []
  if (envelope.requestId) fields.push(envelope.requestId)
  if (envelope.toRole) fields.push(`to-role=${envelope.toRole}`)
  const contextRefs = (Array.isArray(envelope.contextRefs) ? envelope.contextRefs : [])
    .map(ref => String(ref?.nodeId || '').trim())
    .filter(Boolean)
  if (contextRefs.length) fields.push(`contextRefs=${contextRefs.join(',')}`)
  if (fields.length === 0) return ''
  return `[harness-request ${fields.join(' ')}]`
}

function messageEnvelope(payload = {}, mode = 'direct') {
  return {
    messageId: String(payload.messageId || crypto.randomUUID()),
    threadId: String(payload.threadId || payload.topic || ''),
    topic: String(payload.topic || ''),
    replyTo: String(payload.replyTo || payload.replyToMessageId || ''),
    requestId: String(payload.requestId || ''),
    toRole: String(payload.toRole || ''),
    contextRefs: payload.contextRefs || [],
    deliveryMode: String(payload.deliveryMode || mode),
    source: String(payload.source || `agent.${mode}Message`),
  }
}

// contextRefs entries are nodeId references only, never content (AC-019,
// spec 5). Accepts strings or {nodeId, relation} objects; rejects entries
// with no nodeId or with inlined markdown/body/content.
function normalizeContextRefs(payload = {}) {
  const raw = payload.contextRefs
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new ComponentNodeError('agent message contextRefs must be an array', {
      statusCode: 400,
      code: 'INVALID_CONTEXT_REFS',
    })
  }
  const refs = []
  for (const entry of raw) {
    let nodeId = ''
    let relation = ''
    if (typeof entry === 'string') {
      nodeId = String(entry).trim()
    } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      nodeId = String(entry.nodeId ?? entry.id ?? '').trim()
      relation = String(entry.relation ?? '').trim()
      if (entry.content != null || entry.body != null || entry.markdown != null) {
        throw new ComponentNodeError(
          'contextRefs must reference nodes by nodeId only; never inline content',
          { statusCode: 400, code: 'CONTEXT_REF_CONTENT_FORBIDDEN' }
        )
      }
    }
    if (!nodeId) {
      throw new ComponentNodeError('each contextRefs entry must carry a nodeId', {
        statusCode: 400,
        code: 'INVALID_CONTEXT_REFS',
      })
    }
    refs.push({ nodeId, relation })
  }
  return refs
}

function forceUnconnectedAllowed(sender, payload = {}) {
  const force = payload.force === true || payload.force === 'true'
  if (!force) return false
  if (String(sender.agentKind || '').toLowerCase() === 'main') return true
  throw new ComponentNodeError('Only Main Agent may force an unconnected Agent message', {
    statusCode: 403,
    code: 'MAIN_AGENT_FORCE_REQUIRED',
  })
}

// A target is a chat target when it runs a live chat driver (this server
// lifetime) or its persisted STATE.json carries uiMode === 'chat'.
async function targetIsChatSession(projectRoot, sessionId) {
  try {
    const chatDriver = await getChatDriver()
    if (chatDriver.hasLiveChatDriver(sessionId)) return true
  } catch { /* chat-driver unavailable — fall through to the disk record */ }
  try {
    const { findTerminalSession } = await import('../terminal-store.mjs')
    return findTerminalSession(projectRoot, sessionId)?.uiMode === 'chat'
  } catch {
    return false
  }
}

async function deliverAgentMessage(projectRoot, {
  graph,
  sender,
  targetKey,
  data,
  envelope,
  recipientIndex,
  recipientCount,
  requireConnection = true,
  ptyInput = null,
}) {
  const senderNodeId = graphNodeId(sender)
  const target = findGraphNode(projectRoot, targetKey)
  const targetNodeId = graphNodeId(target)
  if (!target?.sessionId || !targetNodeId) {
    return {
      ok: false,
      code: 'AGENT_NOT_FOUND',
      fromNodeId: senderNodeId,
      toNodeId: String(targetKey || ''),
      message: 'Target Agent node not found',
    }
  }
  if (targetNodeId === senderNodeId || target.sessionId === sender.sessionId) {
    return {
      ok: false,
      code: 'SELF_MESSAGE_SKIPPED',
      fromNodeId: senderNodeId,
      toNodeId: targetNodeId,
      fromSessionId: sender.sessionId,
      toSessionId: target.sessionId,
      message: 'Skipping self message',
    }
  }
  if (requireConnection && !isConnectedForMessage(graph, senderNodeId, targetNodeId)) {
    return {
      ok: false,
      code: 'NOT_CONNECTED',
      fromNodeId: senderNodeId,
      toNodeId: targetNodeId,
      fromSessionId: sender.sessionId,
      toSessionId: target.sessionId,
      message: 'Target Agent is not connected to sender',
    }
  }
  const input = ptyInput || data
  const targetSession = {
    sessionId: target.sessionId,
    taskId: target.taskId || null,
    runtime: target.runtime || 'agent',
  }
  if (await targetIsChatSession(projectRoot, target.sessionId)) {
    // Chat targets receive the message through their structured stdio driver
    // (steer=true lets the driver pick its mid-turn steering channel, falling
    // back to a plain send between turns); the TUI prompt-submit \r is
    // stripped. No PTY is involved, so NO_PTY never applies to chat targets.
    const { sendTo } = await getChatDriver()
    const chatText = String(input).replace(/[\r\n]+$/g, '')
    const sent = sendTo(target.sessionId, chatText, { steer: true })
    if (!sent) {
      return {
        ok: false,
        code: 'NO_CHAT_DRIVER',
        fromNodeId: senderNodeId,
        toNodeId: targetNodeId,
        fromSessionId: sender.sessionId,
        toSessionId: target.sessionId,
        message: 'No live chat driver attached to target Agent',
      }
    }
  } else {
    const { writePtyInput } = await getWsTerminal()
    // F17/D14: structured requests are delivered with the envelope prefix on
    // the PTY input; the bridge record keeps the plain text `data` (spec §5).
    // The input is submitted like a prompt submit (ready-gated, then a SINGLE
    // \r after a delay; never \r\n) so the enter cannot be swallowed by a TUI
    // startup flush.
    const sent = writePromptSubmitInput(writePtyInput, target.sessionId, input)
    if (!sent) {
      return {
        ok: false,
        code: 'NO_PTY',
        fromNodeId: senderNodeId,
        toNodeId: targetNodeId,
        fromSessionId: sender.sessionId,
        toSessionId: target.sessionId,
        message: 'No PTY process attached to target Agent',
      }
    }
    appendTerminalData(projectRoot, targetSession, input, 'stdin')
  }
  const bridgeMessage = recordBridgeMessage(projectRoot, {
    fromSessionId: sender.sessionId,
    toSessionId: target.sessionId,
    fromNodeId: senderNodeId,
    toNodeId: targetNodeId,
    data,
    ...envelope,
    recipientIndex,
    recipientCount,
  })
  appendSessionEvent(projectRoot, targetSession, {
    type: 'wf.bridge.message',
    bridgeId: bridgeMessage?.bridgeId || null,
    messageId: envelope.messageId,
    fromSessionId: sender.sessionId,
    toSessionId: target.sessionId,
    fromNodeId: senderNodeId,
    toNodeId: targetNodeId,
    deliveryMode: envelope.deliveryMode,
    topic: envelope.topic,
  })
  return {
    ok: true,
    code: 'DELIVERED',
    messageId: envelope.messageId,
    bridgeId: bridgeMessage?.bridgeId || null,
    seq: bridgeMessage?.seq || null,
    fromNodeId: senderNodeId,
    toNodeId: targetNodeId,
    fromSessionId: sender.sessionId,
    toSessionId: target.sessionId,
    topic: envelope.topic,
    replyTo: envelope.replyTo,
  }
}

function rangeOptions(payload = {}, defaultTail) {
  const opts = isPlainObject(payload) ? payload : {}
  const fromSeq = Number(opts.fromSeq)
  const toSeq = Number(opts.toSeq)
  const tail = Number(opts.tail)
  return {
    fromSeq: Number.isFinite(fromSeq) ? fromSeq : undefined,
    toSeq: Number.isFinite(toSeq) ? toSeq : undefined,
    tail: Number.isFinite(tail) && tail > 0 ? tail : defaultTail,
  }
}

// ── Prompt-submit input (ready-gated, char-by-char typing, single \r) ──
// Mirror of the canonical server.mjs tracker + writePromptSubmitInput
// (server.mjs: terminalInputState/pendingSubmitTimers + writePromptSubmitInput):
// the body is typed char-by-char with PROMPT_TYPING_CHAR_DELAY_MS gaps (a
// bulk body write + \r leaves text unsubmitted in the codex composer, per-char
// typing submits), ready-gated (wait for the prompt marker, polling every
// PROMPT_SUBMIT_READY_POLL_MS up to PROMPT_SUBMIT_READY_WAIT_MS, then submit
// anyway), and the submit follows as a SINGLE \r (0x0D, never \r\n) after
// PROMPT_SUBMIT_ENTER_DELAY_MS, with one retry. A new submit for the same
// session cancels every pending poll/char/enter timer of the previous submit
// so a stale \r can never hit a re-registered PTY. Importing server.mjs here
// would create a cycle (server.mjs -> workflow-node-runtime.mjs ->
// agent-node.mjs), so the tracker is duplicated instead. server.mjs feeds this
// tracker through the exported trackTerminalSpawn/markTerminalReady/
// clearTerminalState at the same spawn/ready/exit/stop sites as its own
// tracker, so the two stay in lockstep; untracked sessions (direct
// registration, tests) are treated as ready (same default as the canonical).

/** sessionId -> { ready: boolean } — prompt-marker readiness for submit gating */
const terminalInputState = new Map()

/** sessionId -> pending submit timers (ready polls + enter), cancelled by the next submit */
const pendingSubmitTimers = new Map()

export function trackTerminalSpawn(sessionId) {
  if (!sessionId) return
  if (!terminalInputState.has(sessionId)) terminalInputState.set(sessionId, { ready: false })
}

export function markTerminalReady(sessionId) {
  if (!sessionId) return
  const entry = terminalInputState.get(sessionId) || { ready: false }
  entry.ready = true
  terminalInputState.set(sessionId, entry)
}

export function clearTerminalState(sessionId) {
  if (!sessionId) return
  terminalInputState.delete(sessionId)
}

function terminalSubmitReady(sessionId) {
  const entry = terminalInputState.get(sessionId)
  // Untracked sessions (direct registration, tests) are treated as ready:
  // gating exists for server-spawned PTYs, which always record a spawn.
  if (!entry) return true
  return entry.ready === true
}

function cancelPendingSubmit(sessionId) {
  const timers = pendingSubmitTimers.get(sessionId)
  if (!timers) return
  for (const timer of timers) clearTimeout(timer)
  pendingSubmitTimers.delete(sessionId)
}

function scheduleSubmitTimer(sessionId, delayMs, fn) {
  const timer = setTimeout(fn, delayMs)
  const timers = pendingSubmitTimers.get(sessionId) || []
  timers.push(timer)
  pendingSubmitTimers.set(sessionId, timers)
  return timer
}

function writePromptSubmitInput(writePtyInput, sessionId, data) {
  const text = String(data || '')
  const body = text.replace(/[\r\n]+$/g, '')
  // A new submit supersedes any pending poll/char/enter of a previous submit.
  cancelPendingSubmit(sessionId)

  const scheduleEnter = () => {
    scheduleSubmitTimer(sessionId, PROMPT_SUBMIT_ENTER_DELAY_MS, () => {
      // Submit with a SINGLE \r (0x0D); never \r\n. Retry the enter once if
      // the PTY disappeared between the last char and the enter.
      if (!writePtyInput(sessionId, '\r')) {
        scheduleSubmitTimer(sessionId, PROMPT_SUBMIT_ENTER_DELAY_MS, () => writePtyInput(sessionId, '\r'))
      }
    })
  }

  const submit = () => {
    // Type the body char-by-char with PROMPT_TYPING_CHAR_DELAY_MS gaps, like
    // the xterm.js frontend delivers keystrokes: a bulk write of the whole
    // body + \r leaves the text unsubmitted in the codex composer, per-char
    // typing submits reliably. The first char is written synchronously so a
    // missing PTY still surfaces as NO_PTY (409) on the submit call; the
    // remaining chars and the enter ride the pending-timer list and are
    // cancelled by the next submit for the same session. An empty body skips
    // the char loop and just schedules the enter.
    const chars = Array.from(body)
    if (chars.length > 0 && !writePtyInput(sessionId, chars[0])) return false
    const typeNext = (index) => {
      if (index >= chars.length) {
        scheduleEnter()
        return
      }
      // Every remaining char (and the enter) rides the pending-timer list, so
      // a second submit for the same session aborts the whole sequence; stop
      // typing early if the PTY disappeared mid-sequence.
      scheduleSubmitTimer(sessionId, PROMPT_TYPING_CHAR_DELAY_MS, () => {
        if (!writePtyInput(sessionId, chars[index])) return
        typeNext(index + 1)
      })
    }
    typeNext(1)
    return true
  }

  if (terminalSubmitReady(sessionId)) return submit()

  // PTY is not ready yet: poll for the prompt marker, then submit anyway.
  const startedAt = Date.now()
  const poll = () => {
    if (terminalSubmitReady(sessionId) || Date.now() - startedAt >= PROMPT_SUBMIT_READY_WAIT_MS) {
      submit()
      return
    }
    scheduleSubmitTimer(sessionId, PROMPT_SUBMIT_READY_POLL_MS, poll)
  }
  poll()
  return true
}

// Read latest terminal output for an agent node's session
export async function readOutput(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const { readTerminalRange } = await import('../terminal-store.mjs')
    const result = readTerminalRange(projectRoot, {
      sessionId,
      ...rangeOptions(payload, 50),
    })
    return { sessionId, entries: result.entries || [], ...result }
  } catch (error) {
    rethrow(error)
  }
}

// Send input to the agent's terminal
export async function sendInput(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const text = String(payload?.data ?? payload?.input ?? payload?.text ?? '')
    const { writePtyInput } = await getWsTerminal()
    const promptSubmit = payload?.submit === true || payload?.promptSubmit === true
    const sent = promptSubmit
      ? writePromptSubmitInput(writePtyInput, sessionId, text)
      : writePtyInput(sessionId, text)
    if (!sent) {
      throw new ComponentNodeError('No PTY process attached to this session', {
        statusCode: 409,
        code: 'NO_PTY',
      })
    }
    return { ok: true, sessionId, sent }
  } catch (error) {
    rethrow(error)
  }
}

export async function sendMessage(nodeId, projectRoot, payload = {}) {
  try {
    const sender = assertAgentNode(projectRoot, nodeId, 'Sender Agent node')
    const graph = loadWorkflowGraphMap(projectRoot)
    const targets = recipientList(payload)
    if (targets.length === 0) {
      throw new ComponentNodeError('agent.sendMessage requires one recipient in to/target', {
        statusCode: 400,
        code: 'RECIPIENT_REQUIRED',
      })
    }
    if (targets.length > 1) {
      throw new ComponentNodeError('agent.sendMessage accepts exactly one recipient; use agent.broadcastMessage for multiple recipients', {
        statusCode: 400,
        code: 'TOO_MANY_RECIPIENTS',
      })
    }
    const data = normalizeMessageData(payload)
    const contextRefs = normalizeContextRefs(payload)
    const envelope = { ...messageEnvelope(payload, 'direct'), contextRefs }
    const force = forceUnconnectedAllowed(sender, payload)
    const prefix = structuredEnvelopePrefix(envelope)
    const delivery = await deliverAgentMessage(projectRoot, {
      graph,
      sender,
      targetKey: targets[0],
      data,
      envelope,
      recipientIndex: 1,
      recipientCount: 1,
      requireConnection: !force,
      ptyInput: prefix ? `${prefix} ${data}` : data,
    })
    if (!delivery.ok) {
      throw new ComponentNodeError(delivery.message || 'Agent message delivery failed', {
        statusCode: delivery.code === 'NOT_CONNECTED' ? 403 : 409,
        code: delivery.code || 'MESSAGE_DELIVERY_FAILED',
        details: delivery,
      })
    }
    return {
      ok: true,
      mode: 'direct',
      messageId: envelope.messageId,
      threadId: envelope.threadId,
      requestId: envelope.requestId,
      topic: envelope.topic,
      deliveries: [delivery],
    }
  } catch (error) {
    rethrow(error)
  }
}

export async function broadcastMessage(nodeId, projectRoot, payload = {}) {
  try {
    const sender = assertAgentNode(projectRoot, nodeId, 'Sender Agent node')
    const graph = loadWorkflowGraphMap(projectRoot)
    const explicitTargets = recipientList(payload)
    const targets = explicitTargets.length > 0
      ? explicitTargets
      : connectedAgentNodeIds(graph, graphNodeId(sender))
    if (targets.length === 0) {
      throw new ComponentNodeError('agent.broadcastMessage found no recipients', {
        statusCode: 400,
        code: 'RECIPIENT_REQUIRED',
      })
    }
    const data = normalizeMessageData(payload)
    const contextRefs = normalizeContextRefs(payload)
    const envelope = { ...messageEnvelope(payload, 'broadcast'), contextRefs }
    const force = forceUnconnectedAllowed(sender, payload)
    const prefix = structuredEnvelopePrefix(envelope)
    const uniqueTargets = [...new Set(targets)]
    const deliveries = []
    for (let index = 0; index < uniqueTargets.length; index += 1) {
      deliveries.push(await deliverAgentMessage(projectRoot, {
        graph,
        sender,
        targetKey: uniqueTargets[index],
        data,
        envelope,
        recipientIndex: index + 1,
        recipientCount: uniqueTargets.length,
        requireConnection: !force,
        ptyInput: prefix ? `${prefix} ${data}` : data,
      }))
    }
    const deliveredCount = deliveries.filter(item => item.ok).length
    return {
      ok: deliveredCount === deliveries.length,
      mode: 'broadcast',
      messageId: envelope.messageId,
      threadId: envelope.threadId,
      requestId: envelope.requestId,
      topic: envelope.topic,
      deliveredCount,
      failedCount: deliveries.length - deliveredCount,
      deliveries,
    }
  } catch (error) {
    rethrow(error)
  }
}

export function readMessages(nodeId, projectRoot, payload = {}) {
  try {
    const sender = assertAgentNode(projectRoot, nodeId, 'Reader Agent node')
    const opts = isPlainObject(payload) ? payload : {}
    const requestId = String(opts.requestId || '').trim()
    const threadId = String(opts.threadId || '').trim()
    const wakeup = opts.wakeup === true || opts.wakeup === 'true'
    const peerKey = String(opts.peer || opts.to || opts.from || opts.target || opts.node || '').trim()
    const limit = Number(opts.limit || opts.tail || 200)
    const senderNodeId = graphNodeId(sender)

    // New filters (spec 5, 6.1): requestId aggregation and wakeup reads.
    if (requestId || wakeup) {
      if (wakeup) {
        const result = listBridgeMessagesForSession(projectRoot, sender.sessionId, {
          deliveryMode: 'wakeup',
          limit,
        })
        return {
          ok: true,
          mode: 'wakeup',
          fromNodeId: senderNodeId,
          fromSessionId: sender.sessionId,
          entries: result.entries,
          count: result.entries.length,
        }
      }
      // Aggregate all replies in one request thread across peers (AC-010).
      const graph = loadWorkflowGraphMap(projectRoot)
      const peerNodeIds = peerKey
        ? [peerKey]
        : (Array.isArray(graph.nodes) ? graph.nodes : [])
            .filter(item => item?.sessionId)
            .map(graphNodeId)
            .filter(itemId => itemId && itemId !== senderNodeId)
      const collected = []
      for (const peerId of peerNodeIds) {
        const peer = assertAgentNode(projectRoot, peerId, 'Peer Agent node')
        const read = listBridgeMessages(projectRoot, {
          fromSessionId: sender.sessionId,
          toSessionId: peer.sessionId,
          limit: Math.max(Number(limit) || 200, 1000),
        })
        for (const entry of read.entries) {
          if (entry.requestId !== requestId) continue
          if (threadId && entry.threadId !== threadId) continue
          collected.push(entry)
        }
      }
      collected.sort((a, b) => {
        const tsA = String(a.ts || '')
        const tsB = String(b.ts || '')
        return tsA === tsB ? (Number(a.seq) || 0) - (Number(b.seq) || 0) : tsA.localeCompare(tsB)
      })
      return {
        ok: true,
        mode: 'request',
        requestId,
        threadId,
        fromNodeId: senderNodeId,
        fromSessionId: sender.sessionId,
        toNodeId: peerKey || null,
        entries: collected.slice(-(Number(limit) > 0 ? Number(limit) : collected.length)),
        count: collected.length,
      }
    }

    // Legacy behavior unchanged (AC-026/T14): peer-scoped read.
    if (!peerKey) {
      throw new ComponentNodeError('agent.readMessages requires peer/to/from target Agent node', {
        statusCode: 400,
        code: 'PEER_REQUIRED',
      })
    }
    const peer = assertAgentNode(projectRoot, peerKey, 'Peer Agent node')
    return {
      ok: true,
      ...listBridgeMessages(projectRoot, {
        fromSessionId: sender.sessionId,
        toSessionId: peer.sessionId,
        limit,
      }),
      fromNodeId: senderNodeId,
      toNodeId: graphNodeId(peer),
    }
  } catch (error) {
    rethrow(error)
  }
}

// Read the agent's transcript from disk
export async function readTranscript(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const { readTerminalRange } = await import('../terminal-store.mjs')
    const result = readTerminalRange(projectRoot, {
      sessionId,
      ...rangeOptions(payload, 200),
    })
    return { sessionId, entries: result.entries || [], ...result }
  } catch (error) {
    rethrow(error)
  }
}

// Start an agent node; the server control plane owns PTY spawning
export function start(nodeId, projectRoot, payload = {}) {
  throw new ComponentNodeError(
    'agent.start is delegated to the server control plane. Use POST /api/a2a/nodes/:id/start',
    { statusCode: 400, code: 'USE_A2A_START' }
  )
}

// Stop an agent node's session and kill its PTY
export async function stop(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    const sessionId = node?.sessionId || nodeId
    const { killPtyProcess } = await getWsTerminal()
    killPtyProcess(sessionId)
    return { ok: true, sessionId, stopped: true }
  } catch (error) {
    rethrow(error)
  }
}

// Restart an agent node; the server control plane owns PTY respawning
export function restart(nodeId, projectRoot, payload = {}) {
  throw new ComponentNodeError(
    'agent.restart is delegated to the server control plane. Use POST /api/a2a/nodes/:id/restart',
    { statusCode: 400, code: 'USE_A2A_START' }
  )
}

// Delete an agent node from the workflow graph (must be stopped first)
export function deleteAgentNode(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    if (!node) {
      throw new ComponentNodeError('Agent node not found in graph', { statusCode: 404, code: 'NOT_FOUND' })
    }
    if (node.status === 'running' || node.status === 'starting') {
      throw new ComponentNodeError('Stop the agent before deleting', { statusCode: 409, code: 'NODE_LIVE' })
    }
    const removed = removeWorkflowGraphNode(projectRoot, nodeId)
    return { ok: true, removed: removed.removed }
  } catch (error) {
    rethrow(error)
  }
}

// Build context for an agent node (connected peers, available actions)
export function readContext(nodeId, projectRoot, payload = {}) {
  try {
    const node = findGraphNode(projectRoot, nodeId)
    if (!node) {
      throw new ComponentNodeError('Agent node not found', { statusCode: 404, code: 'NOT_FOUND' })
    }
    const graph = loadWorkflowGraphMap(projectRoot)
    const nodeKey = node.nodeId || node.id
    const sessionKey = node.sessionId
    const connections = (graph.edges || [])
      .filter(edge =>
        (edge.from === nodeKey || edge.to === nodeKey)
        || (edge.source === nodeKey || edge.target === nodeKey)
        || (sessionKey && (edge.fromSessionId === sessionKey || edge.toSessionId === sessionKey))
      )
      .map(edge => {
        const isSource = edge.from === nodeKey || edge.source === nodeKey || edge.fromSessionId === sessionKey
        return {
          edgeId: edge.id || `${edge.from}->${edge.to}`,
          peerNodeId: isSource ? (edge.to || edge.toSessionId) : (edge.from || edge.fromSessionId),
          endpointRole: isSource ? 'source' : 'target',
          localHandle: isSource ? edge.sourceHandle || null : edge.targetHandle || null,
          peerHandle: isSource ? edge.targetHandle || null : edge.sourceHandle || null,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
          relation: edge.relation || 'wf-bridge',
          direction: 'bidirectional',
        }
      })
    const live = node.status === 'running' || node.status === 'starting'
    return {
      node,
      connections,
      availableActions: live
        ? [
            'sendInput',
            'sendMessage',
            'broadcastMessage',
            'readMessages',
            'readOutput',
            'readTranscript',
            'stop',
            'agent.createNode',
            'agent.connectNodes',
            'agent.disconnectNodes',
            'agent.moveNode',
            'agent.deleteNode',
            'agent.deleteNodes',
            'agent.readGraph',
          ]
        : ['start', 'delete', 'agent.readGraph'],
    }
  } catch (error) {
    rethrow(error)
  }
}

// The workflow-node-runtime routes "agent.delete" to the "delete" adapter suffix
export { deleteAgentNode as delete }
