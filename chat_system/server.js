const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const {
  COORDINATOR_SYSTEM_PROMPT,
  SQL_MINI_PROMPT,
  SQL_DIRECT_PROMPT,
  ANALYST_SYSTEM_PROMPT,
  QUICK_PROMPTS,
  DANGEROUS_KEYWORDS,
} = require('./config');

const SCENARIO_PLAYBOOK = require('./scenario_playbook.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const OLLAMA_CHAT_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate')
  .replace('/api/generate', '/api/chat');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '30000');

const GROQ_KEYS = (process.env.GROQ_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT = parseInt(process.env.GROQ_TIMEOUT || '15000');
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
let groqKeyIndex = 0;
const deadGroqKeys = new Set();

const RAG_URL   = 'http://127.0.0.1:5002';
const GRAPH_URL = 'http://127.0.0.1:5003';

function getNextGroqKey() {
  if (GROQ_KEYS.length === 0) throw new Error('No Groq keys configured');
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const key = GROQ_KEYS[groqKeyIndex];
    groqKeyIndex = (groqKeyIndex + 1) % GROQ_KEYS.length;
    if (!deadGroqKeys.has(key)) return key;
  }
  throw new Error('All Groq keys exhausted');
}

async function callGroq(systemPrompt, userContent, { maxTokens = 512, temperature = 0.1, history = [] } = {}) {
  const key = getNextGroqKey();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ];
  try {
    const res = await axios.post(
      GROQ_URL,
      { model: GROQ_MODEL, messages, max_tokens: maxTokens, temperature, stream: false },
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: GROQ_TIMEOUT }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      console.warn(`[GROQ/dead] key ...${key.slice(-8)} status:${status}`);
      deadGroqKeys.add(key);
    }
    throw err;
  }
}

function getBangkokTime() {
  return new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

async function callOllama(systemPrompt, userContent, { maxTokens = 512, temperature = 0.1, history = [] } = {}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userContent },
  ];
  const res = await axios.post(
    OLLAMA_CHAT_URL,
    {
      model: OLLAMA_MODEL,
      stream: false,
      messages,
      options: { num_predict: maxTokens, temperature },
    },
    { timeout: OLLAMA_TIMEOUT }
  );
  return res.data.message.content.trim();
}

// Protocol keywords → graph protocol name
const PROTO_KEYWORDS = {
  snmp: 'snmp', ospf: 'ospf', bgp: 'bgp', eigrp: 'eigrp', rip: 'rip',
  mpls: 'mpls', arp: 'arp', stp: 'stp', vlan: 'vlan', lldp: 'lldp',
  cdp: 'lldp', lacp: 'lacp', dns: 'dns', dhcp: 'dhcp', ntp: 'ntp',
  acl: 'acl', firewall: 'firewall', vpn: 'vpn', nat: 'nat',
  wifi: 'wifi_ap', wireless: 'wifi_ap', netflow: 'netflow',
  vrrp: 'hsrp_vrrp', hsrp: 'hsrp_vrrp', bfd: 'bfd',
};

async function callGraph(device = null, protocol = null) {
  try {
    if (device && protocol) {
      const res = await axios.get(`${GRAPH_URL}/graph/${encodeURIComponent(device)}/${protocol}`, { timeout: 2000 });
      return res.data;
    }
    if (device) {
      const res = await axios.get(`${GRAPH_URL}/graph/${encodeURIComponent(device)}`, { timeout: 2000 });
      return res.data;
    }
    const res = await axios.get(`${GRAPH_URL}/graph/summary/all`, { timeout: 2000 });
    return res.data;
  } catch { return null; }
}

function detectProtocol(msg) {
  const lower = msg.toLowerCase();
  for (const [kw, proto] of Object.entries(PROTO_KEYWORDS)) {
    if (lower.includes(kw)) return proto;
  }
  return null;
}

async function callRAG(question, nResults = 4) {
  try {
    const res = await axios.post(`${RAG_URL}/query`, { question, n_results: nResults }, { timeout: 5000 });
    return res.data.context || [];
  } catch {
    return [];
  }
}

function isSafeSQL(sql) {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT')) return false;
  for (const pattern of DANGEROUS_KEYWORDS) {
    if (pattern.test(sql)) return false;
  }
  return true;
}

const rateMap = new Map();
function checkRate(ip, limitPerMin = 20) {
  const now = Date.now();
  const window = 60 * 1000;
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) {
    rateMap.set(ip, { count: 1, start: now });
    return true;
  }
  if (entry.count >= limitPerMin) return false;
  entry.count++;
  rateMap.set(ip, entry);
  return true;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY_PAIRS = 8;
const sessions = new Map();

function getSession(id) {
  if (!id) return null;
  const now = Date.now();
  const s = sessions.get(id);
  if (s) {
    if (now - s.lastSeen > SESSION_TTL_MS) {
      sessions.delete(id);
      return initSession(id, now);
    }
    s.lastSeen = now;
    return s;
  }
  return initSession(id, now);
}

function initSession(id, now) {
  const s = { history: [], lastSeen: now };
  sessions.set(id, s);
  return s;
}

function pushHistory(session, userMsg, assistantReply) {
  if (!session) return;
  session.history.push({ role: 'user', content: userMsg });
  session.history.push({ role: 'assistant', content: assistantReply });
  if (session.history.length > MAX_HISTORY_PAIRS * 2) {
    session.history = session.history.slice(-(MAX_HISTORY_PAIRS * 2));
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ quickPrompts: QUICK_PROMPTS });
});

