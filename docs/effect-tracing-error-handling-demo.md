# Effect 追踪与错误处理实战示例

本文档展示了如何在实际项目中结合使用 Effect 的追踪（Tracing）和错误处理功能。

## 1. 项目结构

```
src/
├── TracingLive.ts      # OpenTelemetry 追踪配置
├── tracing-example.ts  # 业务逻辑与错误处理示例
├── index.ts           # HTTP 服务器端点
└── test-errors.ts     # 测试脚本
```

## 2. 追踪层配置（TracingLive）

TracingLive 是一个灵活的 OpenTelemetry 配置层，支持多种追踪后端：

```typescript
// src/TracingLive.ts
export const TracingLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const apiKey = yield* Config.option(Config.redacted("HONEYCOMB_API_KEY"));
    const dataset = yield* Config.withDefault(
      Config.string("HONEYCOMB_DATASET"),
      "effect-http-play"
    );
    
    // 三种模式：
    // 1. Honeycomb（需要 API key）
    // 2. 自定义 OTLP 端点
    // 3. 空层（不导出追踪）
  })
);
```

## 3. 自定义错误类定义

使用 `Schema.TaggedError` 创建类型安全的错误类，自动支持序列化和 HTTP 状态码映射：

```typescript
// 404 - 资源未找到
export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  { userId: Schema.String },
  HttpApiSchema.annotations({ status: 404 })
) {
  get message() {
    return `User with ID ${this.userId} not found`;
  }
}

// 400 - 验证错误
export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError", 
  { 
    field: Schema.String,
    message: Schema.String 
  },
  HttpApiSchema.annotations({ status: 400 })
) {}

// 500 - 数据库错误
export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  { 
    operation: Schema.String,
    details: Schema.String 
  },
  HttpApiSchema.annotations({ status: 500 })
) {}
```

## 4. 错误处理模式实现

### 4.1 Option 转错误

将数据库查询结果从 `Option` 转换为具体的业务错误：

```typescript
const userRepository = {
  findById: (userId: string) => 
    Effect.gen(function* () {
      // 模拟数据库查询
      if (userId === "404") {
        return Option.none();  // 用户不存在
      }
      return Option.some({ id: userId, name: "John Doe", ... });
    })
};

// 在业务逻辑中转换
const fetchUserData = (userId: string) =>
  Effect.gen(function* () {
    const result = yield* userRepository.findById(userId);
    
    // Option -> Error 转换
    return yield* Option.match(result, {
      onNone: () => Effect.fail(new UserNotFound({ userId })),
      onSome: Effect.succeed
    });
  });
```

### 4.2 错误捕获与追踪

在追踪 span 中记录错误信息：

```typescript
Effect.catchTag("DatabaseError", (error) => 
  Effect.gen(function* () {
    yield* Effect.logError("Database error occurred", error);
    
    // 在追踪中标记错误
    yield* Effect.annotateCurrentSpan({
      "error": true,
      "error.type": "DatabaseError",
      "error.message": error.details
    });
    
    return yield* Effect.fail(error);
  })
)
```

### 4.3 全局错误处理策略

使用 `Effect.catchTags` 处理多种错误类型：

```typescript
Effect.catchTags({
  ValidationError: (error) => 
    Effect.gen(function* () {
      yield* Effect.logWarn(`Validation failed: ${error.field}`);
      return yield* Effect.fail(error);  // 重新抛出
    }),
    
  UserNotFound: (error) => 
    Effect.gen(function* () {
      yield* Effect.logWarn(`User not found: ${error.userId}`);
      // 可以返回默认值或创建新用户
      return yield* Effect.fail(error);
    }),
    
  DatabaseError: (error) => 
    Effect.gen(function* () {
      yield* Effect.logError(`Database error: ${error.operation}`);
      // 致命错误，使用 Effect.die
      return yield* Effect.die(error);
    })
})
```

## 5. HTTP 端点集成

### 5.1 错误类型安全的 HTTP 响应

```typescript
app.get("/test/:userId?", async (c) => {
  const userId = c.req.param("userId") || "123";

  const result = await Effect.runPromise(
    businessLogic(userId).pipe(
      Effect.provide(TracingLive),
      Effect.either  // 转换为 Either 类型
    )
  );

  if (result._tag === "Right") {
    return c.json({ success: true, data: result.right });
  }

  // 根据错误类型返回不同的 HTTP 状态码
  const error = result.left;
  
  if (error instanceof ValidationError) {
    return c.json({
      success: false,
      error: { type: "ValidationError", field: error.field, message: error.message }
    }, 400);
  }

  if (error instanceof UserNotFound) {
    return c.json({
      success: false,
      error: { type: "UserNotFound", message: error.message }
    }, 404);
  }

  if (error instanceof DatabaseError) {
    return c.json({
      success: false,
      error: { type: "DatabaseError", operation: error.operation, details: error.details }
    }, 500);
  }
});
```

