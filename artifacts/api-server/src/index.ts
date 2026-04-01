import app from "./app";
import { logger } from "./lib/logger";

// Export the Express app so Vercel's serverless runtime can invoke it as a handler.
export default app;

// In Vercel the runtime manages the HTTP server — calling app.listen() is both
// unnecessary and broken (PORT is not exposed). Only start the server when
// running outside of Vercel (local dev, Railway, Render, etc.).
if (!process.env["VERCEL"]) {
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}
