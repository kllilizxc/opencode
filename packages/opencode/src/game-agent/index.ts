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

export { bootstrap, Session, SessionPrompt, Provider, Agent, Bus, MessageV2, Log }

export interface RunInput {
  prompt: string
  system?: string
  agent?: string
  model?: string
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

    const session = await Session.create({})
    onEvent?.({ type: "session", sessionId: session.id })
    const messageID = Identifier.ascending("message")
    const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
      const part = event.properties.part
      
      if (part.sessionID !== session.id) return
      // filter out user prompt
      if (part.messageID === messageID) return
      
      if (part.type === "text") {
        if (part.time?.end) {
          // Final complete text
          onEvent?.({ type: "text", sessionId: session.id, data: { text: part.text } })
        } else {
          // Streaming delta
          onEvent?.({ type: "text-delta", sessionId: session.id, data: { text: part.text, id: part.id } })
        }
      }
      
      if (part.type === "tool") {
        const title = part.state.status === "running" || part.state.status === "completed" 
          ? part.state.title || JSON.stringify(part.state.input)
          : JSON.stringify(part.state.input)
        
        if (part.state.status === "completed") {
          onEvent?.({ type: "tool", sessionId: session.id, data: { tool: part.tool, title, callId: part.callID } })
        } else if (part.state.status === "running" || part.state.status === "pending") {
          onEvent?.({ type: "tool-start", sessionId: session.id, data: { tool: part.tool, title, callId: part.callID } })
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