## 6. 测试场景

项目包含以下测试场景：

| 测试 ID | 场景 | 预期结果 |
|---------|------|----------|
| `123` | 成功查询 | 返回用户数据 |
| `404` | 用户不存在 | UserNotFound 错误 |
| `error` | 数据库连接失败 | DatabaseError 错误 |
| `""` (空) | 验证失败 | ValidationError 错误 |
| `process-error` | 处理过程错误 | DatabaseError (UPDATE 失败) |

## 7. 运行与测试

### 7.1 启动服务

```bash
# 使用 Vercel dev（serverless 模式）
npm start

# 或使用环境变量配置追踪
HONEYCOMB_API_KEY=your-key npm start
```

### 7.2 测试端点

```bash
# 成功场景
curl http://localhost:3000/test/123

# 用户不存在（404）
curl http://localhost:3000/test/404

# 数据库错误（500）
curl http://localhost:3000/test/error

# 验证错误（400）
curl http://localhost:3000/test/

# 运行所有测试
curl http://localhost:3000/demo

# 或直接运行测试脚本
npm run test-errors
```

### 7.3 响应示例

成功响应：
```json
{
  "success": true,
  "data": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com",
    "processed": true,
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

错误响应（404）：
```json
{
  "success": false,
  "error": {
    "type": "UserNotFound",
    "message": "User with ID 404 not found"
  }
}
```

## 8. 最佳实践总结

1. **类型安全**：所有错误都是强类型的，编译时即可发现错误
2. **追踪集成**：每个操作都有对应的 span，错误自动记录在追踪中
3. **错误恢复**：使用 `catchTag` 和 `catchTags` 实现细粒度错误处理
4. **HTTP 映射**：错误类自动映射到正确的 HTTP 状态码
5. **分层架构**：
   - Repository 层：返回 `Option` 或 `Effect` 错误
   - Service 层：转换 `Option` 为业务错误
   - HTTP 层：将错误映射为 HTTP 响应

## 9. 追踪可视化

使用 TracingLive 后，可以在以下工具中查看追踪：

- **Honeycomb**：设置 `HONEYCOMB_API_KEY` 环境变量
- **Jaeger**：设置 `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
- **其他 OTLP 兼容工具**：配置相应的端点

追踪视图将显示：
- 请求的完整调用链
- 每个操作的耗时
- 错误发生的位置和详情
- 自定义属性（如 userId、operation 等）

## 10. 扩展建议

1. **添加重试机制**：
   ```typescript
   Effect.retry(Schedule.exponential("100 millis"))
   ```

2. **添加熔断器**：
   ```typescript
   Effect.cachedWithTTL("5 minutes")
   ```

3. **添加更多错误类型**：
   - `RateLimitError` - 429 限流
   - `ConflictError` - 409 冲突
   - `ForbiddenError` - 403 禁止访问

4. **集成数据库事务**：
   ```typescript
   sql.withTransaction
   ```

这个示例展示了 Effect 在实际项目中的强大能力，将函数式编程、类型安全、错误处理和分布式追踪完美结合。

## 11. CatchTags 行为详解

在实际测试中发现的 `Effect.catchTags` 重要行为：

### 错误处理流程

1. **ValidationError 和 UserNotFound**：
   ```typescript
   Effect.logWarning(`Validation failed: ${error.field}`) // 记录警告
   Effect.fail(error) // 重新抛出错误
   ```
   - 错误仍然向上传播
   - 可以被外层的错误处理捕获

2. **DatabaseError**：
   ```typescript
   Effect.logError(`Database error: ${error.operation}`) // 记录错误
   Effect.die(error) // 转为 defect
   ```
   - 标记为不可恢复的致命错误
   - 但 `Effect.either` 仍会将其捕获为 Left

### 测试验证的行为

```typescript
// Effect.either 会捕获所有错误，包括通过 die() 转换的 defects
const result = await Effect.runPromise(
  businessLogic("error").pipe(
    Effect.provide(TracingLive),
    Effect.either
  )
);
// result._tag === "Left" 
// result.left instanceof DatabaseError
```

### 日志输出示例

```
INFO: Starting business logic
INFO: Fetching user data for: 404
INFO: DB: Querying user 404
WARN: User not found: 404  // catchTags 处理
```

这种设计让你可以：
- 在错误传播过程中添加日志
- 转换错误类型
- 实现错误恢复策略
- 保持错误的可追踪性
