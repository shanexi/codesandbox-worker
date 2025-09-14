# Effect 错误处理模式

本文档整理了项目中使用的 Effect 错误处理相关的代码模式和最佳实践。

## 1. 自定义错误类（TaggedError）

Effect 使用 `Schema.TaggedError` 创建类型安全的错误类，可以自动序列化和映射 HTTP 状态码。

### 基础错误定义

```typescript
// src/Domain/User.ts
export class UserNotFound extends Schema.TaggedError<UserNotFound>()(
  "UserNotFound",
  { id: UserId },
  HttpApiSchema.annotations({ status: 404 })  // 自动映射 HTTP 状态码
) {}

// src/Domain/Group.ts
export class GroupNotFound extends Schema.TaggedError<GroupNotFound>()(
  "GroupNotFound",
  { id: GroupId },
  HttpApiSchema.annotations({ status: 404 })
) {}

// src/Domain/Person.ts
export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()(
  "PersonNotFound",
  { id: PersonId }
) {}
```

### 带自定义消息的错误

```typescript
// src/Domain/Policy.ts
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {
    actorId: UserId,
    entity: Schema.String,
    action: Schema.String
  },
  HttpApiSchema.annotations({ status: 403 })
) {
  get message() {
    return `Actor (${this.actorId}) is not authorized to perform action "${this.action}" on entity "${this.entity}"`
  }
  
  static is(u: unknown): u is Unauthorized {
    return Predicate.isTagged(u, "Unauthorized")
  }
}
```

## 2. Option 转错误处理

将 `Option.none` 转换为具体的业务错误。

### 基础模式

```typescript
// src/Accounts.ts
userRepo.findById(id).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.fail(new UserNotFound({ id })),
      onSome: Effect.succeed
    })
  )
)
```

### 简化写法

```typescript
// src/Groups.ts
repo.findById(id).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => new GroupNotFound({ id }),  // 直接返回错误对象
      onSome: Effect.succeed
    })
  )
)
```

### 在 HTTP 处理器中使用

```typescript
// src/Accounts/Http.ts
accounts.findUserById(path.id).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => new UserNotFound({ id: path.id }),
      onSome: Effect.succeed
    })
  )
)
```

## 3. 错误捕获和处理

### 捕获特定标签的错误

```typescript
// src/Groups.ts
Effect.catchTag("SqlError", (err) => Effect.die(err))
```

### 条件性捕获错误

```typescript
// src/Domain/Policy.ts
static refail(entity: string, action: string) {
  return <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, Unauthorized, CurrentUser | R> =>
    Effect.catchIf(
      effect,
      (e) => !Unauthorized.is(e),  // 只捕获非 Unauthorized 错误
      () =>
        Effect.flatMap(
          CurrentUser,
          (actor) =>
            new Unauthorized({
              actorId: actor.id,
              entity,
              action
            })
        )
    ) as any
}
```

### 映射错误

```typescript
// src/People/Http.ts
people.findById(path.id).pipe(
  Effect.flatten,
  Effect.mapError(() => new PersonNotFound({ id: path.id }))
)
```

## 4. 事务错误处理

在数据库事务中处理错误，确保数据一致性。

### 完整的事务错误处理模式

```typescript
// src/Groups.ts
const with_ = <A, E, R>(
  id: GroupId,
  f: (group: Group) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | GroupNotFound, R> =>
  pipe(
    repo.findById(id),
    Effect.flatMap(
      Option.match({
        onNone: () => new GroupNotFound({ id }),
        onSome: Effect.succeed
      })
    ),
    Effect.flatMap(f),
    sql.withTransaction,  // 事务包装
    Effect.catchTag("SqlError", (err) => Effect.die(err)),  // SQL错误转为致命错误
    Effect.withSpan("Groups.with", { attributes: { id } })
  )
```

### 创建操作的事务处理

