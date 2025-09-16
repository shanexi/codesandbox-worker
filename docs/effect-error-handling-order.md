# Effect 错误处理中的顺序问题

## 问题描述

在使用 Effect 进行错误处理时，`Effect.map` 和 `Effect.catchTags` 的顺序会影响最终结果。

## 错误的写法

```typescript
businessLogic(userId).pipe(
  Effect.catchTags({
    UserNotFound: (error) =>
      Effect.succeed(
        c.json({ success: false, error: { ... } }, 404)
      ),
  }),
  Effect.map((data) =>
    c.json({ success: true, data })
  )
)
```

### 问题分析

1. `catchTags` 将错误转换为"成功"的错误响应
2. `map` 看到"成功"，继续执行，将错误响应包装成成功响应
3. 结果是嵌套的错误结构：

```json
{
  "success": true,
  "data": {
    "success": false,
    "error": { ... }
  }
}
```

## 正确的写法

```typescript
businessLogic(userId).pipe(
  Effect.map((data) =>
    c.json({ success: true, data })
  ),
  Effect.catchTags({
    UserNotFound: (error) =>
      Effect.succeed(
        c.json({ success: false, error: { ... } }, 404)
      ),
  })
)
```

### 正确的执行流程

**成功路径**：
1. `businessLogic` 成功返回数据
2. `map` 将数据包装为成功响应
3. `catchTags` 不执行（没有错误）

**错误路径**：
1. `businessLogic` 抛出错误
2. `map` 被跳过（有错误）
3. `catchTags` 捕获错误，返回错误响应

## 核心原理

**Effect pipe 的关键特性**：
- 操作按顺序执行
- `catchTags` 只能捕获它**之前**的错误
- 错误会跳过后续的 `map` 操作，直到遇到错误处理器

## 最佳实践

1. **先处理成功情况**：使用 `map` 转换成功结果
2. **后处理错误情况**：使用 `catchTags` 处理各种错误类型
3. **避免双重包装**：确保错误处理和成功处理不会重叠

## 其他解决方案

如果需要更复杂的控制，可以考虑：

### 使用 Either

```typescript
const result = await Effect.runPromise(
  businessLogic(userId).pipe(
    Effect.provide(TracingLive),
    Effect.either
  )
);

if (Either.isRight(result)) {
  return c.json({ success: true, data: result.right });
} else {
  // 手动处理 result.left 错误
}
```

### 使用 Exit

```typescript
const exit = await Effect.runPromise(
  businessLogic(userId).pipe(
    Effect.provide(TracingLive),
    Effect.exit
  )
);

return Exit.match(exit, {
  onFailure: (cause) => {
    // 处理失败
  },
  onSuccess: (data) => {
    // 处理成功
  }
});
```

## 总结

Effect 的错误处理顺序至关重要：
- **先 map 后 catch**：避免双重包装
- **先 catch 后 map**：会导致错误响应被再次包装

记住：Effect 中的错误处理器（如 `catchTags`）会将错误转换为成功，后续的 `map` 操作会继续执行。
