import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { requireCronAuth } from "@/lib/cron-auth"

function requestWithAuth(header?: string): Request {
  return new Request("https://example.com/api/plaid/seed", {
    headers: header ? { authorization: header } : {},
  })
}

describe("requireCronAuth", () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
    vi.restoreAllMocks()
  })

  it("allows a request carrying the correct bearer token", () => {
    process.env.CRON_SECRET = "s3cret"
    expect(requireCronAuth(requestWithAuth("Bearer s3cret"))).toBeNull()
  })

  it("rejects a request with no authorization header", async () => {
    process.env.CRON_SECRET = "s3cret"
    const res = requireCronAuth(requestWithAuth())
    expect(res?.status).toBe(401)
  })

  it("rejects a wrong token", () => {
    process.env.CRON_SECRET = "s3cret"
    expect(requireCronAuth(requestWithAuth("Bearer wrong"))?.status).toBe(401)
  })

  it("rejects a token that is a prefix of the real one", () => {
    process.env.CRON_SECRET = "s3cret"
    expect(requireCronAuth(requestWithAuth("Bearer s3cre"))?.status).toBe(401)
  })

  it("rejects the raw secret without the Bearer scheme", () => {
    process.env.CRON_SECRET = "s3cret"
    expect(requireCronAuth(requestWithAuth("s3cret"))?.status).toBe(401)
  })

  it("fails closed with a 500 when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET
    const res = requireCronAuth(requestWithAuth("Bearer anything"))
    expect(res?.status).toBe(500)
  })

  it("fails closed when CRON_SECRET is an empty string", () => {
    process.env.CRON_SECRET = ""
    expect(requireCronAuth(requestWithAuth("Bearer "))?.status).toBe(500)
  })
})
