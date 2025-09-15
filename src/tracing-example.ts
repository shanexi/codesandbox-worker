import { Effect, Data, Option } from "effect";

// Define custom error classes using Data.TaggedError
export class UserNotFound extends Data.TaggedError("UserNotFound")<{
  userId: string;
}> {
  get message() {
    return `User with ID ${this.userId} not found`;
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  field: string;
  message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  operation: string;
  details: string;
}> {}

// Simulate database repository
const userRepository = {
  findById: (userId: string) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`DB: Querying user ${userId}`);
      yield* Effect.sleep("50 millis");

      // Simulate different scenarios
      if (userId === "error") {
        return yield* Effect.fail(
          new DatabaseError({
            operation: "SELECT",
            details: "Connection timeout",
          })
        );
      }

      if (userId === "404") {
        return Option.none();
      }

      return Option.some({
        id: userId,
        name: "John Doe",
        email: "john@example.com",
        createdAt: new Date().toISOString(),
      });
    }).pipe(
      Effect.withSpan("db.query", {
        attributes: {
          "db.operation": "SELECT",
          "db.table": "users",
          userId,
        },
      })
    ),
};

// Business logic with error handling
const fetchUserData = (userId: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Fetching user data for: ${userId}`);

    // Validate input
    if (!userId || userId.trim() === "") {
      return yield* Effect.fail(
        new ValidationError({
          field: "userId",
          message: "User ID cannot be empty",
        })
      );
    }

    // Query database
    const result = yield* userRepository.findById(userId);

    // Handle Option -> Error conversion
    return yield* Option.match(result, {
      onNone: () => Effect.fail(new UserNotFound({ userId })),
      onSome: Effect.succeed,
    });
  }).pipe(
    Effect.withSpan("user.fetch", {
      attributes: { userId },
    }),
    // Catch and handle database errors
    Effect.catchTag("DatabaseError", (error) =>
      Effect.gen(function* () {
        yield* Effect.logError("Database error occurred", error);
        yield* Effect.annotateCurrentSpan({
          error: true,
          "error.type": "DatabaseError",
          "error.message": error.details,
        });
        return yield* Effect.fail(error);
      })
    )
  );

// Process user data with potential errors
const processUserData = (user: { id: string; name: string; email: string }) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Processing user: ${user.name}`);

    // Simulate processing error for specific users
    if (user.id === "process-error") {
      yield* Effect.fail(
        new DatabaseError({
          operation: "UPDATE",
          details: "Failed to update user status",
        })
      );
    }

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


// Main business logic with comprehensive error handling
export const businessLogic = (userId: string) =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Starting business logic");

    try {
      // Fetch user data with error handling
      const user = yield* fetchUserData(userId);

      // Process the data
      const processed = yield* processUserData(user);

      // Add success annotation to current span
      yield* Effect.annotateCurrentSpan({
        "result.processed": processed.processed,
        "result.timestamp": processed.timestamp,
        "result.success": true,
      });

      yield* Effect.logInfo("Business logic completed");

      return processed;
    } catch (error) {
      // This won't actually catch Effect errors, just for demonstration
      // Effect handles errors through its own mechanisms
      yield* Effect.logError("Unexpected error", error);
      throw error;
    }
  }).pipe(
    Effect.withSpan("business.main"),
    // Global error recovery strategy
    Effect.catchTags({
      ValidationError: (error) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(
            `Validation failed: ${error.field} - ${error.message}`
          );
          // Re-throw for demonstration
          return yield* Effect.fail(error);
        }),
      UserNotFound: (error) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(`User not found: ${error.userId}`);
          // Re-throw for demonstration
          return yield* Effect.fail(error);
        }),
      DatabaseError: (error) =>
        Effect.gen(function* () {
          yield* Effect.logError(
            `Database error: ${error.operation} - ${error.details}`
          );
          // Convert to die for critical errors
          return yield* Effect.die(error);
        }),
    })
  );
