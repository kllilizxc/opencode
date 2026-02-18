
import generateImageTool from "../src/game-agent/tools/generate-image"
import path from "path"

// Mock context
const mockCtx = {
    worktree: path.resolve(__dirname, "../../"),
    ask: async (params: any) => {
        console.log("Ask permission:", JSON.stringify(params, null, 2))
        return { answer: "yes" }
    },
    metadata: (meta: any) => {
        console.log("Metadata:", JSON.stringify(meta, null, 2))
    }
}

async function main() {
    const prompt = process.argv[2] || "A futuristic city with flying cars at sunset"
    const aspectRatio = process.argv[3] || "16:9"
    const format = process.argv[4] || "png"

    console.log(`Generating image with prompt: "${prompt}", aspectRatio: ${aspectRatio}, format: ${format}`)

    try {
        const result = await generateImageTool.execute({
            prompt,
            aspectRatio,
            format
        }, mockCtx)

        console.log("\nSuccess!")
        console.log(`Result: ${result}`)
    } catch (error) {
        console.error("\nError generating image:", error)
        process.exit(1)
    }
}

main()