app.post('/api/chat', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;

  if (!checkRate(ip)) {
    return res.status(429).json({ reply: 'ส่งคำถามถี่เกินไป กรุณารอสักครู่', status: 'rate_limited' });
  }

  const userMsg = String(req.body.message || '').trim().slice(0, 500);
  const sessionId = String(req.body.sessionId || '').trim().slice(0, 64) || null;

  if (!userMsg) {
    return res.status(400).json({ reply: 'กรุณาส่งคำถาม', status: 'error' });
  }

  const session = getSession(sessionId);
  const history = session ? session.history : [];
  const shortHistory = history.slice(-4);

  try {
    const bangkokNow = getBangkokTime();

    // Step 0: Graph routing — ถามเรื่อง topology / มี protocol มั้ย
    const graphKeywords = /topology|โทโพโลยี|มีอะไรบ้าง|protocol.*มั้ย|มี.*protocol/i;
    const detectedProto = detectProtocol(userMsg);
    const hasExistsQ = /มีระบบ|มี.*ใช้งานอยู่|ติดตั้ง.*ไว้|รองรับ|support|available|exist/i.test(userMsg);

    if (graphKeywords.test(userMsg) && !detectedProto) {
      const graphData = await callGraph();
      if (graphData && graphData.devices) {
        const lines = [`📡 **Network Topology** (อัพเดต: ${graphData.last_updated ? graphData.last_updated.slice(0,19) : 'N/A'})\n`];
        for (const [dev, data] of Object.entries(graphData.devices)) {
          const active   = data.active || [];
          const noData   = data.no_data || [];
          lines.push(`**${dev}**`);
          lines.push(`  ✅ มีข้อมูล: ${active.join(', ') || '-'}`);
          lines.push(`  ⚠️  ไม่มีข้อมูล: ${noData.join(', ') || '-'}\n`);
        }
        const reply = lines.join('\n');
        pushHistory(session, userMsg, reply);
        return res.json({ reply, rows: 0, status: 'ok', source: 'graph' });
      }
    }

    if (detectedProto && hasExistsQ) {
      const graphData = await callGraph();
      if (graphData && graphData.devices) {
        const lines = [];
        for (const [dev, data] of Object.entries(graphData.devices)) {
          const all = { ...((graphData.devices[dev] || {}).protocols || {}) };
          // หา protocol ที่ถามจาก summary
          const active   = (data.active || []).includes(detectedProto);
          const noData   = (data.no_data || []).includes(detectedProto);
          const noTable  = (data.no_table || []).includes(detectedProto);
          const icon = active ? '✅' : noData ? '⚠️' : '❌';
          const statusTh = active ? 'มีข้อมูล' : noData ? 'มี table แต่ไม่มีข้อมูล' : 'ยังไม่มี table ในระบบ';
          lines.push(`${icon} **${dev}**: ${detectedProto.toUpperCase()} — ${statusTh}`);
        }
        const reply = lines.join('\n');
        pushHistory(session, userMsg, reply);
        return res.json({ reply, rows: 0, status: 'ok', source: 'graph' });
      }
    }

    // Step 1: Keyword routing — ตรวจก่อนว่าเป็น knowledge question (ไม่ต้องใช้ LLM)
    const t1 = Date.now();
    const knowledgeKeywords = /คืออะไร|หมายถึง|อธิบาย|ทำงานยังไง|ทำงานอย่างไร|คืออะ| คือ|^คือ|explain|what is|define|how does|how do/i;
    const isKnowledgeQuestion = knowledgeKeywords.test(userMsg) && !/ระบบ|ใน db|ใน database|ตอนนี้|ล่าสุด|แสดง|เช็ค|status|สถานะ/.test(userMsg);

    if (isKnowledgeQuestion) {
      console.log(`[KNOWLEDGE/kw] IP:${ip} Q:"${userMsg.slice(0, 60)}"`);
      const kRes = await axios.post(
        OLLAMA_CHAT_URL,
        { model: 'qwen2.5:1.5b', stream: false, messages: [
            { role: 'system', content: 'คุณคือ Network Engineer ผู้เชี่ยวชาญ ตอบเป็นภาษาไทย กระชับ ชัดเจน ไม่เกิน 5 ประโยค' },
            { role: 'user', content: userMsg }
          ], options: { num_predict: 200, temperature: 0.3 }
        },
        { timeout: OLLAMA_TIMEOUT }
      );
      const kAnswer = kRes.data.message.content.trim();
      pushHistory(session, userMsg, kAnswer);
      return res.json({ reply: kAnswer, rows: 0, status: 'ok', source: 'knowledge' });
    }

    // Hybrid routing: "X ในระบบ / สถานะ" → ค้น syslog โดยตรง ไม่ผ่าน coordinator
    const hybridMatch = userMsg.match(/([A-Za-z0-9\-]+)\s*(ในระบบ|ระบบ|สถานะ|status|ปกติมั้ย|มีไหม|เช็ค)/i);
    if (hybridMatch) {
      const keyword = hybridMatch[1].toUpperCase();
      console.log(`[HYBRID/kw] IP:${ip} keyword:"${keyword}"`);
      const ragContext2 = await callRAG(userMsg);
      const ragText2 = ragContext2.length > 0 ? '\n\n[Network Knowledge]\n' + ragContext2.slice(0,2).map(d=>d.slice(0,300)).join('\n---\n') : '';
      let hybridRows = [];
      try {
        const hRes = await pool.query(
          `SELECT time, source, severity_code, message FROM syslog WHERE message IS NOT NULL AND message ILIKE $1 ORDER BY time DESC LIMIT 10`,
          [`%${keyword}%`]
        );
        hybridRows = hRes.rows;
      } catch(e) { /* ignore */ }

      const noDbNote = hybridRows.length === 0
        ? `\n⚠️ ไม่พบข้อมูล ${keyword} ใน database ระบบปัจจุบัน`
        : `\nพบ ${hybridRows.length} รายการใน syslog`;
      const hybridPrompt = `คุณคือ Network Engineer ผู้เชี่ยวชาญ${noDbNote}\nให้: 1) บอกว่าพบหรือไม่พบใน DB 2) อธิบาย ${keyword} จาก Network Knowledge ที่ให้มา 3) แนะนำการตรวจสอบ\nตอบเป็นภาษาไทย กระชับ`;
      const hLLM = await axios.post(
        OLLAMA_CHAT_URL,
        { model: 'qwen2.5:1.5b', stream: false, messages: [
            { role: 'system', content: hybridPrompt + ragText2 },
            { role: 'user', content: userMsg + (hybridRows.length > 0 ? `\n\nข้อมูล syslog: ${JSON.stringify(hybridRows)}` : '') }
          ], options: { num_predict: 250, temperature: 0.3 }
        },
        { timeout: OLLAMA_TIMEOUT }
      );
      const hybridAnswer = hLLM.data.message.content.trim();
      pushHistory(session, userMsg, hybridAnswer);
      return res.json({ reply: hybridAnswer, rows: hybridRows.length, status: 'ok', source: hybridRows.length > 0 ? 'db+knowledge' : 'knowledge' });
    }

    // Step 1.5: SQL Template matching — คำถาม common ใช้ SQL สำเร็จรูป ไม่ผ่าน Qwen
    const SQL_TEMPLATES = [
      { pattern: /vlan.*interface|interface.*vlan/i,
        sql: `SELECT DISTINCT ON (hostname,"ifName") hostname,"ifName","ifAlias","ifOperStatus","ifHighSpeed" FROM interface WHERE "ifName" ILIKE '%vlan%' ORDER BY hostname,"ifName",time DESC LIMIT 30` },
      { pattern: /uptime.*เปรียบ|เปรียบ.*uptime|compare.*uptime/i,
        sql: `SELECT DISTINCT ON (hostname) hostname, round((uptime/100.0/86400.0)::numeric,2) AS uptime_days, time FROM snmp ORDER BY hostname,time DESC LIMIT 10` },
      { pattern: /high.?cpu.*anomaly|anomaly.*high.?cpu|cpu.*anomaly.*สูง/i,
        sql: `SELECT hostname,scenario_name,cpu_5s,round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb,time FROM ml_isolation_forest WHERE scenario_name ILIKE '%cpu%' ORDER BY time DESC LIMIT 20` },
      { pattern: /traffic.*anomaly.*ล่าสุด|anomaly.*traffic.*ล่าสุด/i,
        sql: `SELECT hostname,round((in_bps/1024.0)::numeric,1) AS in_kbps,round((out_bps/1024.0)::numeric,1) AS out_kbps,scenario_name,time FROM ml_isolation_forest WHERE (in_bps > 0 OR out_bps > 0) ORDER BY time DESC LIMIT 10` },
      { pattern: /arima.*traffic.*out|arima.*out_bps/i,
        sql: `SELECT hostname,feature_name,actual,predicted,threshold,anomaly,time FROM ml_arima WHERE feature='out_bps' ORDER BY time DESC LIMIT 10` },
      { pattern: /arima.*traffic.*in|arima.*in_bps/i,
        sql: `SELECT hostname,feature_name,actual,predicted,threshold,anomaly,time FROM ml_arima WHERE feature='in_bps' ORDER BY time DESC LIMIT 10` },
      { pattern: /login.*ผิดปกติ|brute.?force|failed.*login|login.*fail/i,
        sql: `SELECT source, COUNT(*) AS total, SUM(CASE WHEN message ILIKE '%fail%' OR message ILIKE '%invalid%' OR message ILIKE '%denied%' THEN 1 ELSE 0 END) AS failed_count, SUM(CASE WHEN message ILIKE '%accept%' OR message ILIKE '%success%' THEN 1 ELSE 0 END) AS success_count, MIN(time) AS first_seen, MAX(time) AS last_seen FROM syslog WHERE source IS NOT NULL GROUP BY source HAVING COUNT(*) > 5 ORDER BY failed_count DESC LIMIT 10` },
      { pattern: /cpu.*ล่าสุด|ล่าสุด.*cpu|latest.*cpu/i,
        sql: `SELECT DISTINCT ON (hostname) hostname,cpu_5s,time FROM snmp ORDER BY hostname,time DESC LIMIT 10` },
      { pattern: /memory.*ล่าสุด|mem.*ล่าสุด|ram.*ล่าสุด/i,
        sql: `SELECT DISTINCT ON (hostname) hostname,round((mem_used/1024.0/1024.0)::numeric,1) AS mem_used_mb,round((mem_free/1024.0/1024.0)::numeric,1) AS mem_free_mb,time FROM snmp ORDER BY hostname,time DESC LIMIT 10` },
      { pattern: /interface.*สถานะ|สถานะ.*interface|interface.*status/i,
        sql: `SELECT DISTINCT ON (hostname,"ifName") hostname,"ifName","ifAlias","ifOperStatus","ifHighSpeed",time FROM interface ORDER BY hostname,"ifName",time DESC LIMIT 30` },
      { pattern: /anomaly.*ล่าสุด|ล่าสุด.*anomaly/i,
        sql: `SELECT DISTINCT ON (hostname) hostname,scenario_name,cpu_5s,round((mem_used/1024.0/1024.0)::numeric,1) AS mem_mb,time FROM ml_isolation_forest ORDER BY hostname,time DESC LIMIT 10` },
    ];

    const matchedTemplate = SQL_TEMPLATES.find(t => t.pattern.test(userMsg));
    if (matchedTemplate) {
      console.log(`[SQL-TEMPLATE] IP:${ip} Q:"${userMsg.slice(0,50)}"`);
      try {
        const dbRes2 = await pool.query(matchedTemplate.sql);
        const ragContext2 = await callRAG(userMsg);
        const ragText2 = ragContext2.length > 0 ? '\n\n[Network Knowledge]\n' + ragContext2.slice(0,2).map(d=>d.slice(0,200)).join('\n---\n') : '';
        const formattedRows2 = dbRes2.rows.map((row,i) => {
          const parts = Object.entries(row).map(([k,v]) => `${k}: ${fmtVal(k,v)}`);
          return `[${i+1}] ${parts.join(' | ')}`;
        }).join('\n');
        const codeConc2 = codeConclusion(dbRes2.rows);
        const ansRes2 = await axios.post(OLLAMA_CHAT_URL, {
          model: 'qwen2.5:1.5b', stream: false,
          messages: [
            { role: 'system', content: `คุณคือ Network Analyst สรุปข้อมูลจาก DB เป็นภาษาไทย กระชับ ห้ามพูดว่า "row 1,2" ให้ใช้ชื่ออุปกรณ์/IP` },
            { role: 'user', content: `ข้อมูล:\n${formattedRows2}${codeConc2}${ragText2}\n\nคำถาม: ${userMsg}` }
          ], options: { num_predict: 250, temperature: 0.1 }
        }, { timeout: OLLAMA_TIMEOUT });
        const reply2 = ansRes2.data.message.content.trim();
        pushHistory(session, userMsg, reply2);
        return res.json({ reply: reply2, rows: dbRes2.rows.length, status: 'ok', source: 'db+template' });
      } catch(e) { console.error('[TEMPLATE ERROR]', e.message); }
    }

    // Step 2: RAG context
    const ragContext = await callRAG(userMsg);
    const ragText = ragContext.length > 0
      ? '\n\n[Network Knowledge]\n' + ragContext.join('\n---\n')
      : '';

    // Step 2b: Thai → SQL โดยตรง พร้อม conversation context ถ้ามี
    const t2 = Date.now();
    const contextPrefix = shortHistory.length > 0
      ? 'Previous conversation:\n' + shortHistory.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 150)}`).join('\n') + '\n\nCurrent question: '
      : '';
    const sqlRes = await axios.post(
      OLLAMA_CHAT_URL,
      { model: 'qwen2.5:1.5b', stream: false,
        messages: [{ role: 'system', content: SQL_DIRECT_PROMPT }, { role: 'user', content: contextPrefix + userMsg }],
        options: { num_predict: 200, temperature: 0.05 }
      },
      { timeout: OLLAMA_TIMEOUT }
    );
    const sqlRaw = sqlRes.data.message.content.trim();
    const sqlMs = Date.now() - t2;
    console.log(`[SQL-DIRECT/${sqlMs}ms] IP:${ip} Q:"${userMsg.slice(0, 50)}"`);

    const _rawSQL = sqlRaw.replace(/```sql\s*/gi, '').replace(/```/g, '').trim();
    const _stripped = _rawSQL.replace(/^(A:|Answer:|SQL:|Query:)\s*/i, '').trim();
    const _selectPos = _stripped.search(/\bSELECT\b/i);
    const _sql = _selectPos > 0 ? _stripped.slice(_selectPos) : _stripped;
    const cleanSQL = _sql.replace(/\bAS\s+'([^']+)'/gi, (_, alias) => {
      const safe = alias.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col';
      return 'AS ' + safe;
    });

    if (cleanSQL.includes('UNSAFE_REQUEST')) {
      console.warn(`[BLOCKED/sql] IP:${ip} Q:"${userMsg.slice(0, 60)}"`);
      return res.json({ reply: 'ไม่พบข้อมูลที่เกี่ยวข้องในระบบ หรือคำถามนี้อยู่นอกขอบเขตข้อมูล network ที่มีใน DB', status: 'blocked' });
    }

    if (!isSafeSQL(cleanSQL)) {
      console.warn(`[BLOCKED/unsafe] IP:${ip} SQL:${cleanSQL.slice(0, 100)}`);
      // คำถามทั่วไปเกี่ยวกับ network → ตอบด้วย RAG อย่างเดียว
      if (ragContext.length > 0) {
        const ragAnswer = await callOllama(
          `[เวลาปัจจุบัน Bangkok UTC+7: ${bangkokNow}]\n${ANALYST_SYSTEM_PROMPT}${ragText}`,
          `คำถาม: ${userMsg}`,
          { maxTokens: 600, temperature: 0.3, history: shortHistory }
        );
        pushHistory(session, userMsg, ragAnswer);
        return res.json({ reply: ragAnswer, rows: 0, status: 'ok', source: 'rag' });
      }
      return res.json({ reply: 'ไม่พบข้อมูลที่เกี่ยวข้องในระบบ หรือคำถามนี้อยู่นอกขอบเขตข้อมูล network ที่มีใน DB', status: 'blocked' });
    }

    console.log(`[SQL/${sqlMs}ms] IP:${ip} Q:"${userMsg.slice(0, 50)}" SQL:${cleanSQL.slice(0, 80)}...`);

    // Step 2b: Query edgedb
    const dbRes = await pool.query(cleanSQL);

    if (dbRes.rows.length === 0) {
      // DB ว่าง → ตอบด้วย RAG ถ้ามี พร้อมแจ้งว่าไม่พบใน DB
      if (ragContext.length > 0) {
        const noDbPrompt = `คุณคือ Network Engineer ผู้เชี่ยวชาญ\n⚠️ ไม่พบข้อมูลนี้ใน database ระบบปัจจุบัน\nให้ตอบโดย: 1) แจ้งว่าไม่พบข้อมูลนี้ใน DB 2) อธิบาย concept จาก Network Knowledge ที่ให้มา 3) แนะนำว่าควรตรวจสอบอะไรเพิ่มเติม\nตอบเป็นภาษาไทย กระชับ`;
        const ragAnswer = await callOllama(
          `[เวลาปัจจุบัน Bangkok UTC+7: ${bangkokNow}]\n${noDbPrompt}${ragText}`,
          `คำถาม: ${userMsg}`,
          { maxTokens: 600, temperature: 0.3, history: shortHistory }
        );
        pushHistory(session, userMsg, ragAnswer);
        return res.json({ reply: ragAnswer, rows: 0, status: 'ok', source: 'rag' });
      }
      return res.json({ reply: 'ไม่พบข้อมูลที่เกี่ยวข้องใน DB สำหรับคำถามนี้', rows: 0, status: 'ok' });
    }

    // Fast-path: time query
    if (dbRes.rows.length === 1 && dbRes.rows[0].current_time !== undefined) {
      const t = new Date(dbRes.rows[0].current_time);
      const timeStr = t.toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      return res.json({ reply: `ตอนนี้เวลา ${timeStr} (UTC+7)`, rows: 1, status: 'ok' });
    }

    // Step 3: Pre-format data + Ollama วิเคราะห์
    const ANS_ROW_CAP = 20;
    const analystRows = dbRes.rows.length > ANS_ROW_CAP
      ? dbRes.rows.slice(0, ANS_ROW_CAP)
      : dbRes.rows;
    const rowNote = dbRes.rows.length > ANS_ROW_CAP
      ? ` (แสดง ${ANS_ROW_CAP} จาก ${dbRes.rows.length} รายการ)`
      : '';

    const scenariosInRows = [...new Set(
      analystRows.map(r => r.scenario_name).filter(s => s && SCENARIO_PLAYBOOK[s])
    )];
    const playbookContext = scenariosInRows.length > 0
      ? '\n\n[Scenario Guide]\n' + scenariosInRows.map(s => {
          const p = SCENARIO_PLAYBOOK[s];
          return `${s}: ${p.title} — ${p.description} | คำแนะนำ: ${p.advice}`;
        }).join('\n')
      : '';

    // Pre-format rows เป็น text ที่อ่านง่าย แทน raw JSON
    function fmtTime(v) {
      if (!v) return '-';
      const d = new Date(v);
      return d.toLocaleString('th-TH', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
    }
    function fmtVal(k, v) {
      if (v === null || v === undefined) return '-';
      if (k.match(/time|seen|created|updated/i)) return fmtTime(v);
      if (k.match(/bytes|octet/i) && typeof v === 'number') return (v/1048576).toFixed(2)+'MB';
      if (k.match(/cpu_5s/i)) return v+'%';
      return String(v);
    }
    const formattedRows = analystRows.map((row, i) => {
      const parts = Object.entries(row).map(([k, v]) => `${k}: ${fmtVal(k, v)}`);
      return `[${i+1}] ${parts.join(' | ')}`;
    }).join('\n');

    // Code-based pre-analysis: สรุปข้อมูลเองก่อน แล้วให้ Ollama แค่อธิบายเพิ่ม
    function codeAnalyze(rows) {
      if (!rows || rows.length === 0) return null;
      const lines = [];
      rows.forEach((row) => {
        const id = row.hostname || row.source || row.host || row.name || `record`;
        const parts = [];
        // timestamp
        const t = row.time || row.last_seen || row.first_seen;
        const t2 = row.last_seen || row.time;
        if (t && t2 && t !== t2) parts.push(`ช่วง ${fmtTime(t)} ถึง ${fmtTime(t2)}`);
        else if (t) parts.push(`เวลา ${fmtTime(t)}`);
        // numeric values
        Object.entries(row).forEach(([k, v]) => {
          if (k.match(/time|seen|created|host|source|name|id/i)) return;
          if (typeof v === 'number' && v > 0) {
            const label = k.replace(/_/g,' ');
            const val = k.match(/bytes|octet/i) ? (v/1048576).toFixed(2)+'MB' : k.match(/cpu/i) ? v+'%' : String(v);
            parts.push(`${label}: ${val}`);
          }
        });
        // string values (short)
        Object.entries(row).forEach(([k, v]) => {
          if (k.match(/time|seen|created|host|source|name|id/i)) return;
          if (typeof v === 'string' && v.length < 50) parts.push(`${k}: ${v}`);
        });
        if (parts.length > 0) lines.push(`• **${id}**: ${parts.join(', ')}`);
      });
      return lines.join('\n');
    }

    const codeSummary = codeAnalyze(analystRows);

    // Code conclusion — วิเคราะห์ตัวเลขสำคัญก่อนส่ง Ollama
    function codeConclusion(rows) {
      const alerts = [];
      rows.forEach(row => {
        const id = row.hostname || row.source || row.host || 'unknown';
        if ((row.failed_count || row.fail_count || 0) > 10)
          alerts.push(`⚠️ ${id} มีการ login ผิดพลาด ${row.failed_count || row.fail_count} ครั้ง — น่าสงสัย`);
        if ((row.cpu_5s || 0) > 80)
          alerts.push(`⚠️ ${id} CPU สูงถึง ${row.cpu_5s}%`);
        if ((row.anomaly_count || 0) > 0)
          alerts.push(`⚠️ ${id} พบ anomaly ${row.anomaly_count} รายการ`);
      });
      return alerts.length > 0
        ? `\n[การวิเคราะห์เบื้องต้น]\n${alerts.join('\n')}`
        : `\n[การวิเคราะห์เบื้องต้น] ไม่พบค่าผิดปกติในข้อมูล`;
    }

    const codeConc = codeConclusion(analystRows);
    const t3 = Date.now();
    const shortAnalystPrompt = `คุณคือ Network Analyst อธิบายข้อมูลที่ให้มาเป็นภาษาไทย กระชับ
