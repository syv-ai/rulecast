import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export interface FakeRequest {
  path: string
  headers: Record<string, string>
  // biome-ignore lint/suspicious/noExplicitAny: a test asserts on whatever the provider sent.
  body: any
}

export interface FakeApi {
  url: string
  /** Every request the server received, in order. */
  requests: FakeRequest[]
  close(): Promise<void>
}

/**
 * A local stand-in for an LLM HTTP API, so the anthropic and openai-compatible providers are
 * tested without a network or a key. `reply` sees the parsed body and returns [status, body].
 *
 * Bound to 127.0.0.1 on port 0: vitest runs files in parallel, and a fixed port would collide.
 */
export function fakeApi(reply: (body: unknown, path: string) => [number, unknown]): Promise<FakeApi> {
  const requests: FakeRequest[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
      const path = request.url ?? ""
      requests.push({ path, headers: request.headers as Record<string, string>, body })
      const [status, payload] = reply(body, path)
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(payload))
    })
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