```typescript
// src/Accounts.ts
const createUser = (user: typeof User.jsonCreate.Type) =>
  accountRepo.insert(Account.insert.make({})).pipe(
    Effect.tap((account) => Effect.annotateCurrentSpan("account", account)),
    Effect.bindTo("account"),
    Effect.bind("accessToken", () => uuid.generate.pipe(Effect.map(accessTokenFromString))),
    Effect.bind("user", ({ accessToken, account }) =>
      userRepo.insert(
        User.insert.make({
          ...user,
          accountId: account.id,
          accessToken
        })
      )),
    Effect.map(({ account, user }) =>
      new UserWithSensitive({ ...user, account })
    ),
    sql.withTransaction,
    Effect.orDie,  // 事务失败时直接崩溃
    Effect.withSpan("Accounts.createUser", { attributes: { user } }),
    policyRequire("User", "create")
  )
```

## 5. Effect.orDie 处理

将可恢复错误转为致命错误（不可恢复）。

### 数据完整性保证

```typescript
// src/Accounts.ts
const embellishUser = (user: User) =>
  pipe(
    accountRepo.findById(user.accountId),
    Effect.flatten,
    Effect.map((account) => new UserWithSensitive({ ...user, account })),
    Effect.orDie,  // 账户必须存在，否则数据不一致
    Effect.withSpan("Accounts.embellishUser", {
      attributes: { id: user.id }
    }),
    policyRequire("User", "readSensitive")
  )
```

### 仓库层的错误处理

```typescript
// src/Accounts/UsersRepo.ts
findByAccessToken: (accessToken) =>
  sql`...`.pipe(
    Effect.map(Chunk.head),
    Effect.orDie,  // SQL 查询失败是致命错误
    Effect.withSpan("UserRepo.findByAccessToken")
  )
```

## 6. 认证错误处理

处理认证失败的场景。

```typescript
// src/Accounts/Http.ts
export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function*() {
    const userRepo = yield* UsersRepo

    return Authentication.of({
      cookie: (token) =>
        userRepo.findByAccessToken(accessTokenFromRedacted(token)).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                new Unauthorized({
                  actorId: UserId.make(-1),  // 特殊的未认证用户ID
                  entity: "User",
                  action: "read"
                }),
              onSome: Effect.succeed
            })
          ),
          Effect.withSpan("Authentication.cookie")
        )
    })
  })
)
```

## 7. 错误类型组合

函数签名清楚地表明可能的错误类型。

```typescript
// 明确的错误类型声明
const with_ = <B, E, R>(
  id: PersonId,
  f: (person: Person) => Effect.Effect<B, E, R>
): Effect.Effect<B, E | PersonNotFound, R>  // 添加 PersonNotFound 到错误类型

// 更新操作的错误处理
const updateUser = (
  id: UserId,
  user: Partial<typeof User.jsonUpdate.Type>
) =>
  userRepo.findById(id).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => new UserNotFound({ id }),
        onSome: Effect.succeed
      })
    ),
    Effect.andThen((previous) =>
      userRepo.update({
        ...previous,
        ...user,
        id,
        updatedAt: undefined
      })
    ),
    sql.withTransaction,
    Effect.catchTag("SqlError", (err) => Effect.die(err)),
    Effect.withSpan("Accounts.updateUser", { attributes: { id, user } }),
    policyRequire("User", "update")
  )
```

## 错误处理最佳实践

1. **类型安全**：所有错误都是强类型的，在编译时就能知道可能出现的错误
2. **自动 HTTP 状态码映射**：通过 `HttpApiSchema.annotations` 自动处理 HTTP 响应
3. **错误组合**：函数签名清楚地表明可能的错误类型，如 `Effect<A, E | GroupNotFound, R>`
4. **致命错误处理**：使用 `Effect.die` 和 `Effect.orDie` 处理不可恢复的错误
5. **事务安全**：通过 `withTransaction` 和错误处理确保数据一致性
6. **追踪集成**：所有错误处理都与 OpenTelemetry 追踪集成（通过 `Effect.withSpan`）
7. **语义化错误**：错误类型和消息都具有明确的业务语义
8. **错误恢复**：通过 `Effect.catchTag` 和 `Effect.catchIf` 实现细粒度的错误恢复

## 错误处理流程图

```
请求 → 认证检查 → 权限验证 → 业务逻辑 → 数据访问
         ↓           ↓           ↓           ↓
    Unauthorized  Unauthorized  业务错误   SqlError
         ↓           ↓           ↓           ↓
      403响应     403响应    4xx响应    Effect.die
```

这种错误处理模式让代码更健壮，错误更容易追踪和调试，同时保持了类型安全和函数式编程的优雅性。
