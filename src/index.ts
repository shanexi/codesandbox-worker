import { Hono } from "hono";
import { CodeSandbox } from "@codesandbox/sdk";

const app = new Hono();

app.get("/", async (c) => {
  const sdk = new CodeSandbox(process.env.CSB_API_KEY);
  const sandbox = await sdk.sandboxes.create();
  const client = await sandbox.connect();

  const output = await client.commands.run("echo 'Hello World'");

  console.log(output); // Hello World
  return c.text(output);
});

export default app;
