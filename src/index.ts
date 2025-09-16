import { CodeSandbox } from "@codesandbox/sdk";
import { Effect } from "effect";
import { Hono } from "hono";
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

// Test endpoint with tracing and elegant error handling
app.get("/test/:userId?", async (c) => {
  const userId = c.req.param("userId") || "123";

  return await Effect.runPromise(
    businessLogic(userId).pipe(
      Effect.provide(TracingLive),
      Effect.map((data) =>
        c.json({
          success: true,
          data,
        })
      ),
      Effect.catchTags({
        ValidationError: (error) =>
          Effect.succeed(
            c.json(
              {
                success: false,
                error: {
                  type: "ValidationError",
                  field: error.field,
                  message: error.message,
                },
              },
              400
            )
          ),
        UserNotFound: (error) =>
          Effect.succeed(
            c.json(
              {
                success: false,
                error: {
                  type: error._tag,
                  message: error.message,
                },
              },
              404
            )
          ),
        // DatabaseError: (error) =>
        //   Effect.succeed(
        //     c.json(
        //       {
        //         success: false,
        //         error: {
        //           type: error._tag,
        //           operation: error.operation,
        //           details: error.details,
        //         },
        //       },
        //       500
        //     )
        //   ),
        
      })
    )
  );
});

export default app;
