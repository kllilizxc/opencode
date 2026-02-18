import z from "zod"
import path from "path"
import fs from "fs/promises"
import { shortId, genGridGuide, generateImage, removeGreenBackground, Jimp } from "@game-agent/common"

export default {
    description: `generate_spritesheet(prompt: string, grid: string, characterDesign ?: string, loop ?: boolean)

Generates a spritesheet with a specific grid layout(e.g. 2x2, 4x4).
The system will generate a single 1024x1024(or similar size based on content) image containing the grid of sprites in PNG format.
This is useful for game assets where you need multiple related sprites(frames of animation, variations, etc.) in one file.

## Examples

generate_spritesheet(prompt: "A walking cycle of a robot", grid: "4x4")
generate_spritesheet(prompt: "Different fruit icons", grid: "3x3")
generate_spritesheet(prompt: "Attack animation based on character design", grid: "3x3", characterDesign: "assets/hero.png")
    `,
    args: {
        prompt: z.string().describe("The text description of the spritesheet content."),
        grid: z.string().describe('The grid layout, e.g. "1x1", "2x2", "3x4" (cols x rows). Default "2x2".'),
        loop: z.boolean().optional().describe("Whether the spritesheet should form a looping animation."),
        characterDesign: z.string().optional().describe("Path to an existing character design image to use as a base/reference.")
    },
    async execute(params: any, ctx: any) {
        await ctx.ask({
            permission: "generate_spritesheet",
            patterns: ["*"],
            always: [],
            metadata: {
                prompt: params.prompt,
                grid: params.grid,
                loop: params.loop,
                characterDesign: params.characterDesign
            },
        })

        // Dynamic import
        // const { OpenAI } = await import("openai") // No longer needed directly

        // const client = new OpenAI({ ... }) // Handled in common util

        // Always PNG
        const format = "png"

        // Parse grid
        let cols = 2
        let rows = 2
        if (params.grid) {
            const parts = params.grid.split('x')
            if (parts.length === 2) {
                cols = parseInt(parts[0])
                rows = parseInt(parts[1])
            }
        }

        try {
            let imageBuffer: Buffer
            let gridCleanup: ((buffer: Buffer) => Promise<Buffer>) | undefined

            if (params.characterDesign) {
                // Use provided character design
                const designPath = path.isAbsolute(params.characterDesign)
                    ? params.characterDesign
                    : path.join(ctx.worktree, params.characterDesign)

                console.log(`[GenerateSpritesheet] Using character design from: ${designPath} `)
                try {
                    imageBuffer = await fs.readFile(designPath)
                } catch (e) {
                    throw new Error(`Failed to read character design file: ${params.characterDesign} `)
                }
            } else {
                // Generate Grid Guide
                const { guide, cleanup } = await genGridGuide(rows, cols, 1024)
                gridCleanup = cleanup // Store for later use

                const base64Data = guide.split(";base64,").pop()
                if (!base64Data) throw new Error("Failed to generate guide PNG")
                imageBuffer = Buffer.from(base64Data, "base64")
            }

            console.log(`[GenerateSpritesheet] Grid: ${cols}x${rows}, Loop: ${!!params.loop} `)

            // Construct prompt
            let modifiedPrompt = ""

            if (params.characterDesign) {
                // Character design image as input
                modifiedPrompt = `Use the provided character design image as a reference. Generate a ${cols}x${rows} spritesheet based on this character, maintaining the exact style and proportions. Content: ${params.prompt}`
            } else {
                // Grid guide image as input
                modifiedPrompt = `The provided image is a grid layout guide with green boxes. Generate a ${cols}x${rows} spritesheet where each sprite fits strictly within the green boxes of the guide. Content: ${params.prompt}`
            }

            if (params.loop) {
                modifiedPrompt += ". Make sure the animation loops smoothly, which means the first frame and last frame are exactly the same."
            }

            // Always add green background for easier transparency removal
            modifiedPrompt += ", solid green background (#00FF00) for easy transparency removal"

            // Use common utility
            const content = await generateImage({
                type: "google",
                images: [imageBuffer],
                imageName: "guide.png",
                prompt: modifiedPrompt,
                aspectRatio: "1:1",
                imageSize: "1K"
            })

            let buffer = Buffer.from(content, "base64")

            // Grid cleanup (remove black lines)
            if (gridCleanup) {
                try {
                    buffer = await gridCleanup(buffer)
                    console.log("[GenerateSpritesheet] Grid lines removed")
                } catch (error: any) {
                    console.warn("[GenerateSpritesheet] Grid cleanup failed:", error)
                }
            }

            // Green screen removal (Always applied since it's PNG)
            try {
                buffer = await removeGreenBackground(buffer as any, 205)
            } catch (error: any) {
                console.warn("[GenerateSpritesheet] Green screen removal failed:", error)
            }

            // Get dimensions and ensure format matches extension (Always PNG)
            const img = await Jimp.read(buffer)
            const w = img.bitmap.width
            const h = img.bitmap.height

            // Only PNG output
            buffer = await img.getBuffer("image/png")

            const fileName = `spritesheet-${shortId()}-${w}x${h}-${cols}x${rows}.png`
            const relativePath = path.join("assets", "generated", fileName)
            const absolutePath = path.join(ctx.worktree, relativePath)

            await fs.mkdir(path.dirname(absolutePath), { recursive: true })
            await fs.writeFile(absolutePath, buffer)

            const workspaceDirName = path.basename(ctx.worktree)
            const serverPath = path.join("/workspaces", workspaceDirName, relativePath)
            const metadataUrl = `data: image / png; base64,...(size: ${content.length})`

            const output = `![${params.prompt}](${serverPath})`

            ctx.metadata({
                title: `Generated Spritesheet: ${params.prompt} `,
                metadata: {
                    path: relativePath,
                    url: metadataUrl,
                    serverPath: serverPath
                }
            })

            return output

        } catch (error: any) {
            throw new Error(`Spritesheet generation failed: ${error.message} `)
        }
    }
}
