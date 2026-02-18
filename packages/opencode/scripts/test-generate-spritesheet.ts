
import generateSpritesheetTool from "../src/game-agent/tools/generate-spritesheet"
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
    const args = process.argv.slice(2);

    const prompt = args[0] || "A robot walking";
    const grid = args[1] || "2x2";
    const loop = args[2] === "true"; // Parse boolean "true"
    const characterDesignArg = args[3];

    // Treat "null", "undefined", or empty string as undefined
    const characterDesign = (!characterDesignArg || characterDesignArg === "null" || characterDesignArg === "undefined")
        ? undefined
        : characterDesignArg;

    const format = args[4] || "png";

    console.log(`\n--- Test Spritesheet Generation ---`)
    console.log(`Prompt: "${prompt}"`)
    console.log(`Grid: "${grid}"`)
    console.log(`Loop: ${loop}`)
    if (characterDesign) console.log(`Character Design: "${characterDesign}"`)

    try {
        const result = await generateSpritesheetTool.execute({
            prompt,
            grid,
            loop,
            characterDesign: characterDesign,
            format
        }, mockCtx)

        console.log("Success!")
        console.log(`Result: ${result}`)
    } catch (error) {
        console.error("Error generating spritesheet:", error)
    }
}

main()
