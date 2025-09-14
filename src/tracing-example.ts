import { Effect } from "effect";

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
export const businessLogic = (userId: string) =>
  Effect.gen(function* () {
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
