import z from "zod"
import path, { format } from "path"
import fs from "fs/promises"
import { shortId } from "@game-agent/common"

// Plugin-style tool definition
export default {
    description: `generate_image(prompt: string, aspectRatio?: string)

- prompt: A detailed text description of the image you want to generate. NO NEED to mention transparent background(or anything similar) for pngs!
- aspectRatio: Optional. The desired aspect ratio of the generated image (e.g., "16:9", "1:1", "4:3", "9:16"). Defaults to "1:1". The system will generate a standard 1024x1024 image and crop it to the center to match this ratio.
- format: Optional. The format of image file (support: "jpg", "png"), default: "jpg".

## Examples

generate_image(prompt: "A futuristic city with flying cars at sunset", aspectRatio: "16:9", "jpg")
generate_image(prompt: "A cute pixel art cat", aspectRatio: "1:1", "png")
generate_image(prompt: "A tall portrait of a knight", aspectRatio: "9:16", "png")
`,
    args: {
        prompt: z.string().describe("The text prompt to generate an image for. NO NEED to mention transparent background(or anything similar) for pngs!"),
        aspectRatio: z
            .string()
            .optional()
            .describe('The aspect ratio of the image (default: "1:1"). Examples: "16:9", "4:3", "1:1"'),
        format: z.enum(["jpg", "png"])
            .optional()
            .describe('The format of image file, default: "jpg"')
    },
    async execute(params: any, ctx: any) {
        await ctx.ask({
            permission: "generate_image",
            patterns: ["*"],
            always: [],
            metadata: {
                prompt: params.prompt,
                aspectRatio: params.aspectRatio,
                format: params.format
            },
        })

        // Dynamic import to avoid build issues if package is missing in this workspace
        // const { OpenAI } = await import("openai") // No longer needed directly

        // const client = new OpenAI({ ... }) // Handled in common util



        // Helper to parse aspect ratio
        let targetRatio = 1
        if (params.aspectRatio) {
            const parts = params.aspectRatio.split(':')
            if (parts.length === 2) {
                targetRatio = parseFloat(parts[0]) / parseFloat(parts[1])
            } else {
                const parsed = parseFloat(params.aspectRatio)
                if (!isNaN(parsed)) targetRatio = parsed
            }
        }

        // Base generation size is always 1024x1024 for simplicity
        const baseSize = 1024
        let cropW = baseSize
        let cropH = baseSize

        // Calculate crop dimensions to fit within baseSize while maintaining targetRatio
        // Strategy: Maximize one dimension to 1024, adjust the other.
        // Since base is square 1024x1024:
        // If wider than 1:1, width = 1024, height = 1024 / ratio
        // If taller than 1:1, height = 1024, width = 1024 * ratio

        if (targetRatio > 1) {
            // Wide
            cropH = Math.round(baseSize / targetRatio)
        } else {
            // Tall (or square)
            cropW = Math.round(baseSize * targetRatio)
        }

        try {
            // Append green background instruction to prompt for easier removal
            let modifiedPrompt = params.prompt

            if (params.format === 'png') {
                modifiedPrompt += ", solid green background (#00FF00)"
            }

            modifiedPrompt = `Draw the image on the green area, keep the same aspect ratio as the green area: ${modifiedPrompt}`

            // Generate guide PNG buffer (1024x1024 with green target area)
            const { genGuideImage, cropImage } = await import("@game-agent/common")

            // genGuideImage returns a data URI "data:image/png;base64,..."
            // We generate a full 1024x1024 guide with the target cropW/cropH centered
            const guidePngDataUrl = await genGuideImage(cropW, cropH, 1024)
            const base64Data = guidePngDataUrl.split(";base64,").pop()
            if (!base64Data) throw new Error("Failed to generate guide PNG base64")
            const imageBuffer = Buffer.from(base64Data, "base64")

            console.log(`[GenerateImage] Target Ratio: ${targetRatio}, ROI: ${cropW}x${cropH} centered in 1024x1024.`)

            // Use common utility
            const { generateImage } = await import("@game-agent/common")

            const content = await generateImage({
                type: "google",
                images: [imageBuffer],
                imageName: "guide.png",
                prompt: modifiedPrompt
            })

            console.log("[GenerateImage] Content length:", content.length)

            // The content is directly the base64 string
            let buffer = Buffer.from(content, "base64")

            // --- Post-Processing: Crop back to ROI ---
            try {
                // Crop from 1024x1024 center back to cropW x cropH
                buffer = await cropImage(buffer as any, cropW, cropH)
                console.log(`[GenerateImage] Cropped result to ${cropW}x${cropH}`)
            } catch (error: any) {
                console.warn("[GenerateImage] Cropping failed:", error)
            }

            // --- Post-Processing: Green Screen Removal ---
            let finalBuffer = buffer
            if (params.format === 'png') {
                try {
                    const { removeGreenBackground } = await import("@game-agent/common")
                    finalBuffer = await removeGreenBackground(buffer as any, 205)
                    console.log("[GenerateImage] Green screen removal processed")
                } catch (error: any) {
                    console.warn("[GenerateImage] Failed to process green screen removal:", error.message)
                }
            }

            const fileName = `generated-${shortId()}-${cropW}x${cropH}.${params.format}`
            const relativePath = path.join("assets", "generated", fileName)
            const absolutePath = path.join(ctx.worktree, relativePath)

            await fs.mkdir(path.dirname(absolutePath), { recursive: true })
            await fs.writeFile(absolutePath, finalBuffer)

            const workspaceDirName = path.basename(ctx.worktree)
            const serverPath = path.join("/workspaces", workspaceDirName, relativePath)

            // For the metadata URL, use a truncated data URI representation
            const metadataUrl = `data:image/png;base64,...(size: ${content.length})`
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
