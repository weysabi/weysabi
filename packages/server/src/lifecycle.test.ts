import { describe, expect, it } from "bun:test";
import type { Weysabi } from "@weysabi/sabi";
import { createServer } from "./index";

describe("createServer lifecycle", () => {
  it("binds the requested hostname and closes owned resources once", async () => {
    let closeCalls = 0;
    const sabi = {
      close() {
        closeCalls++;
      },
    } as unknown as Weysabi;
    const server = await createServer(sabi, {
      port: 0,
      hostname: "127.0.0.1",
    });

    try {
      expect(server.hostname).toBe("127.0.0.1");
      const response = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(response.status).toBe(200);
    } finally {
      server.stop();
      server.stop();
    }

    expect(closeCalls).toBe(1);
  });
});
