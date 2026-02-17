import z from "zod"
import path from "path"
import fs from "fs/promises"

// Plugin-style tool definition
export default {
    description: `generate_image(prompt: string, size?: string)

- prompt: A detailed text description of the image you want to generate.
- size: Optional. The size of the image to generate (support: "1024x1024" (1:1), "1280x720" (16:9), "720x1280" (9:16), "1216x896" (4:3)). Defaults to "1024x1024".

## Examples

generate_image(prompt: "A futuristic city with flying cars at sunset", size: "1280x720")
generate_image(prompt: "A cute pixel art cat", size: "1024x1024")
`,
    args: {
        prompt: z.string().describe("The text prompt to generate an image for"),
        size: z
            .enum(["1024x1024", "1280x720", "720x1280", "1216x896"])
            .optional()
            .describe('The size of the image (default: "1024x1024"). Support: "1024x1024", "1280x720", "720x1280", "1216x896"'),
    },
    async execute(params: any, ctx: any) {
        await ctx.ask({
            permission: "generate_image",
            patterns: ["*"],
            always: [],
            metadata: {
                prompt: params.prompt,
                size: params.size,
            },
        })

        // Dynamic import to avoid build issues if package is missing in this workspace
        const { OpenAI } = await import("openai")

        const client = new OpenAI({
            baseURL: process.env.NANOBANANA_BASE_URL || "http://127.0.0.1:8045/v1",
            apiKey: process.env.NANOBANANA_API_KEY || "sk-0c30858760cf47fe9d6e438da54d3808",
        })

        const model = "gemini-3-pro-image"

        try {
            const response = await client.chat.completions.create({
                model: model,
                messages: [{
                    "role": "user",
                    "content": params.prompt
                }],
                tools: [{
                    type: "function",
                    function: {
                        name: "generate_image",
                        description: "Generates an image based on the prompt",
                        parameters: {
                            type: "object",
                            properties: {
                                prompt: { type: "string" }
                            }
                        }
                    }
                }]
            } as any)

            let imageUrl = ""
            let buffer: Buffer

            let content = response.choices[0].message.content
            if (!content) {
                throw new Error("No content received from image generation model")
            }

            console.log("[GenerateImage] Content length:", content.length)

            // Extract all potential image URLs/Data URIs
            // 1. Data URI pattern: data:image/... up to closing parenthesis or space
            // 2. Markdown pattern: ![...](...)

            let extractedUrl = ""

            // Priority 1: Data URI (most robust for base64)
            // Use match to find the first one. The regex ensures we don't capture trailing markdown syntax
            const dataUrlMatch = content.match(/data:image\/[^)\s]+/)
            if (dataUrlMatch) {
                extractedUrl = dataUrlMatch[0]
                console.log("[GenerateImage] Found Data URI match, length:", extractedUrl.length)
            } else {
                // Priority 2: Markdown Image
                const markdownMatch = content.match(/!\[.*?\]\(([\s\S]*?)\)/)
                if (markdownMatch && markdownMatch[1]) {
                    extractedUrl = markdownMatch[1].trim()
                    console.log("[GenerateImage] Found Markdown URL match, length:", extractedUrl.length)
                } else {
                    // Priority 3: HTTP URL
                    const httpMatch = content.match(/https?:\/\/[^\s)]+/)
                    if (httpMatch) {
                        extractedUrl = httpMatch[0]
                        console.log("[GenerateImage] Found HTTP URL match, length:", extractedUrl.length)
                    }
                }
            }

            if (!extractedUrl) {
                throw new Error(`Could not extract image URL from response. Content length: ${content.length}`)
            }

            console.log(`[GenerateImage] Extracted URL length: ${extractedUrl.length}, Total content length: ${content.length}`)

            // Process the extracted URL
            if (extractedUrl.startsWith("data:image")) {
                imageUrl = extractedUrl
                const base64Data = imageUrl.split(";base64,").pop()
                if (!base64Data) {
                    throw new Error("Invalid data URL format")
                }
                const cleanBase64 = base64Data.replace(/\s/g, "")
                buffer = Buffer.from(cleanBase64, "base64")
            }
            // Check if content is an HTTP URL
            else if (extractedUrl.startsWith("http")) {
                imageUrl = extractedUrl
                const responseImage = await fetch(imageUrl)
                if (!responseImage.ok) {
                    throw new Error(`Failed to download image: ${responseImage.statusText}`)
                }
                buffer = Buffer.from(await responseImage.arrayBuffer())
            }
            else {
                throw new Error(`Invalid image URL format: ${extractedUrl.slice(0, 50)}...`)
            }

            const fileName = `generated-${Date.now()}.png`
            const relativePath = path.join("assets", "generated", fileName)
            const absolutePath = path.join(ctx.worktree, relativePath)

            await fs.mkdir(path.dirname(absolutePath), { recursive: true })
            await fs.writeFile(absolutePath, buffer)

            const workspaceDirName = path.basename(ctx.worktree)
            const serverPath = path.join("/workspaces", workspaceDirName, relativePath)

            const metadataUrl = imageUrl.startsWith("data:") ? "data:image/..." : imageUrl
            const output = `![${params.prompt}](${serverPath})`

            // Set metadata using context capability
            ctx.metadata({
                title: `Generated: ${params.prompt}`,
                metadata: {
                    path: relativePath,
                    url: metadataUrl,
                    serverPath: serverPath
                }
            })

            return output

        } catch (error: any) {
            throw new Error(`Image generation failed: ${error.message}`)
        }
    },
}