ข้อมูลและการวิเคราะห์เบื้องต้นถูกเตรียมไว้ให้แล้ว ใช้ข้อมูลที่มีตามจริง ห้ามขัดแย้งกับการวิเคราะห์เบื้องต้น`;
    const dataForOllama = (codeSummary || formattedRows) + codeConc;
    const ansRes = await axios.post(
      OLLAMA_CHAT_URL,
      { model: 'qwen2.5:1.5b', stream: false,
        messages: [
          { role: 'system', content: shortAnalystPrompt },
          { role: 'user', content: `ข้อมูล:\n${dataForOllama}${playbookContext}\n\nคำถาม: ${userMsg}` }
        ],
        options: { num_predict: 250, temperature: 0.1 }
      },
      { timeout: OLLAMA_TIMEOUT }
    );
    const answer = ansRes.data.message.content.trim();
    const ansMs = Date.now() - t3;

    console.log(`[ANS/${ansMs}ms] rows:${dbRes.rows.length} rag:${ragContext.length}`);

    pushHistory(session, userMsg, answer);

    res.json({ reply: answer, rows: dbRes.rows.length, status: 'ok', source: 'db+rag' });

  } catch (err) {
    console.error('[ERROR]', err.message);
    // Fallback: ลอง knowledge path แทน
    try {
      const fbRes = await axios.post(
        OLLAMA_CHAT_URL,
        { model: 'qwen2.5:1.5b', stream: false, messages: [
            { role: 'system', content: 'คุณคือ Network Engineer ผู้เชี่ยวชาญ ตอบเป็นภาษาไทย กระชับ ชัดเจน ไม่เกิน 5 ประโยค' },
            { role: 'user', content: userMsg }
          ], options: { num_predict: 200, temperature: 0.3 }
        },
        { timeout: OLLAMA_TIMEOUT }
      );
      return res.json({ reply: fbRes.data.message.content.trim(), rows: 0, status: 'ok', source: 'knowledge-fallback' });
    } catch {
      res.status(500).json({ reply: '⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง', status: 'error' });
    }
  }
});

// ── Chat Streaming endpoint (SSE) ─────────────────────────────────────────────
app.post('/api/chat/stream', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRate(ip)) {
    res.status(429).end();
    return;
  }

  const userMsg = String(req.body.message || '').trim().slice(0, 500);
  const sessionId = String(req.body.sessionId || '').trim().slice(0, 64) || null;
  if (!userMsg) { res.status(400).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const session = getSession(sessionId);
  const history = session ? session.history : [];
  const shortHistory = history.slice(-4);

  try {
    const bangkokNow = getBangkokTime();

    // Knowledge fast-path
    const knowledgeKeywords = /คืออะไร|หมายถึง|อธิบาย|ทำงานยังไง|ทำงานอย่างไร|คืออะ| คือ|^คือ|explain|what is|define|how does|how do/i;
    const isKnowledgeQuestion = knowledgeKeywords.test(userMsg) && !/ระบบ|ใน db|ใน database|ตอนนี้|ล่าสุด|แสดง|เช็ค|status|สถานะ/.test(userMsg);

    if (isKnowledgeQuestion) {
            const kStream = await axios.post(OLLAMA_CHAT_URL, {
        model: 'qwen2.5:1.5b', stream: true,
        messages: [
          { role: 'system', content: 'คุณคือ Network Engineer ผู้เชี่ยวชาญ ตอบเป็นภาษาไทย กระชับ ชัดเจน ไม่เกิน 5 ประโยค' },
          { role: 'user', content: userMsg }
        ], options: { num_predict: 200, temperature: 0.3 }
      }, { responseType: 'stream', timeout: OLLAMA_TIMEOUT });
      let fullText = '';
      await new Promise((resolve, reject) => {
        kStream.data.on('data', chunk => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const j = JSON.parse(line);
              if (j.message && j.message.content) {
                send('token', { text: j.message.content });
                fullText += j.message.content;
              }
            } catch {}
          }
        });
        kStream.data.on('end', resolve);
        kStream.data.on('error', reject);
      });
      pushHistory(session, userMsg, fullText);
      send('done', { rows: 0, source: 'knowledge' });
      res.end();
      return;
    }

    // Hybrid routing
    const hybridMatch = userMsg.match(/([A-Za-z0-9\-]+)\s*(ในระบบ|ระบบ|สถานะ|status|ปกติมั้ย|มีไหม|เช็ค)/i);
    if (hybridMatch) {
      const keyword = hybridMatch[1].toUpperCase();
      const ragContext2 = await callRAG(userMsg);
      const ragText2 = ragContext2.length > 0 ? '\n\n[Network Knowledge]\n' + ragContext2.slice(0,2).map(d=>d.slice(0,300)).join('\n---\n') : '';
      let hybridRows = [];
      try {
        const hRes = await pool.query(
          `SELECT time, source, severity_code, message FROM syslog WHERE message IS NOT NULL AND message ILIKE $1 ORDER BY time DESC LIMIT 10`,
          [`%${keyword}%`]
        );
        hybridRows = hRes.rows;
      } catch {}
      const noDbNote = hybridRows.length === 0 ? `\n⚠️ ไม่พบข้อมูล ${keyword} ใน database ระบบปัจจุบัน` : `\nพบ ${hybridRows.length} รายการใน syslog`;
      const hybridPrompt = `คุณคือ Network Engineer ผู้เชี่ยวชาญ${noDbNote}\nตอบเป็นภาษาไทย กระชับ`;
      const hStream = await axios.post(OLLAMA_CHAT_URL, {
        model: 'qwen2.5:1.5b', stream: true,
        messages: [
          { role: 'system', content: hybridPrompt + ragText2 },
          { role: 'user', content: userMsg + (hybridRows.length > 0 ? `\n\nข้อมูล syslog: ${JSON.stringify(hybridRows)}` : '') }
        ], options: { num_predict: 250, temperature: 0.3 }
      }, { responseType: 'stream', timeout: OLLAMA_TIMEOUT });
      let fullText = '';
      await new Promise((resolve, reject) => {
        hStream.data.on('data', chunk => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const j = JSON.parse(line);
              if (j.message && j.message.content) { send('token', { text: j.message.content }); fullText += j.message.content; }
            } catch {}
          }
        });
        hStream.data.on('end', resolve);
        hStream.data.on('error', reject);
      });
      pushHistory(session, userMsg, fullText);
      send('done', { rows: hybridRows.length, source: hybridRows.length > 0 ? 'db+knowledge' : 'knowledge' });
      res.end();
      return;
    }

    // DB path — check template first
    const matchedTemplate2 = SQL_TEMPLATES.find(t => t.pattern.test(userMsg));
    if (matchedTemplate2) {
      console.log(`[SQL-TEMPLATE/stream] IP:${ip} Q:"${userMsg.slice(0,50)}"`);
      try {
        const dbRes3 = await pool.query(matchedTemplate2.sql);
        const formattedRows3 = dbRes3.rows.map((row,i) => {
          const parts = Object.entries(row).map(([k,v]) => `${k}: ${fmtVal(k,v)}`);
          return `[${i+1}] ${parts.join(' | ')}`;
        }).join('\n');
        const codeConc3 = codeConclusion(dbRes3.rows);
        const aStream2 = await axios.post(OLLAMA_CHAT_URL, {
          model: 'qwen2.5:1.5b', stream: true,
          messages: [
            { role: 'system', content: `คุณคือ Network Analyst สรุปข้อมูลจาก DB เป็นภาษาไทย กระชับ ห้ามพูดว่า "row 1,2" ให้ใช้ชื่ออุปกรณ์/IP` },
            { role: 'user', content: `ข้อมูล:\n${formattedRows3}${codeConc3}\n\nคำถาม: ${userMsg}` }
          ], options: { num_predict: 250, temperature: 0.1 }
        }, { responseType: 'stream', timeout: OLLAMA_TIMEOUT });
        let fullAns = '';
        await new Promise((resolve, reject) => {
          aStream2.data.on('data', chunk => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              try { const j = JSON.parse(line); if (j.message?.content) { send('token', { text: j.message.content }); fullAns += j.message.content; } } catch {}
            }
          });
          aStream2.data.on('end', resolve);
          aStream2.data.on('error', reject);
        });
        pushHistory(session, userMsg, fullAns);
        send('done', { rows: dbRes3.rows.length, source: 'db+template' });
        res.end();
        return;
      } catch(e) { console.error('[TEMPLATE/stream ERROR]', e.message); }
    }

    const contextPrefix = shortHistory.length > 0
      ? 'Previous conversation:\n' + shortHistory.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content.slice(0, 150)}`).join('\n') + '\n\nCurrent question: '
      : '';
    const sqlRes = await axios.post(OLLAMA_CHAT_URL, {
      model: 'qwen2.5:1.5b', stream: false,
      messages: [{ role: 'system', content: SQL_DIRECT_PROMPT }, { role: 'user', content: contextPrefix + userMsg }],
      options: { num_predict: 200, temperature: 0.05 }
    }, { timeout: OLLAMA_TIMEOUT });

    const _rawSQL = sqlRes.data.message.content.trim().replace(/```sql\s*/gi, '').replace(/```/g, '').trim();
    const _stripped = _rawSQL.replace(/^(A:|Answer:|SQL:|Query:)\s*/i, '').trim();
    const _selectPos = _stripped.search(/\bSELECT\b/i);
    const _sql = _selectPos > 0 ? _stripped.slice(_selectPos) : _stripped;
    const cleanSQL = _sql.replace(/\bAS\s+'([^']+)'/gi, (_, alias) => {
      const safe = alias.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col';
      return 'AS ' + safe;
    });

    if (cleanSQL.includes('UNSAFE_REQUEST') || !isSafeSQL(cleanSQL)) {
      const ragContext = await callRAG(userMsg);
      if (ragContext.length > 0) {
        const ragText = '\n\n[Network Knowledge]\n' + ragContext.join('\n---\n');
        const rStream = await axios.post(OLLAMA_CHAT_URL, {
          model: 'qwen2.5:1.5b', stream: true,
          messages: [
            { role: 'system', content: `[เวลาปัจจุบัน Bangkok UTC+7: ${bangkokNow}]\n${ANALYST_SYSTEM_PROMPT}${ragText}` },
            { role: 'user', content: `คำถาม: ${userMsg}` }
          ], options: { num_predict: 600, temperature: 0.3 }
        }, { responseType: 'stream', timeout: OLLAMA_TIMEOUT });
        let fullText = '';
        await new Promise((resolve, reject) => {
          rStream.data.on('data', chunk => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              try { const j = JSON.parse(line); if (j.message && j.message.content) { send('token', { text: j.message.content }); fullText += j.message.content; } } catch {}
            }
          });
          rStream.data.on('end', resolve);
          rStream.data.on('error', reject);
        });
        pushHistory(session, userMsg, fullText);
      } else {
        send('token', { text: 'ไม่พบข้อมูลที่เกี่ยวข้องในระบบ หรือคำถามนี้อยู่นอกขอบเขตข้อมูล network ที่มีใน DB' });
      }
      send('done', { rows: 0, source: 'rag' });
      res.end();
      return;
    }

        const dbRes = await pool.query(cleanSQL);

    if (dbRes.rows.length === 0) {
      const ragContext = await callRAG(userMsg);
      if (ragContext.length > 0) {
        const ragText = '\n\n[Network Knowledge]\n' + ragContext.join('\n---\n');
        const noDbPrompt = `คุณคือ Network Engineer ผู้เชี่ยวชาญ\n⚠️ ไม่พบข้อมูลนี้ใน database\nตอบเป็นภาษาไทย กระชับ`;
        const rStream = await axios.post(OLLAMA_CHAT_URL, {
          model: 'qwen2.5:1.5b', stream: true,
          messages: [
            { role: 'system', content: `[เวลาปัจจุบัน Bangkok UTC+7: ${bangkokNow}]\n${noDbPrompt}${ragText}` },
            { role: 'user', content: `คำถาม: ${userMsg}` }
          ], options: { num_predict: 600, temperature: 0.3 }
        }, { responseType: 'stream', timeout: OLLAMA_TIMEOUT });
        let fullText = '';
        await new Promise((resolve, reject) => {
          rStream.data.on('data', chunk => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              try { const j = JSON.parse(line); if (j.message && j.message.content) { send('token', { text: j.message.content }); fullText += j.message.content; } } catch {}
            }
          });
          rStream.data.on('end', resolve);
          rStream.data.on('error', reject);
        });
        pushHistory(session, userMsg, fullText);
      } else {
        send('token', { text: 'ไม่พบข้อมูลที่เกี่ยวข้องใน DB สำหรับคำถามนี้' });
      }
      send('done', { rows: 0, source: 'rag' });
      res.end();
      return;
    }

    // Fast-path: time query
    if (dbRes.rows.length === 1 && dbRes.rows[0].current_time !== undefined) {
      const t = new Date(dbRes.rows[0].current_time);
      const timeStr = t.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      send('token', { text: `ตอนนี้เวลา ${timeStr} (UTC+7)` });
      send('done', { rows: 1, source: 'db' });
      res.end();
      return;
    }

        const ANS_ROW_CAP = 20;
    const analystRows = dbRes.rows.slice(0, ANS_ROW_CAP);
    const rowNote = dbRes.rows.length > ANS_ROW_CAP ? ` (แสดง ${ANS_ROW_CAP} จาก ${dbRes.rows.length} รายการ)` : '';
    const scenariosInRows = [...new Set(analystRows.map(r => r.scenario_name).filter(s => s && SCENARIO_PLAYBOOK[s]))];
    const playbookContext = scenariosInRows.length > 0
      ? '\n\n[Scenario Guide]\n' + scenariosInRows.map(s => { const p = SCENARIO_PLAYBOOK[s]; return `${s}: ${p.title} — ${p.description} | คำแนะนำ: ${p.advice}`; }).join('\n')
      : '';
    const shortAnalystPrompt = `คุณคือ Network Analyst. วิเคราะห์ข้อมูลจาก DB แล้วตอบเป็นภาษาไทย กระชับ\n- ถ้ามีหลายแถวให้แสดงเป็นตาราง Markdown\n- แปลง bytes→MB (หาร 1048576), cpu_5s คือ %, อธิบาย scenario_name\n- สรุป 1-2 ประโยคท้ายสุด\n- เวลาปัจจุบัน: ${bangkokNow}\n- IMPORTANT: ระบุ hostname/อุปกรณ์ให้ชัดเจน อย่าบอกแค่ "row 1, row 2"\n- IMPORTANT: ระบุช่วงเวลา (first_seen/last_seen หรือ time) เป็น วันที่ เวลา ให้ชัดเจน\n- IMPORTANT: นับจำนวน hostname ที่ไม่ซ้ำกันเท่านั้น หลาย rows อาจเป็น device เดียวกัน\n- IMPORTANT: ตอบตามข้อมูลที่มีจริงใน DB เท่านั้น ห้ามสมมติข้อมูลที่ไม่มีในผลลัพธ์`;

    const aStream = await axios.post(OLLAMA_CHAT_URL, {
      model: 'qwen2.5:1.5b', stream: true,
      messages: [
        { role: 'system', content: shortAnalystPrompt + playbookContext },
        { role: 'user', content: `ข้อมูล (${analystRows.length} rows${rowNote}):\n${JSON.stringify(analystRows)}\n\nคำถาม: ${userMsg}` }
      ], options: { num_predict: 300, temperature: 0.2 }
    }, { responseType: 'stream', timeout: OLLAMA_TIMEOUT });

    let fullAnswer = '';
    await new Promise((resolve, reject) => {
      aStream.data.on('data', chunk => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            if (j.message && j.message.content) {
              send('token', { text: j.message.content });
              fullAnswer += j.message.content;
            }
          } catch {}
        }
      });
      aStream.data.on('end', resolve);
      aStream.data.on('error', reject);
    });

    pushHistory(session, userMsg, fullAnswer);
    send('done', { rows: dbRes.rows.length, source: 'db+rag' });
    res.end();

  } catch (err) {
    console.error('[STREAM ERROR]', err.message);
    // Fallback: ลอง knowledge path แทน
    try {
      const fallbackRes = await axios.post(
        OLLAMA_CHAT_URL,
        { model: 'qwen2.5:1.5b', stream: false, messages: [
            { role: 'system', content: 'คุณคือ Network Engineer ผู้เชี่ยวชาญ ตอบเป็นภาษาไทย กระชับ ชัดเจน ไม่เกิน 5 ประโยค' },
            { role: 'user', content: userMsg }
          ], options: { num_predict: 200, temperature: 0.3 }
        },
        { timeout: OLLAMA_TIMEOUT }
      );
      const fallbackAnswer = fallbackRes.data.message.content.trim();
      send('token', { text: fallbackAnswer });
      send('done', { rows: 0, source: 'knowledge-fallback' });
    } catch (e2) {
      send('error', { msg: '⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
    }
    res.end();
  }
});

