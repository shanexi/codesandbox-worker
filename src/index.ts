import { Hono } from "hono";
import { CodeSandbox } from "@codesandbox/sdk";
import { Effect } from "effect";
import { TracingLive } from "./TracingLive.js";

const app = new Hono();

// Simple business logic with tracing
const fetchUserData = (userId: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Fetching user data for: ${userId}`);

    // Simulate API call
    yield* Effect.sleep("100 millis");

    return {
      id: userId,
      name: "John Doe",
      email: "john@example.com",
    };
  }).pipe(
    Effect.withSpan("user.fetch", {
      attributes: { userId },
    })
  );

const processUserData = (user: { id: string; name: string; email: string }) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Processing user: ${user.name}`);

    // Simulate data processing
    yield* Effect.sleep("50 millis");

    return {
      ...user,
      processed: true,
      timestamp: new Date().toISOString(),
    };
  }).pipe(
    Effect.withSpan("user.process", {
      attributes: {
        userId: user.id,
        userName: user.name,
      },
    })
  );

// Main business logic that combines multiple operations
const businessLogic = (userId: string) => Effect.gen(function* () {
  yield* Effect.logInfo("Starting business logic");

  // Fetch user data
  const user = yield* fetchUserData(userId);

  // Process the data
  const processed = yield* processUserData(user);

  // Add annotation to current span
  yield* Effect.annotateCurrentSpan({
    "result.processed": processed.processed,
    "result.timestamp": processed.timestamp,
  });

  yield* Effect.logInfo("Business logic completed");

  return processed;
}).pipe(Effect.withSpan("business.main"));

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
      businessLogic(userId).pipe(
        Effect.provide(TracingLive)
      )
    );
    
    return c.json({
      success: true,
      data: result
    });
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

export default app;
