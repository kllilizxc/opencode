import z from "zod"
import path, { format } from "path"
import fs from "fs/promises"
import { shortId, Jimp, genGuideImage, cropImage, generateImage, removeGreenBackground } from "@game-agent/common"

const MIN_SIZE = 256

// Plugin-style tool definition
export default {
    description: `generate_image(filename: string, prompt: string, size?: string, format?: string, references?: string[])

Generates an image based on a text prompt and optional reference images.

### Parameters
- **filename** (Required): The basename for the generated file. Saved in \`assets/generated/\`.
- **prompt** (Required): A detailed text description of the image you want to generate. NO NEED to mention background for pngs!
- **size**: Optional. The dimensions of the generated image in "WxH" format (e.g., "1024x256", "512x512", minimal size: "${MIN_SIZE}x${MIN_SIZE}", width or height can not be smaller than ${MIN_SIZE}). Defaults to "1024x1024".
- **format**: Optional. The format of image file (support: "jpg", "png"), default: "jpg".
- **references**: Optional. List of paths to reference images to influence style or content. If you want to generate a set of images of similar styles, you should provide an existing one as reference, and explicitly prompt to mimic the style.

## Examples

generate_image(filename: "cyber_city", prompt: "A futuristic city with flying cars at sunset", size: "1024x256", format: "jpg")
generate_image(filename: "pixel_cat", prompt: "A cute pixel art cat", size: "256x256", format: "png", references: ["assets/cat_ref.png"])
generate_image(filename: "icon_cat", prompt: "A pixel art style icon of cat, use the same style as reference image", size: "256x256", format: "png", references: ["assets/icon_dog.png"])
`,
    args: {
        filename: z.string().describe("Base filename (e.g., 'hero_portrait'). File will be saved in assets/generated/."),
        prompt: z.string().describe("The text prompt to generate an image for. NO NEED to mention transparent background(or anything similar) for pngs!"),
        size: z
            .string()
            .optional()
            .describe('The dimensions of the image (default: "1024x1024"). Format: "WxH", e.g., "1024x256", "256x256".'),
        format: z.enum(["jpg", "png"])
            .optional()
            .describe('The format of image file, default: "jpg"'),
        references: z.array(z.string()).optional().describe("List of paths to reference images to influence style or content."),
    },
    async execute(params: any, ctx: any) {
        await ctx.ask({
            permission: "generate_image",
            patterns: ["*"],
            always: [],
            metadata: {
                prompt: params.prompt,
                size: params.size,
                format: params.format,
                filename: params.filename,
                references: params.references
            },
        })

        // Base generation size is always 1024x1024 for simplicity
        const baseSize = 1024
        let cropW = baseSize
        let cropH = baseSize

        // Parse size string "WxH"
        if (params.size) {
            const parts = params.size.split('x')
            if (parts.length === 2) {
                const w = parseInt(parts[0])
                const h = parseInt(parts[1])
                if (w < MIN_SIZE || h < MIN_SIZE) {
                    throw new Error(`The given image size is illegal, the minimal side size should be ${MIN_SIZE}`)
                }
                if (!isNaN(w) && !isNaN(h)) {
                    cropW = w
                    cropH = h
                }
            }
        }


        try {
            // Helper to load image from workspace
            const loadRef = async (refPath: string) => {
                const fullPath = path.isAbsolute(refPath)
                    ? refPath
                    : path.join(ctx.worktree, refPath)
                return await fs.readFile(fullPath)
            }

            const inputImages: Buffer[] = []

            // Load reference images if provided
            if (params.references && params.references.length > 0) {
                console.log(`[GenerateImage] Loading ${params.references.length} reference images`)
                for (const ref of params.references) {
                    try {
                        inputImages.push(await loadRef(ref))
                    } catch (e: any) {
                        console.warn(`[GenerateImage] Failed to load reference: ${ref}`, e.message)
                    }
                }
            }

            // Append green background instruction to prompt for easier removal
            let modifiedPrompt = params.prompt

            if (params.references && params.references.length > 0) {
                modifiedPrompt += ". Use the provided reference images as a strong reference for style and content. "
            }

            if (params.format === 'png') {
                modifiedPrompt += ", ignore previous background if existed, use solid green background (#00FF00)"
            }

            modifiedPrompt = `Draw the image on the green area of the last image, make sure the drawing size is exactly same as the green area, no more no less: ${modifiedPrompt}.`

            // genGuideImage returns a data URI "data:image/png;base64,..."
            // We generate a full 1024x1024 guide with the target cropW/cropH centered
            const guidePngDataUrl = await genGuideImage(cropW, cropH, 1024)
            const base64Data = guidePngDataUrl.split(";base64,").pop()
            if (!base64Data) throw new Error("Failed to generate guide PNG base64")
            const imageBuffer = Buffer.from(base64Data, "base64")

            // debug: save guide image
            // const _fileName = 'guide-' + shortId()
            // const _relativePath = path.join("assets", "generated", _fileName)
            // const _absolutePath = path.join(ctx.worktree, _relativePath)

            // await fs.mkdir(path.dirname(_absolutePath), { recursive: true })
            // await fs.writeFile(_absolutePath, imageBuffer)

            // Add guide image to input images
            inputImages.push(imageBuffer)

            console.log(`[GenerateImage] Target Size: ${cropW}x${cropH} centered in 1024x1024.`)

            // Use common utility
            // Use common utility

            const content = await generateImage({
                type: "google",
                images: inputImages,
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
                    finalBuffer = await removeGreenBackground(buffer as any, 205)
                    console.log("[GenerateImage] Green screen removal processed")
                } catch (error: any) {
                    console.warn("[GenerateImage] Failed to process green screen removal:", error.message)
                }
            }


            // Get dimensions and ensure format matches extension (Always PNG)
            const img = await Jimp.read(finalBuffer)
            const w = img.bitmap.width
            const h = img.bitmap.height

            const fileId = params.filename || `image-${shortId()}`
            const fileName = `${fileId}-${w}x${h}.${params.format || 'png'}`
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
