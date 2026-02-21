import z from "zod"
import path from "path"
import fs from "fs/promises"
import { shortId, genGridGuide, generateImage, removeGreenBackground, Jimp } from "@game-agent/common"

export default {
    description: `Generates a spritesheet for animations or asset collections.

This tool produces a single PNG image containing a grid of sprites (frames, icons, or variations) based on your prompt and optional reference images.

### Parameters
- **filename** (Required): The base name for the generated file. Saved in \`assets/generated/\`.
- **prompt** (Required): Description of the spritesheet content. No need to specify background, it's always transparent.
- **grid**: Layout format, e.g., "4x4", "2x2".
- **referenceSpritesheet**: VERY IMPORTANT. Use this if you have a previously generated spritesheet for the same character to ensure identical scale and style across animations.
- **characterDesign**: Use this for a static character reference.
- **loop**: Set to true for looping animations.

### Examples
- Generate animation frames: \`{"filename": "hero_walk", "prompt": "robot walking cycle", "grid": "4x4"}\`
- Generate animation frames based on references: \`{"filename": "hero_attack", "prompt": "robot attack animation", "grid": "4x4", "characterDesign": "assets/hero.png", "referenceSpritesheet": "assets/generated/hero_walk.png"}\`
- Generate a set of different icons: \`{"filename": "icons", "prompt": "4 pixel-art style icons: cat, dog, bird and elephant", "grid": "2x2"}\`
    `,
    args: {
        filename: z.string().describe("Base filename (e.g., 'hero_run'). File will be saved in assets/generated/."),
        prompt: z.string().describe("Detailed description of the spritesheet content (e.g., 'A rogue character swinging a dagger')."),
        grid: z.string().describe('Grid layout (cols x rows), e.g., "1x1", "2x2", "4x4". Defaults to "2x2".'),
        loop: z.boolean().optional().describe("If true, the first and last frames will be identical for a smooth animation loop."),
        characterDesign: z.string().optional().describe("Path to an existing character design image to use as a style base."),
        referenceSpritesheet: z.string().optional().describe("Path to a previously generated spritesheet to match scale and style exactly."),
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
                characterDesign: params.characterDesign,
                referenceSpritesheet: params.referenceSpritesheet,
                filename: params.filename
            },
        })

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

        if (rows !== cols) {
            const maxSize = Math.max(rows, cols)
            throw new Error(`Rows should be exact the same as cols, try ${maxSize}x${maxSize} instead.`)
        }

        try {
            let images: Buffer[] = []
            let gridCleanup: ((buffer: Buffer) => Promise<Buffer>) | undefined

            // Helper to load image from workspace
            const loadRef = async (refPath: string) => {
                const fullPath = path.isAbsolute(refPath)
                    ? refPath
                    : path.join(ctx.worktree, refPath)
                return await fs.readFile(fullPath)
            }

            if (params.characterDesign) {
                console.log(`[GenerateSpritesheet] Using character design from: ${params.characterDesign} `)
                images.push(await loadRef(params.characterDesign))
            }

            if (params.referenceSpritesheet) {
                console.log(`[GenerateSpritesheet] Using reference spritesheet from: ${params.referenceSpritesheet} `)
                images.push(await loadRef(params.referenceSpritesheet))
            }

            // If no reference images provided, we need a grid guide
            if (images.length === 0) {
                const { guide, cleanup } = await genGridGuide(rows, cols, 1024)
                gridCleanup = cleanup

                const base64Data = guide.split(";base64,").pop()
                if (!base64Data) throw new Error("Failed to generate guide PNG")
                images.push(Buffer.from(base64Data, "base64"))
            }

            console.log(`[GenerateSpritesheet] Grid: ${cols}x${rows}, Loop: ${!!params.loop}, Reference images: ${images.length}`)

            // Construct prompt
            let modifiedPrompt = `Generate a ${cols}x${rows} spritesheet. Content: ${params.prompt}. `

            if (params.characterDesign && params.referenceSpritesheet) {
                modifiedPrompt += "Adhere strictly to the provided character design and reference spritesheet. The character's scale, proportions, and artistic style (including color palette and shading) must be identical across both existing and new animations. "
            } else if (params.characterDesign) {
                modifiedPrompt += "Use the provided character design as the definitive reference for visual style and proportions. "
            } else if (params.referenceSpritesheet) {
                modifiedPrompt += "Use the provided spritesheet to calibrate the character's size and artistic style. Ensure the new animation is perfectly consistent in scale and design. "
            } else {
                modifiedPrompt += `Each sprite must fit strictly within a ${1024 / cols}x${1024 / rows} resolution according to the provided grid guide. `
            }

            if (params.loop) {
                modifiedPrompt += "Ensure a seamless loop where the final frame flows naturally back into the first. "
            }

            // Always add green background for easier transparency removal
            modifiedPrompt += "Ignore previous background style if existed, apply a solid green background (#00FF00) to the entire resulting sheet."

            // Use common utility
            const content = await generateImage({
                type: "edit",
                images: images,
                prompt: modifiedPrompt,
                aspectRatio: "1:1",
                imageSize: "1K"
            })

            let buffer = Buffer.from(content, "base64") as any

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

            const fileId = params.filename || `spritesheet-${shortId()}`
            const fileName = `${fileId}-${w}x${h}-${cols}x${rows}.png`
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
