require("dotenv").config();

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const nodemailer = require("nodemailer");

const publicDirectory = __dirname;
const maximumBodyBytes = 16 * 1024;
const rateLimits = new Map();
const publicFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/client-showcase.html", "client-showcase.html"],
  ["/style.css", "style.css"],
  ["/index.js", "index.js"],
  ["/favicon.svg", "favicon.svg"]
]);

const smtpSettings = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
  recipient: process.env.CONTACT_EMAIL
};

const mailerConfigured = Boolean(
  smtpSettings.host &&
  smtpSettings.user &&
  smtpSettings.password &&
  smtpSettings.from &&
  smtpSettings.recipient &&
  Number.isInteger(smtpSettings.port) &&
  smtpSettings.port > 0
);

const mailer = mailerConfigured
  ? nodemailer.createTransport({
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      auth: {
        user: smtpSettings.user,
        pass: smtpSettings.password
      }
    })
  : null;

const chatAnswers = [
  {
    keywords: ["service", "offer", "do you do", "website types"],
    reply: "Elevate Digital creates personal portfolio websites, business websites, landing pages, and digital presence solutions. Every website is designed to look professional, work on mobile, and help customers contact you."
  },
  {
    keywords: ["package", "packages", "price", "cost", "how much", "budget", "r700", "1500", "1000"],
    reply: "There are three clear starting packages: Portfolio One-Page from R1,400, Conversion Landing Page from R3,000, and Business Website from R4,500. The final quote depends on your pages, content, and features."
  },
  {
    keywords: ["time", "long", "timeline", "days", "week", "finish", "delivery"],
    reply: "Most focused websites can be planned and built within 1 to 3 weeks, depending on the content and features."
  },
  {
    keywords: ["revision", "revisions", "change", "edit"],
    reply: "Yes. A review stage is included so you can request reasonable changes to text, layout, and visual details before launch."
  },
  {
    keywords: ["portfolio", "work", "example", "project", "projects"],
    reply: "The portfolio includes sample previews for a creative studio, business coach, and freelancer profile. You can also send your preferred style or business example to Ofentse on WhatsApp."
  },
  {
    keywords: ["process", "how it works", "steps", "begin"],
    reply: "The process is simple: share your idea, plan the pages and style, review the website during development, then launch when everything is approved."
  },
  {
    keywords: ["start", "contact", "hire", "book", "next step", "need a website"],
    reply: "To start, share your name, business name, website type, preferred deadline, and any examples you like. Then WhatsApp Ofentse for a personal quote from Elevate Digital."
  },
  {
    keywords: ["email", "phone", "number", "reach", "whatsapp"],
    reply: "You can reach Elevate Digital at ElevateDigital@gmail.com or 079 884 8721. Use the WhatsApp button below and your question will be included in the message."
  }
];

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function applySecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function getRequestPath(request) {
  try {
    return new URL(request.url, "http://localhost").pathname;
  } catch {
    throw new RequestError(400, "Invalid request URL.");
  }
}

function checkSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  try {
    if (new URL(origin).host !== request.headers.host) {
      throw new RequestError(403, "Cross-origin requests are not allowed.");
    }
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, "Invalid request origin.");
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      reject(new RequestError(415, "Send this request as JSON."));
      return;
    }

    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > maximumBodyBytes) {
      reject(new RequestError(413, "Request body is too large."));
      return;
    }

    let body = "";
    let tooLarge = false;

    request.on("data", (chunk) => {
      if (tooLarge) {
        return;
      }
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) {
        tooLarge = true;
        reject(new RequestError(413, "Request body is too large."));
      }
    });

    request.on("end", () => {
      if (tooLarge) {
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new RequestError(400, "Request body must contain valid JSON."));
      }
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}

function rateLimit(request, bucket, limit, windowMilliseconds) {
  const key = `${bucket}:${request.socket.remoteAddress || "unknown"}`;
  const now = Date.now();
  let entry = rateLimits.get(key);

  if (!entry || entry.expiresAt <= now) {
    entry = { count: 0, expiresAt: now + windowMilliseconds };
    rateLimits.set(key, entry);
  }

  entry.count += 1;
  return entry.count <= limit;
}

