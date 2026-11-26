import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import connectDB from "./config/database.js";
import customerRoutes from "./routes/customerRoutes.js";
import transactionRoutes from "./routes/transactionRoutes.js";

dotenv.config();

const app = express();

// Rate limiter
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});

// CORS configuration
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Security middleware
app.use(helmet());
app.use(limiter);
app.use(cors(corsOptions));
app.use(express.json({ limit: "10kb" }));

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "BolKhata AI Backend is healthy!",
    project: "BolKhata AI",
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use("/api/customers", customerRoutes);
app.use("/api/transactions", transactionRoutes);

// Root route
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "BolKhata AI Backend is running!",
    project: "BolKhata AI",
  });
});

// Gnani Text-to-Speech
app.post("/api/voice/speak", async (req, res, next) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Valid text is required (maximum 1000 characters).",
      });
    }

    if (!process.env.GNANI_API_KEY) {
      return res.status(500).json({
        success: false,
        message: "Gnani API key is not configured.",
      });
    }

    const response = await fetch(
      "https://api.vachana.ai/api/v1/tts/inference",
      {
        method: "POST",
        headers: {
          "X-API-Key-ID": process.env.GNANI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model: "timbre-v2.5",
          voice: "Poorvi",
          language: "hi-en",
          speed: 1.0,
          audio_config: {
            encoding: "linear_pcm",
            container: "wav",
            num_channels: 1,
            sample_rate: 48000,
            sample_width: 2,
          },
        }),
      }
    );

    if (!response.ok) {
      const message = await response.text();

      return res.status(response.status).json({
        success: false,
        message: message || "Gnani speech generation failed.",
      });
    }

    res.setHeader("Content-Type", "audio/wav");
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});

// Centralized error handling
app.use((err, _req, res, _next) => {
  console.error("ERROR:", err.message);
  console.error("STACK:", err.stack);

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "Duplicate field value entered",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();

    console.log("MongoDB connected successfully");

    const PORT = process.env.PORT || 5000;
    const server = createServer(app);

    const voiceWss = new WebSocketServer({
      noServer: true,
    });

    // WebSocket upgrade handling
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/api/voice/stream") {
        socket.destroy();
        return;
      }

      if (!process.env.GNANI_API_KEY) {
        socket.destroy();
        return;
      }

      voiceWss.handleUpgrade(request, socket, head, (clientWs) => {
        voiceWss.emit("connection", clientWs);
      });
    });

    // Gnani STT WebSocket proxy
    voiceWss.on("connection", (ws) => {
      let gnaniWs = null;
      let audioFrameCount = 0;
      let gnaniConnected = false;
      let stopped = false;

      try {
        gnaniWs = new WebSocket(
          "wss://api.vachana.ai/stt/v3/stream",
          {
            headers: {
              "X-API-Key-ID": process.env.GNANI_API_KEY,
              language_code: "hi-IN",
              "x-sample-rate": "16000",
            },
          }
        );
      } catch (err) {
        console.error(
          "Failed to create Gnani WebSocket:",
          err.message
        );

        ws.close();
        return;
      }

      // Gnani WebSocket opened
      // Wait for actual STT connection confirmation
      gnaniWs.on("open", () => {
        console.log(
          "Gnani WebSocket opened; waiting for STT connection"
        );
      });

      // Handle rejected Gnani connection
      gnaniWs.on("unexpected-response", (res) => {
        console.log(
          "Gnani rejected connection, HTTP status:",
          res.statusCode
        );

        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          console.log("Gnani response body:", body);
        });
      });

      // Handle Gnani messages
      gnaniWs.on("message", (data) => {
        const raw = data.toString();

        console.log("Gnani message:", raw.slice(0, 300));

        try {
          const message = JSON.parse(raw);

          // Actual Gnani connection confirmation
          if (message.type === "connected") {
            gnaniConnected = true;

            console.log(
              "Gnani STT connected - audio forwarding enabled"
            );

            // Notify frontend only after Gnani confirms connection
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "ready",
                })
              );
            }

            return;
          }

          // Ignore messages until connected
          if (!gnaniConnected) {
            return;
          }

          // Transcript response
          if (message.type === "transcript" && message.text) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "transcript",
                  text: message.text,
                })
              );
            }
          }

          // STT error
          else if (message.type === "error") {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: message.message || "Gnani STT error.",
                })
              );
            }

            stop();
          }

          // Session bias acknowledgment
          else if (message.type === "sessionbias") {
            // No action required
          }
        } catch (err) {
          console.error(
            "Error parsing Gnani message:",
            err.message
          );
        }
      });

      // Handle Gnani WebSocket errors
      gnaniWs.on("error", (err) => {
        console.error("Gnani WebSocket error:", err.message);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Gnani STT connection error.",
            })
          );
        }

        stop();
      });

      // Handle Gnani WebSocket close
      gnaniWs.on("close", (code, reason) => {
        console.log(
          "Gnani STT connection closed:",
          code,
          reason.toString()
        );

        stop();
      });

      // Forward client audio to Gnani
      ws.on("message", (data) => {
        // Do not forward audio until Gnani confirms connection
        if (
          !gnaniConnected ||
          !gnaniWs ||
          gnaniWs.readyState !== WebSocket.OPEN
        ) {
          return;
        }

        // Binary PCM audio frames
        if (
          Buffer.isBuffer(data) ||
          data instanceof Uint8Array ||
          data instanceof ArrayBuffer
        ) {
          audioFrameCount++;

          if (audioFrameCount % 100 === 0) {
            console.log(
              `Forwarded ${audioFrameCount} audio frames to Gnani STT`
            );
          }

          gnaniWs.send(data);
        }

        // Control messages
        else if (typeof data === "string") {
          try {
            const msg = JSON.parse(data);

            if (msg.type && msg.type !== "audio") {
              gnaniWs.send(data);
            }
          } catch {
            // Ignore invalid JSON
          }
        }
      });

      // Client disconnected
      ws.on("close", stop);

      // Stop both connections safely
      function stop() {
        if (stopped) return;

        stopped = true;
        gnaniConnected = false;

        if (
          gnaniWs &&
          gnaniWs.readyState !== WebSocket.CLOSED
        ) {
          gnaniWs.close();
        }

        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
      }
    });

    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(
        `Environment: ${process.env.NODE_ENV || "development"}`
      );
      console.log(
        `CORS origin: ${process.env.CORS_ORIGIN || "development (all origins)"}`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();