// ── Alert endpoints ────────────────────────────────────────────────────────────
const SCENARIO_META = {
  high_cpu:     { label: 'CPU สูง',            severity: 'critical', icon: '🔥' },
  elevated_cpu: { label: 'CPU สูงผิดปกติ',      severity: 'warning',  icon: '⚠️' },
  high_memory:  { label: 'Memory สูง',          severity: 'warning',  icon: '💾' },
  traffic_flood:{ label: 'Traffic Flood',       severity: 'critical', icon: '🌊' },
  traffic_spike:{ label: 'Traffic Spike',       severity: 'warning',  icon: '📈' },
  port_error:   { label: 'Port Error',          severity: 'warning',  icon: '🔌' },
  error_flood:  { label: 'Error Flood',         severity: 'critical', icon: '💥' },
  device_down:  { label: 'อุปกรณ์ออฟไลน์',      severity: 'critical', icon: '🔴' },
};

app.get('/api/alerts', async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  try {
    const [ifResult, arimaResult] = await Promise.all([
      pool.query(`
        SELECT hostname, scenario_name, time,
               cpu_5s,
               ROUND((mem_used/1048576.0)::numeric, 1) AS mem_mb,
               ROUND((in_bps/1000000.0)::numeric, 2)  AS in_mbps,
               ROUND((out_bps/1000000.0)::numeric, 2) AS out_mbps,
               in_err_rate
        FROM ml_isolation_forest
        WHERE scenario_name NOT IN ('normal','unknown_anomaly')
          AND time >= NOW() - INTERVAL '${hours} hours'
        ORDER BY time DESC
        LIMIT 200
      `),
      pool.query(`
        SELECT hostname, scenario_name, time,
               actual AS gap_sec, predicted AS normal_interval_sec
        FROM ml_arima
        WHERE feature = 'gap'
          AND time >= NOW() - INTERVAL '${hours} hours'
        ORDER BY time DESC
      `),
    ]);

    const grouped = {};
    for (const row of ifResult.rows) {
      const sn = row.scenario_name;
      if (!grouped[sn]) grouped[sn] = { ...SCENARIO_META[sn], scenario_name: sn, records: [] };
      grouped[sn].records.push(row);
    }
    for (const row of arimaResult.rows) {
      const sn = 'device_down';
      if (!grouped[sn]) grouped[sn] = { ...SCENARIO_META[sn], scenario_name: sn, records: [] };
      grouped[sn].records.push(row);
    }

    const result = Object.values(grouped).sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });

    res.json({ alerts: result, hours, total: result.reduce((s, g) => s + g.records.length, 0) });
  } catch (err) {
    console.error('[ALERTS]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/analyze', async (req, res) => {
  const { scenario_name, records } = req.body;
  if (!scenario_name || !records?.length) {
    return res.status(400).json({ error: 'missing scenario_name or records' });
  }
  const meta = SCENARIO_META[scenario_name] || { label: scenario_name };
  const sample = records.slice(0, 10);
  const bangkokNow = getBangkokTime();
  const prompt = `วิเคราะห์ alert ในระบบ Network Monitoring:

Scenario: ${meta.label} (${scenario_name}) — ${records.length} รายการ ใน 24 ชั่วโมงที่ผ่านมา
ข้อมูลตัวอย่าง ${sample.length} รายการล่าสุด:
${JSON.stringify(sample, null, 2)}

กรุณา:
1. สรุปว่าเกิดอะไรขึ้น (1-2 ประโยค)
2. สาเหตุที่เป็นไปได้
3. คำแนะนำการแก้ไข
ตอบภาษาไทย กระชับ ไม่เกิน 150 คำ`;

  try {
    const analysis = await callGroq(
      `[เวลาปัจจุบัน Bangkok: ${bangkokNow}]\nคุณเป็น Network Security Analyst วิเคราะห์ alert และให้คำแนะนำเชิงปฏิบัติ`,
      prompt,
      { maxTokens: 400, temperature: 0.3 }
    );
    res.json({ analysis, scenario_name });
  } catch (err) {
    console.error('[ANALYZE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ EdgeAI API ready on port ${PORT} | Groq(intent+analysis):${GROQ_MODEL} keys:${GROQ_KEYS.length} → Ollama(SQL):${OLLAMA_MODEL}`)
);
