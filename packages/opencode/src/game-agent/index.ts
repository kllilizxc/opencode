// Game Agent Wrapper - lives inside opencode so @/* imports resolve correctly
// This is YOUR code for building custom agent logic on top of OpenCode

import { bootstrap } from "@/cli/bootstrap"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { MessageV2 } from "@/session/message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"

export { bootstrap, Session, SessionPrompt, Provider, Agent, Bus, MessageV2, Log }

export interface RunInput {
  prompt: string
  system?: string
  agent?: string
  model?: string
  /** Optional session ID to reuse - enables message history persistence */
  sessionId?: string
}

export interface AgentEvent {
  type: "session" | "text" | "text-delta" | "tool" | "tool-start" | "finished" | "error"
  sessionId?: string
  data?: unknown
}

export type EventCallback = (event: AgentEvent) => void

export async function initRuntime(cwd: string) {
  await Log.init({ print: true, level: "INFO" })
  return { cwd }
}

export async function run(cwd: string, input: RunInput, onEvent?: EventCallback) {
  await Log.init({ print: true, level: "INFO" })

  return bootstrap(cwd, async () => {
    const model = input.model
      ? Provider.parseModel(input.model)
      : await Provider.defaultModel()

    const agentName = input.agent ?? await Agent.defaultAgent()

    // Reuse existing session or create new one
    let session: Session.Info
    let isNewSession = false

    if (input.sessionId) {
      const existing = await Session.get(input.sessionId)
      if (existing) {
        session = existing
        Log.create({ service: "game-agent" }).info(`Resuming session ${session.id}`)
      } else {
        // Session ID provided but not found - create new with that ID
        session = await Session.createNext({ id: input.sessionId, directory: Instance.directory })
        isNewSession = true
        Log.create({ service: "game-agent" }).info(`Created new session with provided ID ${session.id}`)
      }
    } else {
      session = await Session.create({})
      isNewSession = true
    }

    onEvent?.({ type: "session", sessionId: session.id, data: { isNewSession } })

    const messageID = Identifier.ascending("message")
    const startTime = Date.now()
    const log = (eventType: string, details?: string) => {
      const elapsed = Date.now() - startTime
      console.log(`[game-agent] +${elapsed}ms ${Date.now()} ${eventType}${details ? `: ${details}` : ''}`)
    }

    const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
      const part = event.properties.part

      if (part.sessionID !== session.id) return
      // filter out user prompt
      if (part.messageID === messageID) return

      if (part.type === "text") {
        if (part.time?.end) {
          // Final complete text
          log("text", `len=${part.text.length}`)
          onEvent?.({ type: "text", sessionId: session.id, data: { text: part.text } })
        } else {
          // Streaming delta
          log("text-delta", `len=${part.text.length}`)
          onEvent?.({ type: "text-delta", sessionId: session.id, data: { text: part.text, id: part.id, messageID: part.messageID } })
        }
      }

      if (part.type === "tool") {
        // Generate a meaningful title for the tool
        let title = (part.state as any).title as string | undefined
        if (!title) {
          const input = part.state.input
          // Special handling for todowrite to show todo count
          if (part.tool === "todowrite" && input?.todos && Array.isArray(input.todos)) {
            const pendingCount = input.todos.filter((t: any) => t.status !== "completed").length
            title = `${pendingCount} todos`
          } else if (input && typeof input === "object" && Object.keys(input).length > 0) {
            title = JSON.stringify(input)
          } else {
            title = "" // Don't show "{}" for empty inputs
          }
        }

        // Get metadata (contains todos for todowrite, etc.)
        const metadata = (part.state as any).metadata

        if (part.state.status === "completed") {
          log("tool", `${part.tool} completed`)
          onEvent?.({ type: "tool", sessionId: session.id, data: { tool: part.tool, title, callId: part.callID, metadata } })
        } else if (part.state.status === "running" || part.state.status === "pending") {
          log("tool-start", `${part.tool} ${part.state.status}`)
          onEvent?.({ type: "tool-start", sessionId: session.id, data: { tool: part.tool, title, callId: part.callID, metadata } })
        }
      }
    })

    const result = await SessionPrompt.prompt({
      messageID,
      sessionID: session.id,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
      agent: agentName,
      system: input.system,
      parts: [{ type: "text", text: input.prompt }],
    })

    unsub()

    const finishReason = result.info.role === "assistant" ? result.info.finish : "unknown"
    onEvent?.({ type: "finished", sessionId: session.id, data: { finishReason } })

    return { session, result, finishReason }
  })
}
