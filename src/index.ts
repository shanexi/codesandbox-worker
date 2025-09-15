import { Hono } from "hono";
import { CodeSandbox } from "@codesandbox/sdk";
import { Effect } from "effect";
import { TracingLive } from "./TracingLive.js";
import {
  businessLogic,
  UserNotFound,
  ValidationError,
  DatabaseError,
} from "./tracing-example.js";

const app = new Hono();

app.get("/", async (c) => {
  const sdk = new CodeSandbox(process.env.CSB_API_KEY);
  const sandbox = await sdk.sandboxes.create();
  const client = await sandbox.connect();

  const output = await client.commands.run("echo 'Hello World'");

  console.log(output); // Hello World
  return c.text(output);
});

// Test endpoint with tracing and proper error handling
app.get("/test/:userId?", async (c) => {
  const userId = c.req.param("userId") || "123";

  const result = await Effect.runPromise(
    businessLogic(userId).pipe(
      Effect.provide(TracingLive),
      Effect.either // Convert to Either to handle both success and error
    )
  );

  if (result._tag === "Right") {
    return c.json({
      success: true,
      data: result.right,
    });
  }

  // Handle specific error types
  const error = result.left;

  if (error instanceof ValidationError) {
    return c.json(
      {
        success: false,
        error: {
          type: "ValidationError",
          field: error.field,
          message: error.message,
        },
      },
      400
    );
  }

  if (error instanceof UserNotFound) {
    return c.json(
      {
        success: false,
        error: {
          type: "UserNotFound",
          message: error.message,
        },
      },
      404
    );
  }

  if (error instanceof DatabaseError) {
    return c.json(
      {
        success: false,
        error: {
          type: "DatabaseError",
          operation: error.operation,
          details: error.details,
        },
      },
      500
    );
  }

  // Unknown error
  return c.json(
    {
      success: false,
      error: {
        type: "UnknownError",
        message: error instanceof Error ? error.message : "Unknown error",
      },
    },
    500
  );
});

export default app;
