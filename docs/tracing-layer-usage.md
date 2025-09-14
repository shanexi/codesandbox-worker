# TracingLive Layer 的灵活使用

TracingLive 是一个独立的 Effect Layer，用于集成 OpenTelemetry 追踪功能。它不依赖于特定的框架或应用类型，可以与任何基于 Effect 的应用结合使用。

## TracingLive 的本质

TracingLive 是一个配置和启动 OpenTelemetry SDK 的 Layer：

```typescript
export const TracingLive = Layer.unwrapEffect(
  Effect.gen(function*() {
    const apiKey = yield* Config.option(Config.redacted("HONEYCOMB_API_KEY"))
    const dataset = yield* Config.withDefault(
      Config.string("HONEYCOMB_DATASET"),
      "effect-http-play"
    )
    
    return NodeSdk.layer(() => ({
      resource: { serviceName: dataset },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: "https://api.honeycomb.io/v1/traces",
          headers
        })
      )
    }))
  })
)
```

## 使用场景示例

### 1. 与 Hono Web 框架结合

```typescript
import { Hono } from 'hono'
import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"

const app = new Hono()

// 定义一个需要追踪的业务逻辑
const businessLogic = Effect.gen(function* () {
  yield* Effect.logInfo("Processing request")
  // 业务逻辑...
}).pipe(
  Effect.withSpan("business.process")
)

app.get('/users/:id', async (c) => {
  const result = await Effect.runPromise(
    businessLogic.pipe(
      Effect.provide(TracingLive)
    )
  )
  return c.json(result)
})

// 或者在应用级别提供 TracingLive
const HonoLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting Hono server")
    yield* Effect.promise(() => 
      Bun.serve({
        port: 3000,
        fetch: app.fetch
      })
    )
  })
)

// 启动应用
HonoLive.pipe(
  Layer.provide(TracingLive),
  Layer.launch,
  NodeRuntime.runMain
)
```

### 2. CLI 应用集成

```typescript
import { Args, Command, CliApp } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"

// 定义命令
const processCommand = Command.make("process", {
  file: Args.text({ name: "file" })
}, ({ file }) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Processing file: ${file}`)
    
    // 带追踪的文件处理
    yield* Effect.withSpan("file.read", { attributes: { file } })(
      Effect.promise(() => Bun.file(file).text())
    )
    
    yield* Effect.withSpan("file.process")(
      Effect.gen(function* () {
        // 处理逻辑
        yield* Effect.sleep("100 millis")
        return "processed"
      })
    )
  })
)

// CLI 应用
const cli = CliApp.make({
  name: "my-cli",
  version: "1.0.0",
  command: processCommand
})

// 运行 CLI 并提供 TracingLive
cli.pipe(
  Effect.provide(NodeContext.layer),
  Effect.provide(TracingLive),
  NodeRuntime.runMain
)
```

### 3. 后台定时任务

```typescript
import { Schedule, Effect, Layer } from "effect"

// 定期执行的任务
const backgroundTask = Effect.gen(function* () {
  yield* Effect.logInfo("Running background task")
  
  // 模拟数据库查询
  const users = yield* Effect.withSpan("db.query", {
    attributes: { table: "users", operation: "select" }
  })(
    Effect.promise(() => fetchUsersFromDB())
  )
  
  // 处理每个用户
  yield* Effect.forEach(users, (user) =>
    Effect.withSpan("process.user", {
      attributes: { userId: user.id }
    })(processUser(user))
  )
}).pipe(
  Effect.repeat(Schedule.spaced("5 minutes")),
  Effect.withSpan("background.task")
)

// 运行任务
backgroundTask.pipe(
  Effect.provide(TracingLive),
  NodeRuntime.runMain
)
```

### 4. 消息队列处理器

```typescript
import { Queue, Effect } from "effect"

const messageProcessor = Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Message>()
  
  // 消费者
  yield* Effect.forever(
    queue.take.pipe(
      Effect.flatMap((message) =>
        Effect.withSpan("message.process", {
          attributes: { 
            messageId: message.id,
            type: message.type 
          }
        })(
          processMessage(message)
        )
      )
    )
  ).pipe(Effect.forkScoped)
  
  // 生产者逻辑...
})

