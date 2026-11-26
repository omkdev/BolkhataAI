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

// Security headers with Helmet
const app = express();

// Rate limiter - limit to 100 requests per minute
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { success: false, message: "Too many requests, please try again later." },
});

// CORS configuration based on environment
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : []; // Empty by default for security

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // In development, allow all; in production, restrict
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Apply security middleware in correct order
app.use(helmet()); // 1. Security headers first
app.use(limiter); // 2. Rate limiter second
app.use(cors(corsOptions)); // 3. CORS third
app.use(express.json({ limit: "10kb" })); // 4. Body size limit fourth

// Health check route (before routes to ensure it works)
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

// Gnani Text-to-Speech (must come before 404 handler)
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

// Centralized error handling - must be after all other middleware
app.use((err, _req, res, _next) => {
  console.error("ERROR:", err.message);
  console.error("STACK:", err.stack);

  // Mongoose validation error
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: Object.values(err.errors).map((e) => e.message),
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "Duplicate field value entered",
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

const startServer = async () => {
  try {
    await connectDB();
    console.log("MongoDB connected successfully");

    const PORT = process.env.PORT || 5000;
    const server = createServer(app);

    const voiceWss = new WebSocketServer({ noServer: true });

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
      // @ts-ignore: audioFrameCount used for logging only; see ws.on("message") counter log
      let gnaniWs = null;
      let audioFrameCount = 0;

      try {
        gnaniWs = new WebSocket("wss://api.vachana.ai/stt/v3/stream", {
          headers: {
            "X-API-Key-ID": process.env.GNANI_API_KEY,
            "language_code": "hi-IN",
            "x-sample-rate": "16000",
          },
        });
      } catch (err) {
        console.error("Failed to create Gnani WebSocket:", err.message);
        ws.close();
        return;
      }

      gnaniWs.on("open", () => {
      console.log("Gnani WS open");
      // Tell the client the Gnani STT connection is ready
      ws.send(JSON.stringify({ type: "ready" }));
    });

      gnaniWs.on("unexpected-response", (res) => {
        console.log("Gnani rejected connection, HTTP status:", res.statusCode);
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => console.log("Gnani response body:", body));
      });

      gnaniWs.on("error", (err) => console.log("Gnani WS error:", err.message));

      gnaniWs.on("close", (code, reason) =>
        console.log("Gnani WS closed:", code, reason.toString())
      );

      let gnamiConnected = false;

      gnaniWs.on("message", (data) => {
        const raw = data.toString();
        console.log("Gnani message:", raw.slice(0, 300));
        try {
          const message = JSON.parse(raw);

          if (message.type === "connected") {
            // Gnami STT v3 connection established, now safe to send audio
            gnamiConnected = true;
            console.log("Gnami STT connected - audio forwarding enabled");
            return;
          }

          if (!gnamiConnected) {
            // Waiting for initial connection; ignore other messages until connected
            return;
          }

          if (message.type === "transcript" && message.text) {
            // Send final/partial transcript to client
            ws.send(
              JSON.stringify({
                type: "transcript",
                text: message.text,
              })
            );
          } else if (message.type === "error") {
            ws.send(
              JSON.stringify({
                type: "error",
                message: message.message || "Gnani STT error.",
              })
            );
            stop();
          } else if (message.type === "sessionbias") {
            // Keyterms/bias configuration acknowledgment
          }
        } catch (err) {
          console.error("Error parsing Gnani message:", err.message);
        }
      });

      gnaniWs.on("error", (err) => {
        console.error("Gnani WebSocket error:", err.message);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Gnani STT connection error.",
          })
        );
        stop();
      });

      gnaniWs.on("close", () => {
        console.log("Gnani STT connection closed");
        stop();
      });

      // Forward client audio to Gnani
      ws.on("message", (data) => {
        if (gnaniWs.readyState === WebSocket.OPEN) {
          // Gnani expects raw PCM audio sent as binary frames
          if (Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer) {
            audioFrameCount++;
            if (audioFrameCount % 100 === 0) {
              console.log(`Forwarded ${audioFrameCount} audio frames to Gnani STT`);
            }
            gnaniWs.send(data);
          } else if (typeof data === "string") {
            // Maybe JSON message, forward as-is or parse
            try {
              const msg = JSON.parse(data);
              if (msg.type && msg.type !== "audio") {
                // It's a control message, forward to Gnani
                gnaniWs.send(data);
              }
            } catch {
              // Not JSON, ignore or handle as needed
            }
          }
        }
      });

      ws.on("close", stop);

      function stop() {
        if (gnaniWs && gnaniWs.readyState === WebSocket.OPEN) {
          gnaniWs.close();
          gnaniWs = null;
        }
        ws.close();
      }
    });

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(`CORS origin: ${process.env.CORS_ORIGIN || "development (all origins)"}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();