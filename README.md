## 研究目标

研究如何使用 codesandbox sdk

## 模板

使用了 [hono + vercel](https://hono.dev/docs/getting-started/vercel)

发现 `vercel dev` 是运行的 vercel function

接入了 honeycomb
发现走 vercel function 能 battery-included 在 honeycomb 看到 trace
> 尝试用 `@hono/node-server` 不能在 honeycomb 看到 trace

## 其他研究目标

学习 effect observibility `docs/tracing-layer-usage.md`.

因为是渐进式 adopt effect hono。所有是在业务逻辑级别。

> adopt effect 另一个目的是 typed error。





