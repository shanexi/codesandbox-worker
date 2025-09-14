import { Hono } from "hono";
import { CodeSandbox } from "@codesandbox/sdk";
import { Effect } from "effect";
import { TracingLive } from "./TracingLive.js";
import { businessLogic } from "./tracing-example.js";

const app = new Hono();

app.get("/", async (c) => {
  const sdk = new CodeSandbox(process.env.CSB_API_KEY);
  const sandbox = await sdk.sandboxes.create();
  const client = await sandbox.connect();

  const output = await client.commands.run("echo 'Hello World'");

  console.log(output); // Hello World
  return c.text(output);
});

// Test endpoint with tracing
app.get("/test/:userId?", async (c) => {
  const userId = c.req.param("userId") || "123";

  try {
    const result = await Effect.runPromise(
      businessLogic(userId).pipe(Effect.provide(TracingLive))
    );

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default app;