function validateEmail(value) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function findChatReply(question) {
  const normalizedQuestion = question.toLowerCase();
  const match = chatAnswers.find((answer) =>
    answer.keywords.some((keyword) => normalizedQuestion.includes(keyword))
  );

  return match
    ? match.reply
    : "I can help with services, packages, prices, timelines, revisions, portfolio work, and starting a project. Please ask a specific question or WhatsApp Ofentse for a personal answer from Elevate Digital.";
}

async function handleChat(request, response) {
  if (!rateLimit(request, "chat", 30, 60 * 1000)) {
    sendJson(response, 429, { error: "Please wait a moment before sending more questions." });
    return;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1000) {
    throw new RequestError(400, "Enter a question of up to 1,000 characters.");
  }

  sendJson(response, 200, { reply: findChatReply(body.message.trim()) });
}

async function handleInquiry(request, response) {
  if (!rateLimit(request, "inquiry", 5, 15 * 60 * 1000)) {
    sendJson(response, 429, { error: "Please wait before sending another enquiry." });
    return;
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError(400, "Request body must be a JSON object.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (body.type !== "project" && body.type !== "consultation") {
    throw new RequestError(400, "Choose a project enquiry or consultation request.");
  }
  const type = body.type === "consultation" ? "Consultation request" : "Project enquiry";

  if (body.website) {
    throw new RequestError(400, "The enquiry could not be accepted.");
  }
  if (!name || name.length > 120) {
    throw new RequestError(400, "Enter your name (up to 120 characters).");
  }
  if (!validateEmail(email)) {
    throw new RequestError(400, "Enter a valid email address.");
  }
  if (!message || message.length > 5000) {
    throw new RequestError(400, "Enter a message of up to 5,000 characters.");
  }
  if (!mailer) {
    sendJson(response, 503, {
      error: "Email delivery is not configured yet. Please contact us on WhatsApp or email."
    });
    return;
  }

  try {
    await mailer.sendMail({
      from: smtpSettings.from,
      to: smtpSettings.recipient,
      replyTo: email,
      subject: `New ${type} - Elevate Digital`,
      text: `${type}\n\nName: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
    });
  } catch (error) {
    console.error("SMTP delivery failed:", error instanceof Error ? error.message : String(error));
    sendJson(response, 502, {
      error: "We couldn't deliver your enquiry just now. Please try WhatsApp or email us directly."
    });
    return;
  }

  sendJson(response, 200, { message: "Thanks. Your enquiry has been sent successfully." });
}

async function serveStaticFile(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const fileName = publicFiles.get(pathname);
  if (!fileName) {
    sendJson(response, 404, { error: "Page not found." });
    return;
  }

  const filePath = path.join(publicDirectory, fileName);
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    console.error(`Unable to read public file "${fileName}":`, error.message);
    sendJson(response, 500, { error: "The requested page could not be served." });
    return;
  }

  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Length": content.length,
    "Content-Type": contentTypes[path.extname(fileName)]
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

async function handleRequest(request, response) {
  applySecurityHeaders(response);

  let pathname;
  try {
    pathname = getRequestPath(request);
    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, { status: "ok", emailConfigured: Boolean(mailer) });
      return;
    }
    if (pathname.startsWith("/api/")) {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      checkSameOrigin(request);
      if (pathname === "/api/chat") {
        await handleChat(request, response);
        return;
      }
      if (pathname === "/api/inquiries") {
        await handleInquiry(request, response);
        return;
      }
      sendJson(response, 404, { error: "API endpoint not found." });
      return;
    }
    await serveStaticFile(request, response, pathname);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }
    console.error("Request failed:", error instanceof Error ? error.message : String(error));
    sendJson(response, 500, { error: "The request could not be completed." });
  }
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (entry.expiresAt <= now) {
      rateLimits.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a number between 1 and 65535.");
}

const server = http.createServer((request, response) => {
  handleRequest(request, response);
});

server.listen(port, () => {
  console.log(`Elevate Digital is running at http://localhost:${port}`);
  if (!mailer) {
    console.warn("SMTP is not configured. Add the required values to .env to receive enquiry emails.");
  }
});