// 运行
messageProcessor.pipe(
  Effect.scoped,
  Effect.provide(TracingLive),
  NodeRuntime.runMain
)
```

### 5. GraphQL 服务器集成

```typescript
import { createYoga } from 'graphql-yoga'
import { Effect } from "effect"

const yoga = createYoga({
  schema,
  plugins: [
    {
      onExecute({ args }) {
        // 为每个 GraphQL 操作创建追踪
        const operationName = args.operationName || 'anonymous'
        return {
          onExecuteDone() {
            Effect.withSpan(`graphql.${operationName}`, {
              attributes: {
                operation: args.document.definitions[0].operation,
                query: args.source
              }
            })(
              Effect.unit
            ).pipe(
              Effect.provide(TracingLive),
              Effect.runPromise
            )
          }
        }
      }
    }
  ]
})
```

## 集成方式对比

### 1. 应用级别集成

```typescript
// 整个应用共享一个 TracingLive 实例
AppLive.pipe(
  Layer.provide(TracingLive),
  Layer.launch,
  NodeRuntime.runMain
)
```

**优点**：
- 配置一次，全局生效
- 资源利用效率高
- 适合长期运行的服务

### 2. 请求级别集成

```typescript
// 每个请求单独提供 TracingLive
const handler = (request) =>
  processRequest(request).pipe(
    Effect.provide(TracingLive)
  )
```

**优点**：
- 隔离性好
- 可以为不同请求配置不同的追踪策略
- 适合短期任务或 serverless 环境

### 3. 部分功能集成

```typescript
// 只为特定功能提供追踪
const criticalOperation = Effect.gen(function* () {
  // 关键操作
}).pipe(
  Effect.provide(TracingLive)
)
```

**优点**：
- 精确控制
- 减少性能开销
- 适合只需要追踪特定操作的场景

## 核心追踪 API

### 创建 Span

```typescript
// 基础用法
Effect.withSpan("operation.name")

// 带属性
Effect.withSpan("user.update", {
  attributes: {
    userId: "123",
    action: "update_profile"
  }
})

// 嵌套 Span
Effect.withSpan("parent")(
  Effect.gen(function* () {
    yield* Effect.withSpan("child1")(operation1)
    yield* Effect.withSpan("child2")(operation2)
  })
)
```

### 添加 Span 注解

```typescript
Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan("user.id", userId)
  yield* Effect.annotateCurrentSpan("request.size", payload.length)
  
  // 批量添加
  yield* Effect.annotateCurrentSpan({
    "http.method": "POST",
    "http.url": "/api/users",
    "http.status": 200
  })
})
```

### 错误追踪

```typescript
Effect.catchAll((error) =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({
      "error": true,
      "error.type": error._tag,
      "error.message": error.message
    })
    yield* Effect.fail(error)
  })
)
```

## 配置选项

TracingLive 支持多种配置方式：

### 1. Honeycomb 集成

```typescript
// 需要环境变量
HONEYCOMB_API_KEY=your-api-key
HONEYCOMB_DATASET=your-dataset
```

### 2. 自定义 OTLP 端点

```typescript
// 使用自定义的 OpenTelemetry Collector
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### 3. 本地开发（Jaeger）

```typescript
const TracingLocal = NodeSdk.layer(() => ({
  resource: { serviceName: "my-app" },
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({
      url: "http://localhost:4318/v1/traces"
    })
  )
}))
```

## 最佳实践

1. **合理命名 Span**
   - 使用点号分隔的命名空间：`service.operation.detail`
   - 避免在名称中包含动态值

2. **选择性追踪**
   - 不要追踪所有操作，聚焦于关键路径
   - 对于高频操作考虑采样

3. **属性标准化**
   - 遵循 OpenTelemetry 语义约定
   - 为自定义属性建立命名规范

4. **错误处理**
   - 始终标记失败的 Span
   - 记录足够的上下文信息

5. **性能考虑**
   - 避免在属性中存储大量数据
   - 使用批处理导出器减少网络开销

## 总结

TracingLive 的设计体现了 Effect 的核心理念：
- **可组合性**：可以与任何 Effect 应用组合
- **类型安全**：编译时验证配置
- **灵活性**：支持多种集成方式
- **关注点分离**：追踪逻辑与业务逻辑分离

无论是构建 Web 服务、CLI 工具、后台任务还是其他类型的应用，TracingLive 都能提供一致、可靠的分布式追踪能力。
