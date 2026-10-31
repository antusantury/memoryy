import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);
const root = resolve(process.env.MEMORYY_ROOT || ".");
const dataDir = resolve(process.env.MEMORYY_DATA_DIR || join(root, "data"));
const nvmCopilotBins = (() => {
  const nvmRoot = join(process.env.HOME || "", ".nvm/versions/node");
  if (!existsSync(nvmRoot)) return [];
  return readdirSync(nvmRoot).map((version) => join(nvmRoot, version, "bin/copilot"));
})();
const copilotBin = process.env.COPILOT_BIN || [
  join(process.env.HOME || "", ".local/bin/copilot"),
  ...nvmCopilotBins,
  "/usr/local/bin/copilot",
  "/opt/homebrew/bin/copilot",
  ...String(process.env.PATH || "").split(":").map((directory) => join(directory, "copilot"))
].find((candidate) => candidate && existsSync(candidate)) || "copilot";
const codexBin = process.env.CODEX_BIN || [
  join(process.env.HOME || "", ".local/bin/codex"),
  join(process.env.HOME || "", ".npm-global/bin/codex"),
  "/usr/local/bin/codex",
  "/opt/homebrew/bin/codex",
  ...String(process.env.PATH || "").split(":").map((directory) => join(directory, "codex"))
].find((candidate) => candidate && existsSync(candidate)) || "codex";
const filesDir = join(dataDir, "files");
mkdirSync(filesDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "memoryy.sqlite"));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', summary TEXT NOT NULL DEFAULT '',
    librarian_status TEXT NOT NULL DEFAULT 'pending', topics TEXT NOT NULL DEFAULT '[]',
    decisions TEXT NOT NULL DEFAULT '[]', open_questions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(message_id UNINDEXED, content);
`);
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name);
if (!sessionColumns.includes("librarian_status")) {
  db.exec("ALTER TABLE sessions ADD COLUMN librarian_status TEXT NOT NULL DEFAULT 'pending'");
}
for (const column of ["topics", "decisions", "open_questions"]) {
  if (!sessionColumns.includes(column)) db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT NOT NULL DEFAULT '[]'`);
}

