require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Queue, Worker } = require("bullmq");
const Redis = require("ioredis");

const app = express();
const port = 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// ✅ Validate required environment variables
if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error("❌ Missing required SMTP environment variables. Exiting...");
  process.exit(1);
}

// ✅ Redis Connection with Auto-Reconnect
const redisConnection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
  reconnectOnError(err) {
    console.error("Redis Error:", err);
    return true;
  },
});

redisConnection.on("error", (err) => console.error("❌ Redis Connection Error:", err));
redisConnection.on("connect", () => console.log("✅ Redis Connected Successfully"));

// ✅ Email Queue Setup
const emailQueue = new Queue("emailQueue", { connection: redisConnection });

// ✅ Nodemailer Transporter with Connection Pooling
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    ciphers: "SSLv3",
  },
  keepAlive: true,
});

// ✅ BullMQ Worker to Process Email Jobs
new Worker(
  "emailQueue",
  async (job) => {
    try {
      const { to, subject, message } = job.data;
      const mailOptions = {
        from: process.env.SMTP_USER,
        to,
        subject,
        text: message,
      };
      const info = await transporter.sendMail(mailOptions);
      console.log("✅ Email Sent:", info.messageId);
    } catch (error) {
      console.error("❌ Email Worker Error:", error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    removeOnComplete: true,
    removeOnFail: { age: 3600, count: 5 },
  }
);

// ✅ Helper function for email validation
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ✅ API Route to Send Email
app.post("/send-email", async (req, res) => {
  try {
    const { to, subject, message } = req.body;

    if (!to || !subject || !message || !isValidEmail(to)) {
      return res.status(400).json({ error: "Invalid or missing required fields" });
    }

    await emailQueue.add("sendEmail", { to, subject, message });

    res.json({ success: true, message: "✅ Email request received" });
  } catch (error) {
    console.error("❌ API Error:", error);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// ✅ Start Express Server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
