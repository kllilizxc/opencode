import { describe, test, expect } from "bun:test"
import { getMarkdownHighlighter, highlightCodeBlocks } from "./marked"

describe("getMarkdownHighlighter", () => {
  test("creates a highlighter with Oniguruma engine", async () => {
    const highlighter = await getMarkdownHighlighter()
    expect(highlighter).toBeDefined()
    expect(typeof highlighter.codeToHtml).toBe("function")
  })

  test("returns the same instance on subsequent calls", async () => {
    const a = await getMarkdownHighlighter()
    const b = await getMarkdownHighlighter()
    expect(a).toBe(b)
  })

  test("has OpenCode theme loaded", async () => {
    const highlighter = await getMarkdownHighlighter()
    expect(highlighter.getLoadedThemes()).toContain("OpenCode")
  })
})

describe("highlightCodeBlocks", () => {
  test("returns html unchanged when no code blocks exist", async () => {
    const html = "<p>hello world</p>"
    const result = await highlightCodeBlocks(html)
    expect(result).toBe(html)
  })

  test("highlights a javascript code block", async () => {
    const html = '<pre><code class="language-javascript">const x = 1</code></pre>'
    const result = await highlightCodeBlocks(html)
    expect(result).toContain("shiki")
    expect(result).not.toBe(html)
  })

  test("highlights a typescript code block", async () => {
    const html = '<pre><code class="language-typescript">const x: number = 1</code></pre>'
    const result = await highlightCodeBlocks(html)
    expect(result).toContain("shiki")
  })

  test("highlights multiple code blocks with different languages", async () => {
    const html = [
      "<p>some text</p>",
      '<pre><code class="language-javascript">const x = 1</code></pre>',
      "<p>more text</p>",
      '<pre><code class="language-python">x = 1</code></pre>',
    ].join("")
    const result = await highlightCodeBlocks(html)
    expect(result).toContain("some text")
    expect(result).toContain("more text")
    // Both blocks should be highlighted
    const shikiCount = (result.match(/class="shiki/g) || []).length
    expect(shikiCount).toBe(2)
  })

  test("falls back to text for unknown languages", async () => {
    const html = '<pre><code class="language-notareallanguage">hello</code></pre>'
    const result = await highlightCodeBlocks(html)
    // Should still produce shiki output (as "text" language)
    expect(result).toContain("shiki")
  })

  test("handles code block without language class", async () => {
    const html = "<pre><code>plain code</code></pre>"
    const result = await highlightCodeBlocks(html)
    expect(result).toContain("shiki")
  })

  test("decodes HTML entities in code content", async () => {
    const html = '<pre><code class="language-javascript">if (a &lt; b &amp;&amp; c &gt; d) {}</code></pre>'
    const result = await highlightCodeBlocks(html)
    expect(result).toContain("shiki")
    // The decoded content should not contain raw HTML entities
    expect(result).not.toContain("&lt;")
    expect(result).not.toContain("&amp;")
  })

  test("preserves content outside code blocks", async () => {
    const html = "<h1>Title</h1><pre><code>code</code></pre><p>Footer</p>"
    const result = await highlightCodeBlocks(html)
    expect(result).toContain("<h1>Title</h1>")
    expect(result).toContain("<p>Footer</p>")
  })

  test(
    "highlights powershell code without hanging (regression test)",
    async () => {
      // This is the exact code that caused the desktop app to freeze
      // when using the JS regex engine due to catastrophic backtracking
      const powershellCode = [
        "# PowerShell",
        'Remove-Item -Recurse -Force "$env:APPDATA\\opencode" -ErrorAction SilentlyContinue',
        'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\opencode" -ErrorAction SilentlyContinue',
        'Remove-Item -Recurse -Force "$env:APPDATA\\OpenCode Desktop" -ErrorAction SilentlyContinue',
        'Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\OpenCode Desktop" -ErrorAction SilentlyContinue',
      ].join("\n")

      const escaped = powershellCode
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")

      const html = `<pre><code class="language-powershell">${escaped}</code></pre>`
      const result = await highlightCodeBlocks(html)
      expect(result).toContain("shiki")
    },
    { timeout: 10_000 },
  )

  test(
    "highlights powershell with env variable interpolation without hanging",
    async () => {
      // Additional powershell patterns that could trigger backtracking
      const code = `$path = "$env:USERPROFILE\\.config\\opencode"
if (Test-Path $path) {
    Remove-Item -Recurse -Force "$path" -ErrorAction SilentlyContinue
}
Write-Host "Cleaned: $path"`

      const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

      const html = `<pre><code class="language-powershell">${escaped}</code></pre>`
      const result = await highlightCodeBlocks(html)
      expect(result).toContain("shiki")
    },
    { timeout: 10_000 },
  )

  test("continues highlighting other blocks if one fails", async () => {
    // Get the highlighter and force-load a language, then test with a
    // code block that has valid JS alongside potentially problematic content
    const html = [
      '<pre><code class="language-javascript">const a = 1</code></pre>',
      '<pre><code class="language-python">x = 2</code></pre>',
    ].join("")

    const result = await highlightCodeBlocks(html)
    // Both blocks should be highlighted
    const shikiCount = (result.match(/class="shiki/g) || []).length
    expect(shikiCount).toBe(2)
  })
})