const now = () => new Date().toISOString();
const json = (res, status, value) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
};
const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};
const sendError = (res, status, message) => json(res, status, { error: message });
async function askCopilot(title, content) {
  const prompt = `Ты — библиотекарь учебного архива. Разбери разговор и верни только JSON без markdown.
Формат: {"summary":"краткое резюме","topics":["до 5 коротких тем"],"decisions":["важные решения"],"open_questions":["нерешённые вопросы"]}
Тема: ${title}
Разговор:
${content}`;
  const { stdout } = await execFileAsync(copilotBin, [
    "--prompt", prompt, "--silent", "--output-format", "text",
    "--no-custom-instructions", "--no-auto-update"
  ], { timeout: 120000, maxBuffer: 1024 * 1024 });
  const match = stdout.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Copilot не вернул JSON");
  return JSON.parse(match[0]);
}
async function askCodex(title, content) {
  const prompt = `Ты — библиотекарь учебного архива. Верни только JSON без markdown.
Формат: {"summary":"краткое резюме","topics":["до 5 коротких тем"],"decisions":["важные решения"],"open_questions":["нерешённые вопросы"]}
Тема: ${title}
Материал:
${content}`;
  const { stdout } = await execFileAsync(codexBin, ["exec", "--color", "never", "--skip-git-repo-check", prompt], { timeout: 120000, maxBuffer: 1024 * 1024 });
  const match = stdout.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Codex не вернул JSON");
  return JSON.parse(match[0]);
}
async function askProvider(title, content, config = { provider: "copilot" }) {
  if (config.provider === "none") return { summary: "AI-разбор отключён.", topics: [], decisions: [], open_questions: [] };
  if (config.provider === "copilot") return askCopilot(title, content);
  if (config.provider === "codex") return askCodex(title, content);
  if (!config.apiBase) throw new Error("Адрес AI-провайдера не настроен");
  const prompt = `Ты — библиотекарь учебного архива. Верни только JSON: {"summary":"краткое резюме","topics":[],"decisions":[],"open_questions":[]}\nТема: ${title}\nРазговор:\n${content}`;
  const headers = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  if (config.apiKey) headers.authorization = "Bearer " + config.apiKey;
  const response = await fetch(`${config.apiBase.replace(/\/$/, "")}${config.provider === "ollama" ? "/api/generate" : "/chat/completions"}`, {
    method: "POST", headers,
    body: JSON.stringify(config.provider === "ollama" ? { model: config.apiModel || "llama3.2", prompt, stream: false, format: "json" } : { model: config.apiModel, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`AI API вернул HTTP ${response.status}`);
  const payload = await response.json();
  const text = config.provider === "ollama" ? payload.response : payload.choices?.[0]?.message?.content;
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI-провайдер не вернул JSON");
  return JSON.parse(match[0]);
}
async function askChatProvider(message, context, config = { provider: "copilot" }) {
  if (config.provider === "none") throw new Error("AI-разбор отключён в настройках");
  const prompt = `Ты — AI-библиотекарь внутри Memoryy. Отвечай на русском, помогай работать с библиотекой обучения. Не меняй файлы и не выполняй команды. ${context ? `Контекст библиотеки:\n${context}\n` : ""}\nПользователь: ${message}`;
  if (config.provider === "copilot") {
    const { stdout } = await execFileAsync(copilotBin, ["--prompt", prompt, "--silent", "--output-format", "text", "--no-custom-instructions", "--no-auto-update"], { timeout: 120000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  }
  if (config.provider === "codex") {
    const { stdout } = await execFileAsync(codexBin, ["exec", "--color", "never", "--skip-git-repo-check", prompt], { timeout: 120000, maxBuffer: 1024 * 1024 });
    return stdout.trim();
  }
  if (!config.apiBase) throw new Error("Адрес AI-провайдера не настроен");
  const headers = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  if (config.apiKey) headers.authorization = "Bearer " + config.apiKey;
  const response = await fetch(`${config.apiBase.replace(/\/$/, "")}${config.provider === "ollama" ? "/api/generate" : "/chat/completions"}`, {
    method: "POST", headers,
    body: JSON.stringify(config.provider === "ollama"
      ? { model: config.apiModel || "llama3.2", prompt, stream: false }
      : { model: config.apiModel, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`AI API вернул HTTP ${response.status}`);
  const payload = await response.json();
  return String(config.provider === "ollama" ? payload.response : payload.choices?.[0]?.message?.content || "").trim();
}
async function buildLibraryCompilation(topic, ai) {
  const project = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1").get();
  if (!project) throw new Error("Проект не найден");
  const sessions = db.prepare("SELECT * FROM sessions WHERE source != 'librarian-note' ORDER BY created_at").all();
  const materials = sessions.map((session) => ({
    id: session.id, title: session.title, date: session.created_at, summary: session.summary,
    topics: JSON.parse(session.topics || "[]"),
    messages: db.prepare("SELECT role, content FROM messages WHERE session_id=? ORDER BY created_at").all(session.id)
  }));
  const sourceContext = materials.map((item) => `SOURCE_ID: ${item.id}\nTITLE: ${item.title}\nDATE: ${item.date}\nSUMMARY: ${item.summary}\nTOPICS: ${item.topics.join(", ")}\nCONTENT:\n${item.messages.map((message) => `${message.role}: ${message.content}`).join("\n")}`).join("\n\n---\n\n");
  const prompt = `Ты — библиотекарь Memoryy. Собери учебный материал по теме "${topic}" только из релевантных источников ниже. Не выдумывай факты. Верни структурированный Markdown-конспект на русском с заголовком, кратким объяснением, разделами, связями между идеями и блоком "Источники". В источниках укажи SOURCE_ID каждого использованного материала. Если релевантных материалов нет, честно скажи это.\n\n${sourceContext}`;
  const markdown = await askChatProvider(prompt, "", ai || { provider: "copilot" });
  const sources = materials.filter((item) => markdown.includes(item.id));
  const sourceBlock = sources.length
    ? `\n\n## Источники в библиотеке\n${sources.map((item) => `- [${item.title}](memoryy://session/${item.id}) — ${new Date(item.date).toLocaleDateString("ru-RU")}`).join("\n")}`
    : "";
  const document = `# Конспект: ${topic}\n\n${markdown.replace(/^# .*$/m, "").trim()}${sourceBlock}\n\n---\nСобрано Memoryy · ${new Date().toLocaleString("ru-RU")}`;
  const timestamp = now(), id = randomUUID(), title = `Конспект: ${topic}`;
  db.prepare("INSERT INTO sessions (id,project_id,title,source,summary,librarian_status,topics,decisions,open_questions,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(id, project.id, title, "librarian-note", `Конспект по теме ${topic}`, "processed", JSON.stringify([topic]), "[]", "[]", timestamp);
  const messageId = randomUUID();
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)").run(messageId, id, "librarian", document, timestamp);
  db.prepare("INSERT INTO message_search (message_id,content) VALUES (?,?)").run(messageId, document);
  db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(timestamp, project.id);
  return { id, title, topic, markdown: document, sources: sources.map((item) => ({ id: item.id, title: item.title })) };
}
async function processSession(sessionId, config = { provider: "copilot" }) {
  const session = db.prepare(`
    SELECT s.id, s.title, s.project_id, GROUP_CONCAT(m.role || ': ' || m.content, char(10)) AS content
    FROM sessions s LEFT JOIN messages m ON m.session_id=s.id WHERE s.id=? GROUP BY s.id
  `).get(sessionId);
  if (!session) throw new Error("Сессия не найдена");
  db.prepare("UPDATE sessions SET librarian_status='pending' WHERE id=?").run(sessionId);
  try {
    const result = await askProvider(session.title, session.content || "", config);
    db.prepare("UPDATE sessions SET summary=?, topics=?, decisions=?, open_questions=?, librarian_status='processed' WHERE id=?")
      .run(result.summary || "", JSON.stringify(result.topics || []), JSON.stringify(result.decisions || []), JSON.stringify(result.open_questions || []), sessionId);
  } catch (error) {
    db.prepare("UPDATE sessions SET librarian_status='waiting' WHERE id=?").run(sessionId);
    throw error;
  }
}
const seed = () => {
  if (db.prepare("SELECT COUNT(*) AS count FROM projects").get().count) return;
  const timestamp = now();
  const projectId = randomUUID();
  db.prepare("INSERT INTO projects (id,title,summary,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(projectId, "Моё обучение", "Сохраняй контекст, решения и материалы в одном месте.", timestamp, timestamp);
};
seed();

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && url.pathname === "/api/projects") {
    return json(res, 200, db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all());
  }
  if (req.method === "POST" && url.pathname === "/api/files") {
    return readBody(req).then((body) => {
      const input = JSON.parse(body);
      const name = String(input.name || "file").replace(/[\/\\]/g, "_").trim() || "file";
      const encoded = String(input.data || "");
      const comma = encoded.indexOf(",");
      const raw = comma >= 0 ? encoded.slice(comma + 1) : encoded;
      const buffer = Buffer.from(raw, "base64");
      if (!buffer.length || buffer.length > 20 * 1024 * 1024) return sendError(res, 400, "Файл пустой или больше 20 МБ");
      const id = randomUUID();
      const path = join(filesDir, id);
      writeFileSync(path, buffer);
      db.prepare("INSERT INTO files (id,project_id,name,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, input.projectId, name, input.mime || "application/octet-stream", buffer.length, path, now());
      return json(res, 201, { id, name, mime: input.mime || "application/octet-stream", size: buffer.length });
    }).catch(() => sendError(res, 400, "Не удалось сохранить файл"));
  }
  if (req.method === "GET" && url.pathname === "/api/sessions") {
    const projectId = url.searchParams.get("projectId");
    const sessions = projectId
      ? db.prepare("SELECT * FROM sessions WHERE project_id=? ORDER BY created_at DESC").all(projectId)
      : db.prepare("SELECT * FROM sessions ORDER BY created_at DESC").all();
    return json(res, 200, sessions.map((session) => ({ ...session, topics: JSON.parse(session.topics || "[]") })));
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
    const sessionId = url.pathname.split("/").pop();
    const session = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId);
    if (!session) return sendError(res, 404, "Сессия не найдена");
    session.messages = db.prepare("SELECT role, content, created_at FROM messages WHERE session_id=? ORDER BY created_at").all(sessionId);
    for (const field of ["topics", "decisions", "open_questions"]) session[field] = JSON.parse(session[field] || "[]");
    return json(res, 200, session);
  }
  if (req.method === "GET" && url.pathname === "/api/timeline") {
    const rows = db.prepare(`
      SELECT id, title, 'project' AS type, created_at, summary AS description, '[]' AS topics FROM projects
      UNION ALL SELECT id, title, 'session', created_at, summary, topics FROM sessions
      ORDER BY created_at DESC
    `).all().map((row) => ({ ...row, topics: JSON.parse(row.topics || "[]") }));
    return json(res, 200, rows);
  }
  if (req.method === "GET" && url.pathname === "/api/context") {
    const projectId = url.searchParams.get("projectId");
    const project = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
    if (!project) return sendError(res, 404, "Проект не найден");
    const sessions = db.prepare("SELECT * FROM sessions WHERE project_id=? ORDER BY created_at").all(projectId);
    const lines = [`# Контекст проекта: ${project.title}`, "", project.summary, ""];
    for (const session of sessions) {
      lines.push(`## ${session.title} (${session.created_at})`, session.summary || "", "");
      const messages = db.prepare("SELECT role, content FROM messages WHERE session_id=? ORDER BY created_at").all(session.id);
      for (const message of messages) lines.push(`**${message.role}:** ${message.content}`, "");
    }
    return json(res, 200, { markdown: lines.join("\n").trim() });
  }
  if (req.method === "POST" && url.pathname === "/api/library/compile") {
    return readBody(req).then(async (body) => {
      const input = JSON.parse(body);
      const topic = String(input.topic || "").trim();
      if (!topic) return sendError(res, 400, "Укажи тему для сборки");
      return json(res, 200, await buildLibraryCompilation(topic, input.ai));
    }).catch((error) => sendError(res, 502, `Не удалось собрать материал: ${error.message}`));
  }
  if (req.method === "GET" && url.pathname === "/api/export") {
    const project = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1").get();
    const sessions = db.prepare("SELECT * FROM sessions ORDER BY created_at").all();
    const exportData = {
      format: "memoryy-export",
      version: 1,
      exported_at: now(),
      project,
      sessions: sessions.map((session) => ({
        ...session,
        topics: JSON.parse(session.topics || "[]"),
        decisions: JSON.parse(session.decisions || "[]"),
        open_questions: JSON.parse(session.open_questions || "[]"),
        messages: db.prepare("SELECT role, content, created_at FROM messages WHERE session_id=? ORDER BY created_at").all(session.id)
      }))
    };
    const body = JSON.stringify(exportData, null, 2);
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="memoryy-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "content-length": Buffer.byteLength(body)
    });
    return res.end(body);
  }
  if (req.method === "GET" && url.pathname === "/api/librarian/status") {
    const provider = url.searchParams.get("provider") || "copilot";
    const bin = provider === "codex" ? codexBin : copilotBin;
    const args = provider === "codex" ? ["--version"] : ["--version", "--no-auto-update"];
    return execFileAsync(bin, args, { timeout: 5000 })
      .then(({ stdout }) => json(res, 200, { installed: true, version: stdout.trim(), path: bin, provider }))
      .catch((error) => json(res, 200, { installed: false, error: error.code === "ENOENT" ? "CLI не найден" : "CLI не авторизован или недоступен", path: bin, provider }));
  }
  if (req.method === "POST" && url.pathname === "/api/librarian/login") {
    return readBody(req).then((body) => {
      const provider = JSON.parse(body.toString() || "{}").provider;
      if (provider !== "codex") return sendError(res, 400, "Неизвестный AI-провайдер");
      const child = spawn(codexBin, ["login"], { detached: true, stdio: "ignore" });
      child.once("error", () => {});
      child.unref();
      return json(res, 202, { started: true });
    }).catch(() => sendError(res, 400, "Некорректный запрос авторизации"));
  }
  if (req.method === "POST" && (url.pathname === "/api/ai/chat" || url.pathname === "/api/copilot/chat")) {
    return readBody(req).then(async (body) => {
      const input = JSON.parse(body);
      if (!input.message?.trim()) return sendError(res, 400, "Сообщение не может быть пустым");
      const context = input.includeContext ? (await new Promise((resolveContext, reject) => {
        const project = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1").get();
        if (!project) return resolveContext("");
        const sessions = db.prepare("SELECT title, summary FROM sessions ORDER BY created_at DESC LIMIT 20").all();
        resolveContext(`# Проект: ${project.title}\n${project.summary}\n\n${sessions.map((item) => `## ${item.title}\n${item.summary}`).join("\n\n")}`);
      })) : "";
      const compilationMatch = input.message.trim().match(/(?:собери|сделай|создай|подготовь)\s+(?:мне\s+)?(?:конспект|контекст)(?:\s+по\s+теме)?\s+(.+)/i);
      if (compilationMatch) {
        const artifact = await buildLibraryCompilation(compilationMatch[1].replace(/[.!?]+$/, "").trim(), input.ai);
        return json(res, 200, {
          answer: `Готово. Конспект сохранён в библиотеке: [${artifact.title}](memoryy://note/${artifact.id})`,
          artifact: { id: artifact.id, title: artifact.title }
        });
      }
      const answer = await askChatProvider(input.message.trim(), context, input.ai || { provider: "copilot" });
      return json(res, 200, { answer });
    }).catch((error) => sendError(res, 502, `AI-провайдер недоступен: ${error.message}`));
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/process")) {
    const sessionId = url.pathname.split("/")[3];
    return processSession(sessionId, JSON.parse(req.headers["x-memoryy-ai"] || '{"provider":"copilot"}'))
      .then(() => json(res, 202, { status: "processed" }))
      .catch((error) => sendError(res, 502, `Copilot не смог разобрать разговор: ${error.message}`));
  }
  if (req.method === "POST" && url.pathname === "/api/projects") {
    return readBody(req).then((body) => {
      const input = JSON.parse(body);
      if (!input.title?.trim()) return sendError(res, 400, "Название проекта обязательно");
      const timestamp = now(), id = randomUUID();
      db.prepare("INSERT INTO projects (id,title,summary,created_at,updated_at) VALUES (?,?,?,?,?)")
        .run(id, input.title.trim(), input.summary?.trim() || "", timestamp, timestamp);
      return json(res, 201, { id });
    }).catch(() => sendError(res, 400, "Некорректный JSON"));
  }
  if (req.method === "POST" && url.pathname === "/api/sessions") {
    return readBody(req).then((body) => {
      const input = JSON.parse(body);
      if (!input.projectId || !input.title?.trim()) return sendError(res, 400, "Проект и название сессии обязательны");
      if (!db.prepare("SELECT id FROM projects WHERE id=?").get(input.projectId)) return sendError(res, 404, "Проект не найден");
      const timestamp = now(), id = randomUUID();
      db.prepare("INSERT INTO sessions (id,project_id,title,source,summary,librarian_status,topics,decisions,open_questions,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, input.projectId, input.title.trim(), input.source || "manual", input.summary?.trim() || "", "pending", "[]", "[]", "[]", timestamp);
      let fullContent = "";
      for (const message of input.messages || []) {
        if (!message.content?.trim()) continue;
        fullContent += `${message.role || "user"}: ${message.content.trim()}\n`;
        const messageId = randomUUID();
        db.prepare("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,?,?,?)")
          .run(messageId, id, message.role || "user", message.content.trim(), timestamp);
        db.prepare("INSERT INTO message_search (message_id,content) VALUES (?,?)").run(messageId, message.content.trim());
      }
      db.prepare("UPDATE projects SET updated_at=? WHERE id=?").run(timestamp, input.projectId);
      processSession(id, input.ai || { provider: "copilot" }).catch((error) => {
        console.warn(`Copilot librarian unavailable: ${error.message}`);
      });
      return json(res, 201, { id });
    }).catch(() => sendError(res, 400, "Некорректный JSON"));
  }
  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = url.searchParams.get("q")?.trim();
    if (!query) return json(res, 200, []);
    return json(res, 200, db.prepare(`
      SELECT m.id, m.role, m.content, m.created_at, s.title AS session_title
      FROM message_search f JOIN messages m ON m.id=f.message_id JOIN sessions s ON s.id=m.session_id
      WHERE message_search MATCH ? ORDER BY m.created_at DESC LIMIT 50
    `).all(query.replaceAll('"', '')));
  }
  return serveStatic(url.pathname, res);
}

function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(root, "public", requested));
  if (!file.startsWith(join(root, "public")) || !existsSync(file) || !statSync(file).isFile()) return sendError(res, 404, "Не найдено");
  const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }[extname(file)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  try { route(req, res); } catch (error) { console.error(error); sendError(res, 500, "Внутренняя ошибка сервера"); }
});
server.listen(Number(process.env.PORT || 4173), "127.0.0.1", () => {
  console.log(`Memoryy is running at http://127.0.0.1:${process.env.PORT || 4173}`);
});
